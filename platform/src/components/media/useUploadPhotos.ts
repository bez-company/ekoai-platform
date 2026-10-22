'use client';

// useUploadPhotos.ts: envia as fotos para o banco de imagens (POST /api/media-assets), uma por pedido,
// duas ao mesmo tempo, para cada foto mostrar o próprio andamento (na fila, enviando, descrita ou o
// erro). O servidor confere o tipo pelos bytes e tira o GPS; aqui só o que dá para saber antes.

import { useCallback, useState } from 'react';
import type { MediaAsset } from '@/lib/media-asset-model';
import { UPLOAD_MAX_FILES, precheckFile } from '@/lib/media-view';

export type UploadItem = { key: string; name: string; status: 'queued' | 'sending' | 'done' | 'error'; message?: string; asset?: MediaAsset };

const CONCURRENCY = 2;

async function sendOne(file: File): Promise<{ asset?: MediaAsset; error?: string }> {
  const form = new FormData();
  form.append('files', file);
  try {
    const res = await fetch('/api/media-assets', { method: 'POST', body: form });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return { error: String(j.error ?? 'Não deu para enviar. Tente de novo.').replace(/^[^:]+: /, '') };
    return { asset: j.assets?.[0] };
  } catch {
    return { error: 'Sem conexão. Confira a internet e envie de novo.' };
  }
}

export function useUploadPhotos(onUploaded: (asset: MediaAsset) => void) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [busy, setBusy] = useState(false);

  const patch = (key: string, values: Partial<UploadItem>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...values } : i)));

  const upload = useCallback(
    async (files: FileList | File[]) => {
      const picked = Array.from(files);
      const stamp = Date.now();
      const queue = picked.map((file, n) => {
        const key = `${stamp}-${n}`;
        const problem = n >= UPLOAD_MAX_FILES ? `Envie até ${UPLOAD_MAX_FILES} fotos de cada vez.` : precheckFile(file);
        return { key, file, item: { key, name: file.name, status: problem ? 'error' : 'queued', message: problem ?? undefined } as UploadItem };
      });
      setItems(queue.map((q) => q.item));
      setBusy(true);
      const pending = queue.filter((q) => q.item.status === 'queued');
      const worker = async () => {
        for (let next = pending.shift(); next; next = pending.shift()) {
          patch(next.key, { status: 'sending' });
          const out = await sendOne(next.file);
          if (out.asset) {
            patch(next.key, { status: 'done', asset: out.asset });
            onUploaded(out.asset);
          } else patch(next.key, { status: 'error', message: out.error });
        }
      };
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
      setBusy(false);
    },
    [onUploaded],
  );

  return { items, busy, upload, clear: () => setItems([]) };
}
