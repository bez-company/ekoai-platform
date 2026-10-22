'use client';

// MediaPicker.tsx: escolher uma foto do banco de imagens ou subir na hora (SPEC 017, BEZ-243). Usado no
// Publicar foto e no Criar post (AttachPhoto). Busca a lista sozinho; a foto que acabou de subir já
// sai escolhida. Foto com pessoas sem autorização de uso de imagem fica visível, mas desabilitada, com
// o motivo e o caminho para autorizar.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { MediaAsset } from '@/lib/media-asset-model';
import { blockedReason, toPicked, usedLabel, type PickedPhoto } from '@/lib/media-view';
import { DropZone, UploadList } from './UploadParts';
import { useUploadPhotos } from './useUploadPhotos';

type Load = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; assets: MediaAsset[] };

export default function MediaPicker({ selectedId, onSelect, allowUpload = true }: { selectedId: string | null; onSelect: (photo: PickedPhoto) => void; allowUpload?: boolean }) {
  const [load, setLoad] = useState<Load>({ status: 'loading' });

  const fetchList = useCallback(async () => {
    setLoad({ status: 'loading' });
    try {
      const res = await fetch('/api/media-assets?limit=200');
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error);
      setLoad({ status: 'ready', assets: j.assets ?? [] });
    } catch (e) {
      setLoad({ status: 'error', message: e instanceof Error && e.message ? e.message : 'Não deu para abrir o banco de imagens. Tente de novo.' });
    }
  }, []);

  useEffect(() => {
    void fetchList();
  }, [fetchList]);

  const onUploaded = useCallback(
    (asset: MediaAsset) => {
      setLoad((l) => (l.status === 'ready' ? { status: 'ready', assets: [asset, ...l.assets] } : { status: 'ready', assets: [asset] }));
      const picked = toPicked(asset);
      if (!blockedReason(picked)) onSelect(picked);
    },
    [onSelect],
  );
  const { items, busy, upload } = useUploadPhotos(onUploaded);

  return (
    <div className="space-y-4">
      {allowUpload && <DropZone onFiles={upload} disabled={busy} compact title="Arraste a foto ou clique para escolher" />}
      <UploadList items={items} />
      {load.status === 'loading' && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4" aria-busy="true" aria-label="Carregando o banco de imagens">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="aspect-square animate-pulse rounded-lg bg-inset" />
          ))}
        </div>
      )}
      {load.status === 'error' && (
        <div className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm" role="alert">
          {load.message}{' '}
          <button type="button" className="link" onClick={() => void fetchList()}>
            Tentar de novo
          </button>
        </div>
      )}
      {load.status === 'ready' && load.assets.length === 0 && !items.length && (
        <p className="text-sm text-muted">O banco de imagens ainda está vazio. Envie a primeira foto acima; ela fica guardada para os próximos posts.</p>
      )}
      {load.status === 'ready' && load.assets.length > 0 && (
        <div>
          <p className="mb-2 text-sm text-muted">{allowUpload ? 'Ou escolha do banco de imagens:' : 'Escolha uma foto do banco de imagens:'}</p>
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4" role="listbox" aria-label="Fotos do banco de imagens">
            {load.assets.map((a) => {
              const picked = toPicked(a);
              const blocked = blockedReason(picked);
              const selected = a.id === selectedId;
              return (
                <li key={a.id} role="option" aria-selected={selected} aria-disabled={blocked ? true : undefined}>
                  <button
                    type="button"
                    disabled={!!blocked}
                    onClick={() => onSelect(picked)}
                    title={blocked ?? a.description ?? undefined}
                    aria-label={`${a.description ?? a.originalName ?? 'Foto'}. ${usedLabel(a.usedAt)}${blocked ? `. ${blocked}` : ''}`}
                    className={`group relative block aspect-square w-full overflow-hidden rounded-lg border-2 bg-inset transition ${
                      selected ? 'border-accent-text ring-2 ring-accent/30' : 'border-transparent hover:border-line-strong'
                    } disabled:cursor-not-allowed`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={picked.thumbUrl} alt="" loading="lazy" className={`h-full w-full object-cover ${blocked ? 'opacity-40' : ''}`} />
                    {a.usedAt && <span className="absolute left-1 top-1 rounded-full bg-ink/70 px-1.5 py-0.5 text-[10px] font-semibold text-paper">{usedLabel(a.usedAt)}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
          {load.assets.some((a) => blockedReason(toPicked(a))) && (
            <p className="mt-2 text-xs text-muted">
              As fotos mais claras mostram pessoas e ainda não têm autorização de uso de imagem.{' '}
              <Link href="/media" className="link">
                Autorizar no banco de imagens
              </Link>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
