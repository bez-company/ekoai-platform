// instagram-refresh.ts: renova o token de cada conta de Instagram antes de vencer (SPEC 011 R5.3). Roda
// todo dia pelo Cloud Scheduler (/api/cron/refresh-instagram). Para cada conta dentro da janela: abre o
// token (Cloud KMS), pede a renovação à Meta, cifra o novo e grava com o prazo novo. Token inválido,
// retirado ou vencido leva a conta para "precisa reconectar" e avisa os administradores uma vez; erro de
// rede ou da Meta tenta de novo no dia seguinte. O token nunca vai para o log. Server-only.

import { auditTenant } from './audit';
import { track } from './analytics';
import { log } from './log';
import { notify } from './notifications';
import { tenantDb } from './tenant-db';
import { MetaApiError, refreshLongToken } from './instagram-oauth';
import { refreshDecision } from './instagram-oauth-model';
import { kmsBox, type SecretBox } from './secret-box';
import { listRefreshTargets, markReauthRequired, openAccountToken, saveRefreshedToken, type RefreshTarget } from './social-accounts';

export type RefreshSummary = {
  checked: number;
  refreshed: number;
  waiting: number; // dentro da janela, mas com menos de 24 h: a Meta ainda não renova
  retry: number; // falha passageira, tenta de novo amanhã
  reauth: number; // virou "precisa reconectar" nesta rodada
};

type Deps = { box?: SecretBox; fetchFn?: typeof fetch; nowMs?: number };

type ReauthReason = 'token_expired' | 'token_rejected';

async function flagReauth(target: RefreshTarget, reason: ReauthReason): Promise<boolean> {
  const transitioned = await markReauthRequired(target, reason);
  if (!transitioned) return false;
  const t = tenantDb(target.tenantId);
  const who = target.handle ? `@${target.handle}` : 'a conta do Instagram';
  await notify(t, {
    kind: 'instagram.reauth',
    level: 'warning',
    title: 'Reconecte o Instagram',
    body: `O acesso de ${who} venceu ou foi retirado no Instagram. Os posts aprovados esperam até você reconectar.`,
    link: '/settings/channels',
  });
  try {
    await auditTenant(t, {
      actorUserId: null,
      actorKind: 'system',
      action: 'social_account.reauth_required',
      targetType: 'social_account',
      targetId: target.id,
      metadata: { channel: 'instagram', reason },
    });
  } catch (e) {
    log('warn', 'instagram-refresh', 'auditoria não gravada', { reason: e instanceof Error ? e.message : String(e) });
  }
  await track(target.tenantId, 'instagram_reauth_required', { reason });
  return true;
}

export async function runInstagramRefresh(deps: Deps = {}): Promise<RefreshSummary> {
  const nowMs = deps.nowMs ?? Date.now();
  const summary: RefreshSummary = { checked: 0, refreshed: 0, waiting: 0, retry: 0, reauth: 0 };
  const targets = await listRefreshTargets(nowMs);
  // A cifra só é criada se houver o que renovar: sem conta na janela, o job não depende do KMS.
  let box = deps.box;

  for (const target of targets) {
    summary.checked += 1;
    try {
      const decision = refreshDecision(target, nowMs);
      if (decision === 'skip') continue;
      if (decision === 'wait') {
        summary.waiting += 1;
        continue;
      }
      if (decision === 'expired') {
        if (await flagReauth(target, 'token_expired')) summary.reauth += 1;
        continue;
      }

      box ??= kmsBox();
      const token = await openAccountToken(target.id, box);
      const fresh = await refreshLongToken(token, deps.fetchFn, nowMs);
      if (await saveRefreshedToken(target, fresh, box)) summary.refreshed += 1;
    } catch (e) {
      if (e instanceof MetaApiError && e.permanent) {
        if (await flagReauth(target, 'token_rejected')) summary.reauth += 1;
        continue;
      }
      // Rede, limite de taxa, 5xx ou falha nossa (KMS, banco): a conta continua ativa e tenta amanhã.
      summary.retry += 1;
      log('warn', 'instagram-refresh', 'renovação adiada', { account: target.id, tenant: target.tenantId, reason: e instanceof Error ? e.message : String(e) });
    }
  }

  log('info', 'instagram-refresh', 'renovação concluída', { ...summary });
  return summary;
}
