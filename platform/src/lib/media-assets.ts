// media-assets.ts: o banco de imagens da empresa (SPEC 017 decisão 9, BEZ-198). A foto mora no bucket
// privado, em `tenants/<conta>/media/<uuid>.<jpg|png>`, e só sai por rota com sessão
// (GET /api/media-assets/<id>/file). Para virar post, a plataforma copia a foto para `images/<uuid>`
// e entrega a URL de /api/media (ADR 0009), que o Instagram busca ao publicar. Quando o post sai,
// publish.ts marca a foto como usada.
//
// A descrição vem do modelo de visão logo depois do upload; se a visão falhar, a foto fica sem
// descrição (a pessoa pode escrever) e o upload não falha por isso. A descrição não conta no limite
// de posts do plano: só o visual gerado conta (migration 0023).

import { randomUUID } from 'node:crypto';
import type { TenantDb } from './tenant-db';
import type { SessionUser } from './accounts';
import { UserError } from './errors';
import { auditTenant } from './audit';
import { log } from './log';
import { defaultStore, type BlobStore } from './brand-logo';
import { vertexClient, type ModelClient } from './vertex';
import {
  MEDIA_MAX_PER_ACCOUNT,
  mediaAssetKey,
  parseVisionResult,
  toMediaAsset,
  visionPrompt,
  type InspectedPhoto,
  type MediaAsset,
  type MediaListQuery,
  type MediaPatch,
} from './media-asset-model';

const COLUMNS = 'id,storage_path,content_type,byte_size,width,height,original_name,description,tags,has_people,people_consent,described_at,used_at,used_post_id,created_at';

export type UploadedPhoto = { photo: Extract<InspectedPhoto, { ok: true }>; name: string | null };
export type MediaDeps = { store?: BlobStore; models?: ModelClient | null; mediaBaseUrl?: string };

const publicUrl = (key: string, base = process.env.MEDIA_BASE_URL ?? '/api/media') => `${base.replace(/\/$/, '')}/${key}`;

async function row(t: TenantDb, id: string): Promise<Record<string, unknown> | null> {
  const res = await t.select('media_assets', COLUMNS).eq('id', id).maybeSingle();
  if (res.error) throw new Error(`banco de imagens: ${res.error.message}`);
  return res.data;
}

export async function listMediaAssets(t: TenantDb, query: MediaListQuery): Promise<MediaAsset[]> {
  let q = t.select('media_assets', COLUMNS);
  if (query.filter === 'unused') q = q.is('used_at', null);
  if (query.filter === 'used') q = q.not('used_at', 'is', null);
  // A conta tem no máximo MEDIA_MAX_PER_ACCOUNT fotos: a etiqueta filtra aqui, sem operador de array no query builder.
  const res = await q.order('created_at', { ascending: false }).limit(MEDIA_MAX_PER_ACCOUNT);
  if (res.error) throw new Error(`banco de imagens: ${res.error.message}`);
  const assets = (res.data ?? []).map(toMediaAsset);
  return (query.tag ? assets.filter((a) => a.tags.includes(query.tag!)) : assets).slice(0, query.limit);
}

export async function getMediaAsset(t: TenantDb, id: string): Promise<MediaAsset | null> {
  const r = await row(t, id);
  return r ? toMediaAsset(r) : null;
}

// Bytes da foto, para a rota autenticada, a visão e o corte do "publicar foto" (BEZ-236).
export async function readMediaAssetBytes(t: TenantDb, id: string, store: BlobStore = defaultStore()): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  const r = await row(t, id);
  if (!r) return null;
  return { bytes: await store.get(String(r.storage_path)), contentType: String(r.content_type) };
}

async function niche(t: TenantDb): Promise<string | null> {
  const res = await t.select('company_profiles', 'niche').maybeSingle();
  return res.error || !res.data ? null : ((res.data.niche as string | null) ?? null);
}

// Descreve uma foto pelo modelo de visão e grava. Falha vai para o log e devolve false.
export async function describeMediaAsset(t: TenantDb, id: string, deps: MediaDeps = {}): Promise<boolean> {
  const store = deps.store ?? defaultStore();
  try {
    const models = deps.models === undefined ? vertexClient() : deps.models;
    if (!models) return false;
    const file = await readMediaAssetBytes(t, id, store);
    if (!file) return false;
    const out = await models.generateJson({
      prompt: visionPrompt(await niche(t)),
      image: { bytes: file.bytes, mimeType: file.contentType },
      labels: { tenant: t.tenantId, step: 'media_describe' },
      maxOutputTokens: 400,
      temperature: 0.2,
    });
    const vision = parseVisionResult(out.json);
    if (!vision) throw new Error('a visão não devolveu descrição');
    const upd = await t
      .update('media_assets', { description: vision.description, tags: vision.tags, has_people: vision.hasPeople, described_at: new Date().toISOString() })
      .eq('id', id);
    if (upd.error) throw new Error(upd.error.message);
    log('info', 'media-assets', 'foto descrita', { tenant: t.tenantId, asset: id, costUsd: out.costUsd, inputTokens: out.inputTokens, outputTokens: out.outputTokens });
    return true;
  } catch (e) {
    log('warn', 'media-assets', 'não descreveu a foto', { tenant: t.tenantId, asset: id, error: e instanceof Error ? e.message : String(e) });
    return false;
  }
}

// Sobe as fotos (já inspecionadas: tipo, tamanho e metadados limpos) e descreve cada uma.
export async function saveMediaAssets(t: TenantDb, actor: SessionUser | null, photos: UploadedPhoto[], deps: MediaDeps = {}): Promise<MediaAsset[]> {
  const store = deps.store ?? defaultStore();
  const count = await t.select('media_assets', 'id', { count: 'exact', head: true });
  if (count.error) throw new Error(`banco de imagens: ${count.error.message}`);
  if ((count.count ?? 0) + photos.length > MEDIA_MAX_PER_ACCOUNT) {
    throw new UserError(`O banco de imagens guarda até ${MEDIA_MAX_PER_ACCOUNT} fotos e já tem ${count.count ?? 0}. Apague as que não usa e envie de novo.`);
  }

  const ids: string[] = [];
  for (const { photo, name } of photos) {
    const id = randomUUID();
    const key = mediaAssetKey(t.tenantId, id, photo.ext);
    await store.put(key, photo.bytes, photo.contentType);
    const ins = await t.insert('media_assets', {
      id,
      storage_path: key,
      content_type: photo.contentType,
      byte_size: photo.bytes.length,
      width: photo.width,
      height: photo.height,
      original_name: name,
      created_by: actor?.id ?? null,
    });
    if (ins.error) {
      await store.remove(key).catch(() => undefined);
      throw new Error(`banco de imagens: ${ins.error.message}`);
    }
    ids.push(id);
  }
  await auditTenant(t, { actorUserId: actor?.id ?? null, action: 'media.uploaded', targetType: 'media_asset', targetId: ids[0], metadata: { count: ids.length } });

  // A visão roda em paralelo, de 4 em 4, e não derruba o upload.
  for (let i = 0; i < ids.length; i += 4) {
    await Promise.all(ids.slice(i, i + 4).map((id) => describeMediaAsset(t, id, { ...deps, store })));
  }
  const saved = await Promise.all(ids.map((id) => getMediaAsset(t, id)));
  return saved.filter((a): a is MediaAsset => a !== null);
}

export async function updateMediaAsset(t: TenantDb, actor: SessionUser | null, id: string, patch: MediaPatch): Promise<MediaAsset> {
  const res = await t.update('media_assets', patch).eq('id', id).select('id').maybeSingle();
  if (res.error) throw new Error(`banco de imagens: ${res.error.message}`);
  if (!res.data) throw new UserError('Esta foto não está mais no banco de imagens.');
  if ('people_consent' in patch) {
    await auditTenant(t, { actorUserId: actor?.id ?? null, action: 'media.consent_changed', targetType: 'media_asset', targetId: id, metadata: { consent: patch.people_consent } });
  }
  return (await getMediaAsset(t, id))!;
}

// Apaga a foto do banco. Post já publicado não muda: ele usa a cópia em images/.
export async function deleteMediaAsset(t: TenantDb, actor: SessionUser | null, id: string, store: BlobStore = defaultStore()): Promise<void> {
  const r = await row(t, id);
  if (!r) return;
  const del = await t.delete('media_assets').eq('id', id);
  if (del.error) throw new Error(`banco de imagens: ${del.error.message}`);
  await store.remove(String(r.storage_path)).catch((e) => log('error', 'media-assets', 'não apagou o arquivo da foto', { object: r.storage_path, error: e instanceof Error ? e.message : String(e) }));
  await auditTenant(t, { actorUserId: actor?.id ?? null, action: 'media.deleted', targetType: 'media_asset', targetId: id });
}

// Cópia pública da foto para publicar (ADR 0009): `images/<uuid>.<ext>`, servida por /api/media.
// `bytes` = a foto já cortada no formato do post (BEZ-236); sem ela, vai a foto inteira.
export async function publishableMediaUrl(
  t: TenantDb,
  id: string,
  options: { bytes?: Uint8Array; contentType?: 'image/jpeg' | 'image/png' } & MediaDeps = {},
): Promise<{ url: string; key: string }> {
  const store = options.store ?? defaultStore();
  const r = await row(t, id);
  if (!r) throw new UserError('Esta foto não está mais no banco de imagens.');
  const asset = toMediaAsset(r);
  if (asset.hasPeople === true && !asset.peopleConsent) {
    throw new UserError('A foto mostra pessoas. Marque que há autorização de uso de imagem antes de publicar.');
  }
  const contentType = options.bytes ? (options.contentType ?? asset.contentType) : asset.contentType;
  const bytes = options.bytes ?? (await store.get(String(r.storage_path)));
  const key = `images/${randomUUID()}.${contentType === 'image/png' ? 'png' : 'jpg'}`;
  await store.put(key, bytes, contentType);
  return { url: publicUrl(key, options.mediaBaseUrl), key };
}

// O post com a foto saiu: marca a foto como usada (a última vez e o post).
export async function markMediaAssetUsed(t: TenantDb, id: string, postId: string | null): Promise<void> {
  const res = await t.update('media_assets', { used_at: new Date().toISOString(), used_post_id: postId }).eq('id', id);
  if (res.error) throw new Error(`banco de imagens: ${res.error.message}`);
}
