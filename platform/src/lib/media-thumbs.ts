// media-thumbs.ts: a miniatura das fotos do banco de imagens (BEZ-253). Nasce na primeira leitura: a
// rota gera a partir da original, guarda no bucket privado e serve a guardada dali em diante. Assim o
// envio continua rápido e as fotos de antes da miniatura também ganham a sua. Falha ao guardar não
// impede de servir a que acabou de ser gerada.

import type { TenantDb } from './tenant-db';
import { log } from './log';
import { defaultStore, type BlobStore } from './brand-logo';
import { getMediaAsset, readMediaAssetBytes } from './media-assets';
import { mediaThumbKey } from './media-asset-model';
import { photoSource } from './photo-post';
import { renderThumb } from './design/thumb';

export async function readThumb(t: TenantDb, id: string, store: BlobStore = defaultStore()): Promise<Uint8Array | null> {
  const key = mediaThumbKey(t.tenantId, id);
  const asset = await getMediaAsset(t, id);
  if (!asset) return null;
  const cached = await store.get(key).catch(() => null);
  if (cached && cached.length) return cached;

  const file = await readMediaAssetBytes(t, id, store);
  if (!file) return null;
  const thumb = renderThumb({ bytes: file.bytes, contentType: asset.contentType, ...photoSource(asset, file.bytes) });
  await store.put(key, thumb.jpeg, 'image/jpeg').catch((e) => log('warn', 'media-thumbs', 'não guardou a miniatura; gera de novo na próxima', { asset: id, error: e instanceof Error ? e.message : String(e) }));
  return thumb.jpeg;
}
