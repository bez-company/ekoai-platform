// stale-approvals.ts: posts esquecidos em Aprovar (SPEC 017, decisão 12; BEZ-242). A cada ciclo do
// publish-due: post esperando há mais de 3 dias gera um aviso; há mais de 14, a Ekoai pergunta se
// arquiva. Cada aviso sai uma vez por post (migration 0031) e os da mesma conta saem juntos num aviso só.
// Arquivar tira o post de Aprovar sem rejeitar e pode ser desfeito.

import { db } from './db';
import { UserError } from './errors';
import { log } from './log';
import { notify } from './notifications';
import { ARCHIVE_DAYS, STALE_DAYS } from './onboarding';
import { tenantDb, type TenantDb } from './tenant-db';

const DAY = 86_400_000;
const BATCH = 500;

export type StaleRow = { id: string; savedAt: string; staleNotifiedAt: string | null; archiveAskedAt: string | null };

// Puro: o que cada post pede neste ciclo. Quem já passou dos 14 dias recebe só a pergunta de arquivar.
export function staleActions(rows: readonly StaleRow[], nowMs: number): { warn: string[]; ask: string[] } {
  const warn: string[] = [];
  const ask: string[] = [];
  for (const r of rows) {
    const age = (nowMs - Date.parse(r.savedAt)) / DAY;
    if (!Number.isFinite(age)) continue;
    if (age > ARCHIVE_DAYS && !r.archiveAskedAt) ask.push(r.id);
    else if (age > STALE_DAYS && !r.staleNotifiedAt && !r.archiveAskedAt) warn.push(r.id);
  }
  return { warn, ask };
}

const posts = (n: number) => (n === 1 ? '1 post' : `${n} posts`);

export function staleNotice(n: number) {
  return {
    kind: 'pending.stale',
    level: 'warning' as const,
    title: `${posts(n)} ${n === 1 ? 'espera' : 'esperam'} aprovação há mais de ${STALE_DAYS} dias`,
    body: 'Aprovado, cada post entra no próximo horário da agenda.',
    link: '/aprovar',
    audience: 'team' as const,
  };
}

export function archiveNotice(n: number) {
  return {
    kind: 'pending.archive_suggested',
    level: 'info' as const,
    title: `${posts(n)} em Aprovar há mais de ${ARCHIVE_DAYS} dias`,
    body: 'Aprove ou arquive para tirar de Aprovar. Arquivar não conta como rejeição e dá para desfazer.',
    link: '/aprovar',
    audience: 'team' as const,
  };
}

export type StaleSummary = { tenants: number; warned: number; asked: number };

const iso = (v: unknown): string | null => (v === null || v === undefined ? null : new Date(v as string).toISOString());

// Atravessa as contas de propósito (job de sistema): lê só o que ainda pode gerar aviso.
export async function runStaleApprovals(nowMs = Date.now()): Promise<StaleSummary> {
  const cutoff = new Date(nowMs - STALE_DAYS * DAY).toISOString();
  const { data, error } = await db()
    .from('pending_approvals')
    .select('id,tenant_id,saved_at,stale_notified_at,archive_asked_at')
    .is('archived_at', null)
    .is('archive_asked_at', null)
    .lt('saved_at', cutoff)
    .order('saved_at', { ascending: true })
    .limit(BATCH);
  if (error) throw new Error(`pending_approvals: ${error.message}`);

  const byTenant = new Map<string, StaleRow[]>();
  for (const r of data ?? []) {
    const tenant = String(r.tenant_id);
    const row: StaleRow = { id: String(r.id), savedAt: iso(r.saved_at)!, staleNotifiedAt: iso(r.stale_notified_at), archiveAskedAt: iso(r.archive_asked_at) };
    byTenant.set(tenant, [...(byTenant.get(tenant) ?? []), row]);
  }

  const summary: StaleSummary = { tenants: 0, warned: 0, asked: 0 };
  const stamp = new Date(nowMs).toISOString();
  for (const [tenantId, rows] of byTenant) {
    const { warn, ask } = staleActions(rows, nowMs);
    if (!warn.length && !ask.length) continue;
    const t = tenantDb(tenantId);
    try {
      // Marca antes de avisar: se o aviso falhar, perde-se um aviso; o contrário repetiria a cada 10 min.
      if (warn.length) {
        const r = await t.update('pending_approvals', { stale_notified_at: stamp }).in('id', warn);
        if (r.error) throw new Error(r.error.message);
        await notify(t, staleNotice(warn.length));
      }
      if (ask.length) {
        const r = await t.update('pending_approvals', { archive_asked_at: stamp, stale_notified_at: stamp }).in('id', ask);
        if (r.error) throw new Error(r.error.message);
        await notify(t, archiveNotice(ask.length));
      }
      summary.tenants += 1;
      summary.warned += warn.length;
      summary.asked += ask.length;
    } catch (e) {
      log('warn', 'stale-approvals', 'aviso de post esquecido não gravado; tenta no próximo ciclo', { tenant: tenantId, reason: e instanceof Error ? e.message : String(e) });
    }
  }
  return summary;
}

// Arquivar (ou desfazer). Some de Aprovar e do contador; não vira rejeição nem sinal de aprendizado.
export async function setPendingArchived(t: TenantDb, pendingId: string, archived: boolean): Promise<void> {
  const { data, error } = await t
    .update('pending_approvals', { archived_at: archived ? new Date().toISOString() : null })
    .eq('pending_id', pendingId)
    .select('id');
  if (error) throw new Error(`pending_approvals: ${error.message}`);
  if (!data?.length) throw new UserError('Post não encontrado em Aprovar. Recarregue a página.');
}
