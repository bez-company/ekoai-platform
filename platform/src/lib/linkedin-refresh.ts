// linkedin-refresh.ts: renova ou avisa, todo dia, sobre o acesso do LinkedIn de cada conta (SPEC 028, BEZ-423). O LinkedIn nem sempre dá
// refresh token: com ele, a rota renova sozinha dentro da janela antes do vencimento; sem ele, avisa os administradores uma vez
// ("vence em N dias, reconecte") e, vencido, leva a conta para "precisa reconectar". Refresh recusado também leva a conta para
// "precisa reconectar"; erro de rede ou 5xx tenta de novo amanhã. O token nunca vai para o log. Server-only.

import { auditTenant } from './audit';
import { track } from './analytics';
import { daysUntil } from './instagram-oauth-model';
import { LinkedInApiError, oauthApp, refreshWithToken } from './linkedin-oauth';
import { refreshDecision } from './linkedin-oauth-model';
import { log } from './log';
import { notify } from './notifications';
import { kmsBox, type SecretBox } from './secret-box';
import { listLinkedInRefreshTargets, markExpiringNotified, markReauthRequired, openAccountRefreshToken, saveRefreshedLinkedIn, type LinkedInRefreshTarget } from './social-accounts';
import { tenantDb } from './tenant-db';

export type LinkedInRefreshSummary = {
  checked: number;
  refreshed: number;
  warned: number; // avisou que vai vencer e não há como renovar sozinha
  retry: number; // falha passageira, tenta de novo amanhã
  reauth: number; // virou "precisa reconectar" nesta rodada
};

type Deps = { box?: SecretBox; fetchFn?: typeof fetch; nowMs?: number; app?: ReturnType<typeof oauthApp> };

type ReauthReason = 'token_expired' | 'token_rejected';

async function audit(target: LinkedInRefreshTarget, action: string, metadata: Record<string, unknown>) {
  try {
    await auditTenant(tenantDb(target.tenantId), { actorUserId: null, actorKind: 'system', action, targetType: 'social_account', targetId: target.id, metadata: { channel: 'linkedin', ...metadata } });
  } catch (e) {
    log('warn', 'linkedin-refresh', 'auditoria não gravada', { reason: e instanceof Error ? e.message : String(e) });
  }
}

async function flagReauth(target: LinkedInRefreshTarget, reason: ReauthReason): Promise<boolean> {
  if (!(await markReauthRequired(target, reason))) return false;
  await notify(tenantDb(target.tenantId), {
    kind: 'linkedin.reauth',
    level: 'warning',
    title: 'Reconecte o LinkedIn',
    body: `O acesso${target.handle ? ` de ${target.handle}` : ''} ao LinkedIn venceu ou foi retirado. Os posts aprovados do LinkedIn esperam até você reconectar.`,
    link: '/configuracoes/canais',
  });
  await audit(target, 'social_account.reauth_required', { reason });
  await track(target.tenantId, 'linkedin_reauth_required', { reason });
  return true;
}

async function warnExpiring(target: LinkedInRefreshTarget, nowMs: number): Promise<boolean> {
  if (!(await markExpiringNotified(target))) return false;
  const days = daysUntil(target.expiresAt, nowMs) ?? 0;
  await notify(tenantDb(target.tenantId), {
    kind: 'linkedin.expiring',
    level: 'warning',
    title: 'O acesso ao LinkedIn vence em breve',
    body: `O acesso${target.handle ? ` de ${target.handle}` : ''} vence em ${days === 1 ? '1 dia' : `${days} dias`} e o LinkedIn não deixa a Ekoai renovar sozinha. Reconecte antes para os posts não pararem.`,
    link: '/configuracoes/canais',
  });
  await audit(target, 'social_account.expiring_notified', { days });
  return true;
}

export async function runLinkedInRefresh(deps: Deps = {}): Promise<LinkedInRefreshSummary> {
  const nowMs = deps.nowMs ?? Date.now();
  const summary: LinkedInRefreshSummary = { checked: 0, refreshed: 0, warned: 0, retry: 0, reauth: 0 };
  const targets = await listLinkedInRefreshTargets(nowMs);
  let box = deps.box;
  const app = deps.app === undefined ? oauthApp() : deps.app;

  for (const target of targets) {
    summary.checked += 1;
    try {
      const decision = refreshDecision(target, nowMs);
      if (decision === 'skip') continue;
      if (decision === 'expired') {
        if (await flagReauth(target, 'token_expired')) summary.reauth += 1;
        continue;
      }
      if (decision === 'warn') {
        if (await warnExpiring(target, nowMs)) summary.warned += 1;
        continue;
      }
      // refresh: precisa do app (client id e secret) e do refresh token. Sem o app neste ambiente, tenta de novo quando houver.
      if (!app) {
        summary.retry += 1;
        continue;
      }
      box ??= kmsBox();
      const refreshToken = await openAccountRefreshToken(target.id, box);
      if (!refreshToken) {
        if (await warnExpiring(target, nowMs)) summary.warned += 1;
        continue;
      }
      const fresh = await refreshWithToken(refreshToken, app, deps.fetchFn, nowMs);
      if (await saveRefreshedLinkedIn(target, fresh, box)) summary.refreshed += 1;
    } catch (e) {
      if (e instanceof LinkedInApiError && e.permanent) {
        if (await flagReauth(target, 'token_rejected')) summary.reauth += 1;
        continue;
      }
      // Rede, limite de taxa, 5xx ou falha nossa (KMS, banco): a conta continua ativa e tenta amanhã.
      summary.retry += 1;
      log('warn', 'linkedin-refresh', 'renovação adiada', { account: target.id, tenant: target.tenantId, reason: e instanceof Error ? e.message : String(e) });
    }
  }

  log('info', 'linkedin-refresh', 'renovação concluída', { ...summary });
  return summary;
}
