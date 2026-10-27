'use client';

// RemovePublished.tsx: "Tirar da lista" no detalhe de um publicado (BEZ-360). A Ekoai não apaga posts no Instagram
// (a API da Meta não permite): a confirmação diz isso e o que muda aqui.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Modal from '@/components/Modal';
import { ErrorLine, Spinner } from '@/components/auth/ui';

export default function RemovePublished({ id }: { id: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function remove() {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/published/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        setError((await res.json().catch(() => ({}))).error || 'Não deu para tirar o post da lista agora. Tente de novo em instantes.');
        return;
      }
      router.push('/historico');
      router.refresh();
    } catch {
      setError('Sem conexão. Confira a internet e tente de novo.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="btn-ghost" onClick={() => setOpen(true)}>
        Tirar da lista
      </button>
      {open && (
        <Modal title="Tirar este post da lista?" onClose={() => !busy && setOpen(false)}>
          <p className="text-sm text-muted">
            O post sai de Publicados e das médias da Ekoai. Ele continua no Instagram: a Ekoai não consegue apagar posts de lá. Para apagar, abra o post no Instagram.
          </p>
          {error && <ErrorLine>{error}</ErrorLine>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" disabled={busy} onClick={() => setOpen(false)}>
              Cancelar
            </button>
            <button type="button" className="btn-danger" disabled={busy} onClick={() => void remove()}>
              {busy && <Spinner />}
              Tirar da lista
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
