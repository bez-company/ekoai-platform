// social-accounts.ts: contas de rede conectadas e os tokens delas (SPEC 011 R5). Os metadados vivem
// em `social_accounts` (escopo por conta, RLS); o token cifrado vive em `social_account_secrets`, sem
// tenant_id e sem acesso da API, e só este módulo o lê (tests/tenant-scope.test.js). Server-only.

import { randomUUID } from 'node:crypto';
import { db } from './db';
import { UserError } from './errors';
import { log } from './log';
import { auditTenant } from './audit';
import { tenantDb, type TenantDb } from './tenant-db';
import { kmsBox, socialTokenContext, type SecretBox } from './secret-box';
import { ConnectError } from './instagram-oauth-model';
import type { ConnectedInstagram } from './instagram-oauth';
import type { InstagramCredentials } from './channels/instagram';

// Único acesso cru ao banco deste módulo: os tokens não têm tenant_id, então não passam pelo tenantDb.
const system = () => db();

export type SocialAccountStatus = 'active' | 'reauth_required' | 'revoked';

export type SocialAccount = {
  id: string;
  channel: string;
  handle: string | null;
  status: SocialAccountStatus;
  expiresAt: string | null;
  connectedAt: string;
};

const COLUMNS = 'id,channel,handle,status,expires_at,connected_at';

const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : v ? String(v) : null);

export async function listSocialAccounts(t: TenantDb): Promise<SocialAccount[]> {
  const { data, error } = await t.select('social_accounts', COLUMNS).neq('status', 'revoked').order('connected_at', { ascending: false });
  if (error) throw new Error(`social_accounts: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: String(r.id),
    channel: String(r.channel),
    handle: (r.handle as string | null) ?? null,
    status: r.status as SocialAccountStatus,
    expiresAt: iso(r.expires_at),
    connectedAt: iso(r.connected_at) ?? '',
  }));
}

export async function countLiveAccounts(t: TenantDb, channel: string): Promise<number> {
  const { count, error } = await t.select('social_accounts', 'id', { count: 'exact', head: true }).eq('channel', channel).neq('status', 'revoked');
  if (error) throw new Error(`social_accounts: ${error.message}`);
  return count ?? 0;
}

type DbFailure = { code?: string | null; hint?: string | null; message: string };

// Traduz a recusa do banco em algo que a pessoa entende: limite do plano ou conta já usada em outra.
function connectFailure(error: DbFailure): Error {
  if (error.hint === 'plan_instagram') return new ConnectError('limit');
  if (error.code === '23505') return new ConnectError('taken');
  return new Error(`social_accounts: ${error.message}`);
}

// Grava a conta (nova ou a mesma reconectada) e o token cifrado, numa transação só: nunca fica
// conta ativa sem token. O token é cifrado antes de abrir a transação (chamada de rede).
export async function saveInstagramConnection(
  t: TenantDb,
  input: { userId: string | null; connected: ConnectedInstagram },
  box: SecretBox = kmsBox(),
): Promise<{ id: string; handle: string | null }> {
  const { connected } = input;
  const existing = await t
    .select('social_accounts', 'id')
    .eq('channel', 'instagram')
    .eq('external_id', connected.profile.userId)
    .neq('status', 'revoked')
    .maybeSingle();
  if (existing.error) throw new Error(`social_accounts: ${existing.error.message}`);
  const id = existing.data ? String(existing.data.id) : randomUUID();
  const sealed = await box.seal(connected.accessToken, socialTokenContext(id));

  const client = system();
  if (!client.transaction) throw new Error('banco sem suporte a transação');
  await client.transaction(async (tx) => {
    const scoped = tenantDb(t.tenantId, tx);
    const fields = {
      handle: connected.profile.username,
      status: 'active',
      status_reason: null,
      scopes: connected.scopes,
      expires_at: connected.expiresAt.toISOString(),
      connected_by: input.userId,
      refreshed_at: new Date().toISOString(),
    };
    const saved = existing.data
      ? await scoped.update('social_accounts', fields).eq('id', id)
      : await scoped.insert('social_accounts', { id, channel: 'instagram', external_id: connected.profile.userId, ...fields });
    if (saved.error) throw connectFailure(saved.error);

    const secret = await tx
      .from('social_account_secrets')
      .upsert(
        { social_account_id: id, access_token_ciphertext: sealed.ciphertext, refresh_token_ciphertext: null, key_version: sealed.keyVersion },
        { onConflict: 'social_account_id' },
      );
    if (secret.error) throw new Error(`social_account_secrets: ${secret.error.message}`);
  });

  await auditSafely(t, input.userId, 'social_account.connected', id, connected.profile.username);
  return { id, handle: connected.profile.username };
}

// Desconectar marca como revogada; o gatilho do banco apaga o token na mesma operação.
export async function disconnectSocialAccount(t: TenantDb, userId: string | null, id: string): Promise<boolean> {
  const { data, error } = await t
    .update('social_accounts', { status: 'revoked', status_reason: 'disconnected' })
    .eq('id', id)
    .neq('status', 'revoked')
    .select('id,handle')
    .maybeSingle();
  if (error) throw new Error(`social_accounts: ${error.message}`);
  if (!data) return false;
  await auditSafely(t, userId, 'social_account.disconnected', id, (data.handle as string | null) ?? null);
  return true;
}

async function auditSafely(t: TenantDb, userId: string | null, action: string, id: string, handle: string | null): Promise<void> {
  try {
    await auditTenant(t, { actorUserId: userId, action, targetType: 'social_account', targetId: id, metadata: { channel: 'instagram', handle } });
  } catch (e) {
    log('warn', 'social-accounts', 'auditoria não gravada', { action, reason: e instanceof Error ? e.message : String(e) });
  }
}

// O que a publicação usa: a conta de Instagram ativa desta conta da Ekoai. Sem ela a publicação
// falha com o próximo passo, e nunca cai no token de outra conta.
export async function instagramCredentials(t: TenantDb, box?: SecretBox, nowMs: number = Date.now()): Promise<InstagramCredentials> {
  const { data, error } = await t
    .select('social_accounts', 'id,external_id,expires_at')
    .eq('channel', 'instagram')
    .eq('status', 'active')
    .order('connected_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`social_accounts: ${error.message}`);
  if (!data) throw new UserError('Nenhum Instagram conectado. Conecte em Configurações, Redes.');
  const expires = iso(data.expires_at);
  if (expires && new Date(expires).getTime() <= nowMs) throw new UserError('A conexão do Instagram venceu. Reconecte em Configurações, Redes.');

  const secret = await system().from('social_account_secrets').select('access_token_ciphertext').eq('social_account_id', String(data.id)).maybeSingle();
  if (secret.error) throw new Error(`social_account_secrets: ${secret.error.message}`);
  if (!secret.data) throw new UserError('O acesso ao Instagram não foi encontrado. Reconecte em Configurações, Redes.');
  const token = await (box ?? kmsBox()).open({ ciphertext: String(secret.data.access_token_ciphertext) }, socialTokenContext(String(data.id)));
  return { accountId: String(data.external_id), token };
}
