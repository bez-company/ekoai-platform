// brand-logo.ts: o logo da empresa (SPEC 011 R3, ADR 0014). O arquivo mora no bucket privado, em
// `tenants/<conta>/logo/<uuid>.<png|svg>`, e só sai por uma rota que confere a sessão
// (GET /api/brand/logo): nunca por /api/media, que é pública. A linha em `brand_assets` guarda o
// caminho, o tipo e o tamanho; `company_profiles.logo_asset_id` aponta para o logo atual.
// Tudo pelo tenantDb, e a ordem das escritas respeita a FK: o perfil deixa de apontar para o logo
// antigo ANTES de a linha dele sair.

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import type { TenantDb } from './tenant-db';
import type { SessionUser } from './accounts';
import { UserError } from './errors';
import { auditTenant } from './audit';
import { log } from './log';
import { logoKey, type InspectedLogo } from './logo-model';
import { mediaBucket, mediaFile } from './media';

// O que o armazenamento precisa saber fazer. O de verdade é o Cloud Storage; os testes passam um
// de memória.
export type BlobStore = {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  remove(key: string): Promise<void>;
  // Apaga tudo debaixo de um prefixo (a exclusão da conta apaga `tenants/<conta>/`).
  removePrefix(prefix: string): Promise<void>;
};

export const gcsStore: BlobStore = {
  async put(key, bytes, contentType) {
    await mediaFile(key).save(Buffer.from(bytes), { contentType, resumable: false, metadata: { cacheControl: 'private, max-age=0' } });
  },
  async get(key) {
    const [data] = await mediaFile(key).download();
    return new Uint8Array(data);
  },
  async remove(key) {
    await mediaFile(key).delete({ ignoreNotFound: true });
  },
  async removePrefix(prefix) {
    await mediaBucket().deleteFiles({ prefix, force: true });
  },
};

// Só para desenvolver e testar no navegador sem Cloud Storage: LOCAL_BLOB_DIR guarda os arquivos numa
// pasta. Em produção a variável é ignorada.
export function localStore(dir: string): BlobStore {
  const path = (key: string) => {
    const full = normalize(join(dir, key));
    if (!full.startsWith(normalize(dir))) throw new Error('chave fora da pasta');
    return full;
  };
  return {
    async put(key, bytes) {
      await mkdir(dirname(path(key)), { recursive: true });
      await writeFile(path(key), bytes);
    },
    async get(key) {
      return new Uint8Array(await readFile(path(key)));
    },
    async remove(key) {
      await rm(path(key), { force: true });
    },
    async removePrefix(prefix) {
      await rm(path(prefix), { recursive: true, force: true });
    },
  };
}

export function defaultStore(env: Record<string, string | undefined> = process.env): BlobStore {
  return env.LOCAL_BLOB_DIR && env.NODE_ENV !== 'production' ? localStore(env.LOCAL_BLOB_DIR) : gcsStore;
}

export type LogoAsset = { id: string; path: string; contentType: string; byteSize: number };

// A principal mais três variações opcionais (SPEC 026): a Ekoai escolhe pelo fundo do post (design/logo-pick.ts).
export const LOGO_VARIANTS = ['main', 'dark', 'light', 'symbol'] as const;
export type LogoVariant = (typeof LOGO_VARIANTS)[number];
export const isLogoVariant = (v: unknown): v is LogoVariant => typeof v === 'string' && (LOGO_VARIANTS as readonly string[]).includes(v);

const assetOf = (row: Record<string, unknown>): LogoAsset => ({ id: String(row.id), path: String(row.storage_path), contentType: String(row.content_type), byteSize: Number(row.byte_size) });

// A variação (não a principal) guardada em brand_assets, ou null.
async function variantAsset(t: TenantDb, variant: Exclude<LogoVariant, 'main'>): Promise<LogoAsset | null> {
  const row = await t.select('brand_assets', 'id,storage_path,content_type,byte_size').eq('variant', variant).maybeSingle();
  if (row.error) throw new Error(`logo: ${row.error.message}`);
  return row.data ? assetOf(row.data) : null;
}

async function currentAsset(t: TenantDb): Promise<{ hasProfile: boolean; asset: LogoAsset | null }> {
  const profile = await t.select('company_profiles', 'logo_asset_id').maybeSingle();
  if (profile.error) throw new Error(`perfil: ${profile.error.message}`);
  if (!profile.data) return { hasProfile: false, asset: null };
  const id = profile.data.logo_asset_id as string | null;
  if (!id) return { hasProfile: true, asset: null };
  const row = await t.select('brand_assets', 'id,storage_path,content_type,byte_size').eq('id', id).maybeSingle();
  if (row.error) throw new Error(`logo: ${row.error.message}`);
  if (!row.data) return { hasProfile: true, asset: null };
  return {
    hasProfile: true,
    asset: { id: String(row.data.id), path: String(row.data.storage_path), contentType: String(row.data.content_type), byteSize: Number(row.data.byte_size) },
  };
}

async function dropAsset(t: TenantDb, asset: LogoAsset, store: BlobStore): Promise<void> {
  const del = await t.delete('brand_assets').eq('id', asset.id);
  if (del.error) throw new Error(`logo: ${del.error.message}`);
  // O arquivo é apagado depois da linha; se falhar, sobra um objeto órfão no bucket, e vai para o log.
  await store.remove(asset.path).catch((e) => log('error', 'brand-logo', 'não apagou o arquivo antigo do logo', { object: asset.path, error: e instanceof Error ? e.message : String(e) }));
}

// Troca (ou define) o logo. `logo` já passou por inspectLogo: tipo e bytes confiáveis. Sem `variant` é a principal; uma variação
// só existe com a principal já enviada (é a que vale quando não há uma melhor para o fundo).
export async function saveLogo(t: TenantDb, actor: SessionUser, logo: Extract<InspectedLogo, { ok: true }>, store: BlobStore = defaultStore(), variant: LogoVariant = 'main'): Promise<{ assetId: string }> {
  const { hasProfile, asset: main } = await currentAsset(t);
  if (!hasProfile) throw new UserError('Preencha primeiro a seção Sobre o negócio.');
  if (variant !== 'main' && !main) throw new UserError('Envie primeiro a logo principal. As outras versões vêm depois dela.');
  const previous = variant === 'main' ? main : await variantAsset(t, variant);

  const id = randomUUID();
  const key = logoKey(t.tenantId, id, logo.ext);
  await store.put(key, logo.bytes, logo.contentType);
  try {
    // Variação já enviada: sai antes (o índice só deixa uma por tipo); a principal troca o ponteiro e só então a antiga sai.
    if (variant !== 'main' && previous) {
      const gone = await t.delete('brand_assets').eq('id', previous.id);
      if (gone.error) throw new Error(`logo: ${gone.error.message}`);
    }
    const inserted = await t.insert('brand_assets', { id, kind: 'logo', variant, storage_path: key, content_type: logo.contentType, byte_size: logo.bytes.length, created_by: actor.id });
    if (inserted.error) throw new Error(`logo: ${inserted.error.message}`);
    if (variant === 'main') {
      const point = await t.update('company_profiles', { logo_asset_id: id, updated_by: actor.id });
      if (point.error) throw new Error(`perfil: ${point.error.message}`);
    }
  } catch (e) {
    await t.delete('brand_assets').eq('id', id);
    await store.remove(key).catch(() => undefined);
    throw e;
  }
  if (previous) {
    if (variant === 'main') await dropAsset(t, previous, store);
    else await store.remove(previous.path).catch((err) => log('error', 'brand-logo', 'não apagou o arquivo antigo da variação', { object: previous.path, error: err instanceof Error ? err.message : String(err) }));
  }
  await auditTenant(t, { actorUserId: actor.id, action: 'profile.logo_changed', targetType: 'brand_asset', targetId: id, metadata: { type: logo.contentType, bytes: logo.bytes.length, variant } });
  return { assetId: id };
}

// Tira uma logo. A principal sai e as variações ficam guardadas (o post fica sem logo até enviar outra principal).
export async function removeLogo(t: TenantDb, actor: SessionUser, store: BlobStore = defaultStore(), variant: LogoVariant = 'main'): Promise<void> {
  if (variant !== 'main') {
    const asset = await variantAsset(t, variant);
    if (!asset) return;
    await dropAsset(t, asset, store);
    await auditTenant(t, { actorUserId: actor.id, action: 'profile.logo_removed', targetType: 'brand_asset', targetId: asset.id, metadata: { variant } });
    return;
  }
  const { asset } = await currentAsset(t);
  if (!asset) return;
  const point = await t.update('company_profiles', { logo_asset_id: null, updated_by: actor.id });
  if (point.error) throw new Error(`perfil: ${point.error.message}`);
  await dropAsset(t, asset, store);
  await auditTenant(t, { actorUserId: actor.id, action: 'profile.logo_removed', targetType: 'brand_asset', targetId: asset.id, metadata: { variant: 'main' } });
}

// Lê a logo (a principal, ou a variação pedida) para a rota autenticada. null = a conta não tem essa logo.
export async function readLogo(t: TenantDb, store: BlobStore = defaultStore(), variant: LogoVariant = 'main'): Promise<{ bytes: Uint8Array; contentType: string; assetId: string } | null> {
  const asset = variant === 'main' ? (await currentAsset(t)).asset : await variantAsset(t, variant);
  if (!asset) return null;
  return { bytes: await store.get(asset.path), contentType: asset.contentType, assetId: asset.id };
}

// Quais logos a conta tem, sem baixar os arquivos: a tela mostra o que já foi enviado.
export async function logoStatus(t: TenantDb): Promise<Record<LogoVariant, string | null>> {
  const out: Record<LogoVariant, string | null> = { main: null, dark: null, light: null, symbol: null };
  out.main = (await currentAsset(t)).asset?.id ?? null;
  const rows = await t.select('brand_assets', 'id,variant').neq('variant', 'main');
  if (rows.error) throw new Error(`logo: ${rows.error.message}`);
  for (const r of rows.data ?? []) if (isLogoVariant(r.variant) && r.variant !== 'main') out[r.variant] = String(r.id);
  return out;
}
