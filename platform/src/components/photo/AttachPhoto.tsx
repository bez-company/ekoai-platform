'use client';

// AttachPhoto.tsx: o bloco "Anexar foto" do Criar post (SPEC 017 decisão 7, simplificado na SPEC 025). A pessoa sobe
// uma foto ou escolhe do banco e ela já é o visual do post: sem perguntas, a Ekoai escreve a legenda olhando a foto
// (uso `as_is`). Quem usa: components/posts/CreatePostForm, que manda asset_id e photo_usage.

import { useCallback, useEffect, useRef, useState } from 'react';
import Modal from '@/components/Modal';
import MediaPicker from '@/components/media/MediaPicker';
import { useUploadPhotos } from '@/components/media/useUploadPhotos';
import { UploadIcon } from '@/components/media/UploadParts';
import { ErrorLine, Spinner } from '@/components/auth/ui';
import type { MediaAsset } from '@/lib/media-asset-model';
import { blockedReason, photoTitle, toPicked, type PickedPhoto } from '@/lib/media-view';
import type { AttachedPhoto } from './attach-photo-model';

export type { AttachedPhoto } from './attach-photo-model';

export default function AttachPhoto({ value, onChange, disabled, initialAssetId = null }: { idea?: string; value: AttachedPhoto | null; onChange: (v: AttachedPhoto | null) => void; disabled?: boolean; initialAssetId?: string | null }) {
  const [photo, setPhoto] = useState<PickedPhoto | null>(null);
  const [picker, setPicker] = useState(false);
  const [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const started = useRef(false);

  // A foto anexada já é o visual do post (SPEC 025, decisão 2): sem perguntas, a Ekoai só escreve a legenda olhando a foto.
  const choose = useCallback(
    (p: PickedPhoto) => {
      setPicker(false);
      setError('');
      const blocked = blockedReason(p);
      if (blocked) {
        setPhoto(null);
        setError(blocked);
        onChange(null);
        return;
      }
      setPhoto(p);
      onChange({ assetId: p.id, url: p.url, usage: 'as_is', text: null, ready: true });
    },
    [onChange],
  );

  const { busy: uploading, upload, items } = useUploadPhotos(
    useCallback((a: MediaAsset) => choose(toPicked(a)), [choose]),
  );
  const uploadError = items.find((i) => i.status === 'error')?.message;

  // Aberto com ?asset=<id> (atalho do banco de imagens): busca a foto e segue como se tivesse escolhido.
  useEffect(() => {
    if (!initialAssetId || started.current) return;
    started.current = true;
    void (async () => {
      const res = await fetch(`/api/media-assets/${initialAssetId}`).catch(() => null);
      const j = res?.ok ? await res.json().catch(() => null) : null;
      if (j?.asset) choose(toPicked(j.asset));
      else setError('A foto escolhida não está mais no banco de imagens. Escolha outra.');
    })();
  }, [initialAssetId, choose]);

  function remove() {
    setPhoto(null);
    setError('');
    onChange(null);
  }

  return (
    <div className="space-y-3">
      {!photo && !value && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-ghost min-h-9 px-3 text-xs" disabled={disabled || uploading} onClick={() => fileInput.current?.click()}>
            {uploading ? <Spinner /> : <UploadIcon size={16} />}
            {uploading ? 'Enviando a foto' : 'Anexar foto'}
          </button>
          <button type="button" className="btn-ghost min-h-9 px-3 text-xs" disabled={disabled} onClick={() => setPicker(true)}>
            Escolher do banco
          </button>
          <input ref={fileInput} type="file" accept="image/jpeg,image/png" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => e.target.files?.length && void upload(e.target.files)} />
        </div>
      )}
      {(error || uploadError) && <ErrorLine>{error || uploadError}</ErrorLine>}

      {photo && (
        <div className="flex items-center gap-3 rounded-lg border border-line bg-inset p-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photo.thumbUrl} alt="" className="h-14 w-14 shrink-0 rounded-md object-cover" />
          <div className="min-w-0 flex-1 text-sm">
            <strong className="block truncate">{photoTitle(photo)}</strong>
            <span className="text-muted">A Ekoai escreve a legenda olhando a foto. Não gera imagem e não conta no limite do plano.</span>
          </div>
          <button type="button" className="btn-ghost min-h-9 px-3 text-xs" disabled={disabled} onClick={() => setPicker(true)}>
            Trocar
          </button>
          <button type="button" className="btn-ghost min-h-9 px-3 text-xs" aria-label="Tirar a foto" disabled={disabled} onClick={remove}>
            Tirar
          </button>
        </div>
      )}

      {picker && (
        <Modal title="Escolher do banco de imagens" onClose={() => setPicker(false)}>
          <div className="max-h-[60vh] overflow-y-auto pr-1">
            <MediaPicker selectedId={photo?.id ?? null} onSelect={(p) => choose(p)} />
          </div>
          <div className="flex justify-end">
            <button type="button" className="btn-ghost" onClick={() => setPicker(false)}>
              Fechar
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
