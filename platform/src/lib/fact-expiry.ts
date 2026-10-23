// fact-expiry.ts: aviso de vencimento dos fatos da empresa (SPEC 018, ADR 0019). Roda no job diário. Para cada
// conta, avisa o administrador uma vez quando um fato confirmado passa a vencer em até 7 dias e outra vez
// quando vence. Vencido nunca é gravado: o que se grava é só até qual etapa já foi avisado (`expiry_notice`).
//
// A etapa é reservada antes do aviso (update condicionado ao valor anterior): dois jobs ao mesmo tempo, ou o
// job rodado duas vezes no dia, avisam uma vez só. O texto do aviso leva só a categoria, nunca o fato.

import { db } from './db';
import { tenantDb } from './tenant-db';
import { log } from './log';
import { notify } from './notifications';
import { addDays, expiryNoticeText, EXPIRY_SOON_DAYS, pendingExpiryNotice, todayLocal, type FactCategory } from './company-facts-model';

export type ExpirySummary = { accounts: number; soon: number; expired: number; failed: number };

type Candidate = { id: string; tenantId: string; category: FactCategory; validUntil: string; previous: 'soon' | 'expired' | null };

const dayOf = (v: unknown): string => (v instanceof Date ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}` : String(v).slice(0, 10));

export async function runFactExpiryNotices(deps: { now?: Date } = {}): Promise<ExpirySummary> {
  const today = todayLocal(deps.now ?? new Date());
  // sistema: leitura entre tenants, só o que ainda pode gerar aviso (o índice parcial da migration 0037)
  const { data, error } = await db()
    .from('company_facts')
    .select('id,tenant_id,category,valid_until,expiry_notice')
    .eq('kind', 'fact')
    .eq('status', 'confirmed')
    .eq('active', true)
    .not('valid_until', 'is', null)
    .lte('valid_until', addDays(today, EXPIRY_SOON_DAYS))
    .limit(5000);
  if (error) throw new Error(`fatos a vencer: ${error.message}`);

  const byTenant = new Map<string, Map<'soon' | 'expired', Candidate[]>>();
  for (const r of data ?? []) {
    const fact = { kind: 'fact' as const, status: 'confirmed' as const, active: true, validUntil: dayOf(r.valid_until), expiryNotice: (r.expiry_notice as 'soon' | 'expired' | null) ?? null };
    const stage = pendingExpiryNotice(fact, today);
    if (!stage) continue;
    const stages = byTenant.get(String(r.tenant_id)) ?? new Map();
    stages.set(stage, [...(stages.get(stage) ?? []), { id: String(r.id), tenantId: String(r.tenant_id), category: r.category as FactCategory, validUntil: fact.validUntil, previous: fact.expiryNotice }]);
    byTenant.set(String(r.tenant_id), stages);
  }

  const summary: ExpirySummary = { accounts: 0, soon: 0, expired: 0, failed: 0 };
  for (const [tenantId, stages] of byTenant) {
    const t = tenantDb(tenantId);
    try {
      for (const [stage, items] of stages) {
        // Reserva por valor anterior: quem outro job já marcou não volta no `returning`.
        const claimed: Candidate[] = [];
        for (const previous of [null, 'soon'] as const) {
          const group = items.filter((c) => c.previous === previous);
          if (!group.length) continue;
          const q = t.update('company_facts', { expiry_notice: stage }).in('id', group.map((c) => c.id));
          const res = await (previous === null ? q.is('expiry_notice', null) : q.eq('expiry_notice', previous)).select('id');
          if (res.error) throw new Error(`reservar aviso: ${res.error.message}`);
          const won = new Set((res.data ?? []).map((r) => String(r.id)));
          claimed.push(...group.filter((c) => won.has(c.id)));
        }
        if (!claimed.length) continue;
        const text = expiryNoticeText(stage, claimed.map((c) => c.category));
        await notify(t, { kind: `facts.${stage}`, level: 'warning', title: text.title, body: text.body, link: '/configuracoes/fatos', audience: 'admin' });
        summary[stage] += claimed.length;
      }
      summary.accounts += 1;
    } catch (e) {
      summary.failed += 1;
      log('error', 'fact-expiry', 'não avisou os vencimentos da conta', { tenant: tenantId, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return summary;
}
