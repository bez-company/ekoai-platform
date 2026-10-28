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
import { ConnectError, REFRESH_WINDOW_DAYS } from './instagram-oauth-model';
import type { ConnectedInstagram } from './instagram-oauth';
import type { InstagramCredentials } from './channels/instagram';
import { ConnectError as LinkedInConnectError, EXPIRING_REASON as LINKEDIN_EXPIRING_REASON, REFRESH_WINDOW_DAYS as LINKEDIN_REFRESH_WINDOW_DAYS, authorUrn as linkedinAuthorUrn } from './linkedin-oauth-model';
import type { ConnectedLinkedIn } from './linkedin-oauth';

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
  // Permissões que a pessoa concedeu no Instagram (a de insights é opcional).
  scopes: string[];
};

const COLUMNS = 'id,channel,handle,status,expires_at,connected_at,scopes';

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
    scopes: Array.isArray(r.scopes) ? (r.scopes as unknown[]).map(String) : [],
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
    .select('id,handle,channel')
    .maybeSingle();
  if (error) throw new Error(`social_accounts: ${error.message}`);
  if (!data) return false;
  await auditSafely(t, userId, 'social_account.disconnected', id, (data.handle as string | null) ?? null, data.channel === 'linkedin' ? 'linkedin' : 'instagram');
  return true;
}

async function auditSafely(t: TenantDb, userId: string | null, action: string, id: string, handle: string | null, channel: 'instagram' | 'linkedin' = 'instagram'): Promise<void> {
  try {
    await auditTenant(t, { actorUserId: userId, action, targetType: 'social_account', targetId: id, metadata: { channel, handle } });
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

  const token = await openToken(String(data.id), box);
  return { accountId: String(data.external_id), token };
}

// Decifra o token de uma conta. Quem chama já escolheu a conta; aqui só falta o segredo.
async function openToken(accountId: string, box?: SecretBox): Promise<string> {
  const secret = await system().from('social_account_secrets').select('access_token_ciphertext').eq('social_account_id', accountId).maybeSingle();
  if (secret.error) throw new Error(`social_account_secrets: ${secret.error.message}`);
  if (!secret.data) throw new UserError('O acesso ao Instagram não foi encontrado. Reconecte em Configurações, Redes.');
  return (box ?? kmsBox()).open({ ciphertext: String(secret.data.access_token_ciphertext) }, socialTokenContext(accountId));
}

// ── Renovação (SPEC 011 R5.3): job de sistema, atravessa as contas de propósito ──────────────

export type RefreshTarget = {
  id: string;
  tenantId: string;
  handle: string | null;
  status: SocialAccountStatus;
  expiresAt: string | null;
  refreshedAt: string | null;
  connectedAt: string | null;
};

const REFRESH_BATCH = 200;

// Contas de Instagram ativas que vencem dentro da janela (ou já venceram e seguem marcadas como ativas).
export async function listRefreshTargets(nowMs: number = Date.now()): Promise<RefreshTarget[]> {
  const horizon = new Date(nowMs + REFRESH_WINDOW_DAYS * 86_400_000).toISOString();
  const { data, error } = await system()
    .from('social_accounts')
    .select('id,tenant_id,handle,status,expires_at,refreshed_at,connected_at')
    .eq('channel', 'instagram')
    .eq('status', 'active')
    .lte('expires_at', horizon)
    .order('expires_at', { ascending: true })
    .limit(REFRESH_BATCH);
  if (error) throw new Error(`social_accounts: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: String(r.id),
    tenantId: String(r.tenant_id),
    handle: (r.handle as string | null) ?? null,
    status: r.status as SocialAccountStatus,
    expiresAt: iso(r.expires_at),
    refreshedAt: iso(r.refreshed_at),
    connectedAt: iso(r.connected_at),
  }));
}

export async function openAccountToken(accountId: string, box?: SecretBox): Promise<string> {
  return openToken(accountId, box);
}

// Grava o token renovado e o novo prazo, numa transação só. Só mexe em conta ainda ativa: uma conta
// desconectada no meio da renovação não volta a ter token. Devolve false quando não havia o que atualizar.
export async function saveRefreshedToken(
  target: Pick<RefreshTarget, 'id' | 'tenantId'>,
  fresh: { accessToken: string; expiresAt: Date },
  box: SecretBox = kmsBox(),
): Promise<boolean> {
  const sealed = await box.seal(fresh.accessToken, socialTokenContext(target.id));
  const client = system();
  if (!client.transaction) throw new Error('banco sem suporte a transação');
  return client.transaction(async (tx) => {
    const updated = await tenantDb(target.tenantId, tx)
      .update('social_accounts', { expires_at: fresh.expiresAt.toISOString(), refreshed_at: new Date().toISOString() })
      .eq('id', target.id)
      .eq('status', 'active')
      .select('id')
      .maybeSingle();
    if (updated.error) throw new Error(`social_accounts: ${updated.error.message}`);
    if (!updated.data) return false;
    const secret = await tx
      .from('social_account_secrets')
      .upsert({ social_account_id: target.id, access_token_ciphertext: sealed.ciphertext, refresh_token_ciphertext: null, key_version: sealed.keyVersion }, { onConflict: 'social_account_id' });
    if (secret.error) throw new Error(`social_account_secrets: ${secret.error.message}`);
    return true;
  });
}

// A conta precisa ser reconectada. Não passa por `revoked` (que apaga o token): a pessoa reconecta
// com um clique e o token novo entra na mesma linha. Devolve true só na troca de ativo para reconectar,
// para o aviso sair uma vez.
export async function markReauthRequired(target: Pick<RefreshTarget, 'id' | 'tenantId'>, reason: string): Promise<boolean> {
  const { data, error } = await tenantDb(target.tenantId)
    .update('social_accounts', { status: 'reauth_required', status_reason: reason.slice(0, 200) })
    .eq('id', target.id)
    .eq('status', 'active')
    .select('id')
    .maybeSingle();
  if (error) throw new Error(`social_accounts: ${error.message}`);
  return Boolean(data);
}

// ── Métricas (BEZ-183): job de sistema, atravessa as contas de propósito ─────────────────────

export type MetricsAccount = { id: string; tenantId: string; externalId: string; scopes: string[] };

// Contas de Instagram ativas, com as permissões que a pessoa concedeu (a de insights é opcional).
export async function listMetricsAccounts(): Promise<MetricsAccount[]> {
  const { data, error } = await system()
    .from('social_accounts')
    .select('id,tenant_id,external_id,scopes')
    .eq('channel', 'instagram')
    .eq('status', 'active')
    .order('connected_at', { ascending: false })
    .limit(REFRESH_BATCH);
  if (error) throw new Error(`social_accounts: ${error.message}`);
  // Uma conta da Ekoai com duas conexões ativas usa a mais recente, como a publicação.
  const seen = new Set<string>();
  const out: MetricsAccount[] = [];
  for (const r of data ?? []) {
    const tenantId = String(r.tenant_id);
    if (seen.has(tenantId)) continue;
    seen.add(tenantId);
    out.push({ id: String(r.id), tenantId, externalId: String(r.external_id), scopes: Array.isArray(r.scopes) ? (r.scopes as unknown[]).map(String) : [] });
  }
  return out;
}

// ── Callbacks da Meta (SPEC 011 R5.4, BEZ-215): a Meta diz qual conta do Instagram saiu ──────

export type RevokedAccount = { id: string; tenantId: string; handle: string | null };

// Revoga toda conexão ativa (ou que precisa reconectar) desse usuário do Instagram, em qualquer conta da
// Ekoai. O gatilho da 0018 apaga o token na mesma operação. Já revogada fica de fora.
export async function revokeInstagramByExternalId(externalId: string, reason: 'meta_deauthorized' | 'meta_data_deletion'): Promise<RevokedAccount[]> {
  const { data, error } = await system()
    .from('social_accounts')
    .update({ status: 'revoked', status_reason: reason })
    .eq('channel', 'instagram')
    .eq('external_id', externalId)
    .neq('status', 'revoked')
    .select('id,tenant_id,handle');
  if (error) throw new Error(`social_accounts: ${error.message}`);
  return (data ?? []).map((r) => ({ id: String(r.id), tenantId: String(r.tenant_id), handle: (r.handle as string | null) ?? null }));
}

// ── LinkedIn (SPEC 028, BEZ-423): perfil pessoal, uma conexão por conta da Ekoai ──────────────────

export type LinkedInCredentials = { token: string; authorUrn: string };

// Grava a conexão do LinkedIn (nova ou a mesma reconectada) com o token e, se o LinkedIn deu, o refresh token, cifrados, numa transação só.
// Conectar outro perfil substitui o anterior: a conta da Ekoai tem um LinkedIn por vez (o anterior é revogado e perde o token).
export async function saveLinkedInConnection(
  t: TenantDb,
  input: { userId: string | null; connected: ConnectedLinkedIn },
  box: SecretBox = kmsBox(),
): Promise<{ id: string; handle: string | null }> {
  const { connected } = input;
  const live = await t.select('social_accounts', 'id,external_id').eq('channel', 'linkedin').neq('status', 'revoked');
  if (live.error) throw new Error(`social_accounts: ${live.error.message}`);
  const rows = (live.data ?? []) as { id: string; external_id: string }[];
  const same = rows.find((r) => String(r.external_id) === connected.profile.memberId);
  const replaced = rows.filter((r) => r !== same).map((r) => String(r.id));
  const id = same ? String(same.id) : randomUUID();
  const context = socialTokenContext(id);
  const sealed = await box.seal(connected.accessToken, context);
  const sealedRefresh = connected.refreshToken ? await box.seal(connected.refreshToken, context) : null;

  const client = system();
  if (!client.transaction) throw new Error('banco sem suporte a transação');
  await client.transaction(async (tx) => {
    const scoped = tenantDb(t.tenantId, tx);
    for (const old of replaced) {
      const revoked = await scoped.update('social_accounts', { status: 'revoked', status_reason: 'replaced' }).eq('id', old);
      if (revoked.error) throw new Error(`social_accounts: ${revoked.error.message}`);
    }
    const fields = {
      handle: connected.profile.name,
      status: 'active',
      status_reason: null,
      scopes: connected.scopes,
      expires_at: connected.expiresAt.toISOString(),
      connected_by: input.userId,
      refreshed_at: new Date().toISOString(),
    };
    const saved = same
      ? await scoped.update('social_accounts', fields).eq('id', id)
      : await scoped.insert('social_accounts', { id, channel: 'linkedin', external_id: connected.profile.memberId, ...fields });
    if (saved.error) throw saved.error.code === '23505' ? new LinkedInConnectError('taken') : new Error(`social_accounts: ${saved.error.message}`);
    const secret = await tx
      .from('social_account_secrets')
      .upsert({ social_account_id: id, access_token_ciphertext: sealed.ciphertext, refresh_token_ciphertext: sealedRefresh?.ciphertext ?? null, key_version: sealed.keyVersion }, { onConflict: 'social_account_id' });
    if (secret.error) throw new Error(`social_account_secrets: ${secret.error.message}`);
  });

  await auditSafely(t, input.userId, 'social_account.connected', id, connected.profile.name, 'linkedin');
  return { id, handle: connected.profile.name };
}

// O que a publicação usa: o LinkedIn ativo desta conta da Ekoai, com o autor do post. Sem conexão, ou vencido, falha com o próximo
// passo e nunca cai no token de outra conta.
export async function linkedinCredentials(t: TenantDb, box?: SecretBox, nowMs: number = Date.now()): Promise<LinkedInCredentials> {
  const { data, error } = await t
    .select('social_accounts', 'id,external_id,expires_at')
    .eq('channel', 'linkedin')
    .eq('status', 'active')
    .order('connected_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`social_accounts: ${error.message}`);
  if (!data) throw new UserError('Nenhum LinkedIn conectado. Conecte em Configurações, Redes.');
  const expires = iso(data.expires_at);
  if (expires && new Date(expires).getTime() <= nowMs) throw new UserError('A conexão do LinkedIn venceu. Reconecte em Configurações, Redes.');
  const token = await openToken(String(data.id), box);
  return { token, authorUrn: linkedinAuthorUrn(String(data.external_id)) };
}

export type LinkedInRefreshTarget = RefreshTarget & { hasRefreshToken: boolean; expiringNotified: boolean };

// Contas de LinkedIn ativas que vencem dentro da janela (ou já venceram e seguem ativas), com a marca de "já avisei" e se há refresh token.
export async function listLinkedInRefreshTargets(nowMs: number = Date.now()): Promise<LinkedInRefreshTarget[]> {
  const horizon = new Date(nowMs + LINKEDIN_REFRESH_WINDOW_DAYS * 86_400_000).toISOString();
  const { data, error } = await system()
    .from('social_accounts')
    .select('id,tenant_id,handle,status,status_reason,expires_at,refreshed_at,connected_at')
    .eq('channel', 'linkedin')
    .eq('status', 'active')
    .lte('expires_at', horizon)
    .order('expires_at', { ascending: true })
    .limit(REFRESH_BATCH);
  if (error) throw new Error(`social_accounts: ${error.message}`);
  const rows = data ?? [];
  const withRefresh = new Set<string>();
  if (rows.length) {
    const secrets = await system().from('social_account_secrets').select('social_account_id').in('social_account_id', rows.map((r) => String(r.id))).not('refresh_token_ciphertext', 'is', null);
    if (secrets.error) throw new Error(`social_account_secrets: ${secrets.error.message}`);
    for (const s of secrets.data ?? []) withRefresh.add(String(s.social_account_id));
  }
  return rows.map((r) => ({
    id: String(r.id),
    tenantId: String(r.tenant_id),
    handle: (r.handle as string | null) ?? null,
    status: r.status as SocialAccountStatus,
    expiresAt: iso(r.expires_at),
    refreshedAt: iso(r.refreshed_at),
    connectedAt: iso(r.connected_at),
    hasRefreshToken: withRefresh.has(String(r.id)),
    expiringNotified: r.status_reason === LINKEDIN_EXPIRING_REASON,
  }));
}

// O refresh token decifrado de uma conta; null quando o LinkedIn não deu um.
export async function openAccountRefreshToken(accountId: string, box?: SecretBox): Promise<string | null> {
  const secret = await system().from('social_account_secrets').select('refresh_token_ciphertext').eq('social_account_id', accountId).maybeSingle();
  if (secret.error) throw new Error(`social_account_secrets: ${secret.error.message}`);
  const ciphertext = secret.data?.refresh_token_ciphertext;
  if (!ciphertext) return null;
  return (box ?? kmsBox()).open({ ciphertext: String(ciphertext) }, socialTokenContext(accountId));
}

// Grava o token renovado, o refresh token (o novo, ou o anterior) e o prazo novo, numa transação só. Só mexe em conta ainda ativa.
export async function saveRefreshedLinkedIn(
  target: Pick<RefreshTarget, 'id' | 'tenantId'>,
  fresh: { accessToken: string; expiresAt: Date; refreshToken: string | null },
  box: SecretBox = kmsBox(),
): Promise<boolean> {
  const context = socialTokenContext(target.id);
  const sealed = await box.seal(fresh.accessToken, context);
  const sealedRefresh = fresh.refreshToken ? await box.seal(fresh.refreshToken, context) : null;
  const client = system();
  if (!client.transaction) throw new Error('banco sem suporte a transação');
  return client.transaction(async (tx) => {
    const updated = await tenantDb(target.tenantId, tx)
      .update('social_accounts', { expires_at: fresh.expiresAt.toISOString(), refreshed_at: new Date().toISOString(), status_reason: null })
      .eq('id', target.id)
      .eq('status', 'active')
      .select('id')
      .maybeSingle();
    if (updated.error) throw new Error(`social_accounts: ${updated.error.message}`);
    if (!updated.data) return false;
    const secret = await tx
      .from('social_account_secrets')
      .upsert({ social_account_id: target.id, access_token_ciphertext: sealed.ciphertext, refresh_token_ciphertext: sealedRefresh?.ciphertext ?? null, key_version: sealed.keyVersion }, { onConflict: 'social_account_id' });
    if (secret.error) throw new Error(`social_account_secrets: ${secret.error.message}`);
    return true;
  });
}

// Marca que o aviso de vencimento já saiu, para não repetir todo dia. Devolve true só na primeira vez.
export async function markExpiringNotified(target: Pick<RefreshTarget, 'id' | 'tenantId'>): Promise<boolean> {
  const { data, error } = await tenantDb(target.tenantId)
    .update('social_accounts', { status_reason: LINKEDIN_EXPIRING_REASON })
    .eq('id', target.id)
    .eq('status', 'active')
    .is('status_reason', null)
    .select('id')
    .maybeSingle();
  if (error) throw new Error(`social_accounts: ${error.message}`);
  return Boolean(data);
}
