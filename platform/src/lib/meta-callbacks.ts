// meta-callbacks.ts: o que a plataforma faz quando a Meta avisa que a pessoa tirou o app ou pediu a
// exclusão dos dados (SPEC 011 R5.4, BEZ-215). A prova é o signed_request (meta-signed-request.ts), não a
// sessão. As duas ações revogam a conexão do Instagram em toda conta da Ekoai que a usa (o token some
// junto), avisam os administradores e ficam na auditoria. A exclusão também grava o pedido, com o código
// de confirmação e a página pública de status que a Meta mostra para a pessoa. A exclusão da conta da
// Ekoai inteira continua pelo fluxo de Configurações (SPEC 011 R8). Server-only.

import { createHash, randomBytes } from 'node:crypto';
import { db } from './db';
import { auditTenant } from './audit';
import { track } from './analytics';
import { log } from './log';
import { notify } from './notifications';
import { tenantDb } from './tenant-db';
import { revokeInstagramByExternalId, type RevokedAccount } from './social-accounts';
import { isConfirmationCode } from './meta-signed-request';

// Único acesso cru ao banco deste módulo: o pedido de exclusão vem antes de saber a conta (sem tenant_id).
const system = () => db();

type Reason = 'meta_deauthorized' | 'meta_data_deletion';

async function afterRevoke(accounts: RevokedAccount[], reason: Reason): Promise<void> {
  for (const a of accounts) {
    const t = tenantDb(a.tenantId);
    const who = a.handle ? `@${a.handle}` : 'A conta do Instagram';
    await notify(t, {
      kind: 'instagram.revoked',
      level: 'warning',
      title: 'Instagram desconectado',
      body: `${who} removeu o acesso da Ekoai pelo Instagram. Os posts aprovados esperam até alguém conectar de novo.`,
      link: '/configuracoes/canais',
    });
    try {
      await auditTenant(t, { actorUserId: null, actorKind: 'system', action: 'social_account.revoked_by_meta', targetType: 'social_account', targetId: a.id, metadata: { channel: 'instagram', reason } });
    } catch (e) {
      log('warn', 'meta-callbacks', 'auditoria não gravada', { reason: e instanceof Error ? e.message : String(e) });
    }
    await track(a.tenantId, 'instagram_disconnected', { via: reason });
  }
}

// Desautorização: a pessoa tirou o app no Instagram. Devolve quantas conexões caíram.
export async function handleDeauthorize(instagramUserId: string): Promise<number> {
  const accounts = await revokeInstagramByExternalId(instagramUserId, 'meta_deauthorized');
  await afterRevoke(accounts, 'meta_deauthorized');
  return accounts.length;
}

const hashOf = (id: string) => createHash('sha256').update(`instagram:${id}`).digest('hex');

// Exclusão de dados: revoga, grava o pedido e devolve o código e a URL de status no formato da Meta.
export async function handleDataDeletion(instagramUserId: string, baseUrl: string): Promise<{ url: string; confirmation_code: string }> {
  const accounts = await revokeInstagramByExternalId(instagramUserId, 'meta_data_deletion');
  await afterRevoke(accounts, 'meta_data_deletion');
  const code = randomBytes(18).toString('base64url');
  const { error } = await system()
    .from('data_deletion_requests')
    .insert({ confirmation_code: code, channel: 'instagram', external_user_hash: hashOf(instagramUserId), accounts_revoked: accounts.length });
  if (error) throw new Error(`data_deletion_requests: ${error.message}`);
  return { url: `${baseUrl.replace(/\/$/, '')}/instagram/exclusao/${code}`, confirmation_code: code };
}

export type DeletionStatus = { requestedAt: string; accountsRevoked: number };

export async function deletionStatus(code: string): Promise<DeletionStatus | null> {
  if (!isConfirmationCode(code)) return null;
  const { data, error } = await system().from('data_deletion_requests').select('requested_at,accounts_revoked').eq('confirmation_code', code).maybeSingle();
  if (error) throw new Error(`data_deletion_requests: ${error.message}`);
  if (!data) return null;
  return { requestedAt: new Date(data.requested_at as string).toISOString(), accountsRevoked: Number(data.accounts_revoked) };
}
