'use client';

// AccountActions.tsx: suspender (com motivo obrigatório) e reativar uma conta no console (BEZ-303).

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Modal from '../Modal';
import { ErrorLine, Spinner } from '../auth/ui';
import { REASON_MAX, REASON_MIN } from '@/lib/console-model';

export default function AccountActions({ id, name, suspended }: { id: string; name: string; suspended: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function close() {
    setOpen(false);
    setReason('');
    setError('');
  }

  async function send(path: 'suspend' | 'reactivate', body?: unknown) {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/console/accounts/${id}/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? 'Não deu para concluir agora. Tente de novo em instantes.');
        return;
      }
      close();
      router.refresh();
    } catch {
      setError('Sem conexão. Confira a internet e tente de novo.');
    } finally {
      setBusy(false);
    }
  }

  if (suspended) {
    return (
      <div className="space-y-2">
        <button type="button" className="btn-primary" disabled={busy} onClick={() => void send('reactivate')}>
          {busy && <Spinner />}
          Reativar conta
        </button>
        {error && <ErrorLine>{error}</ErrorLine>}
      </div>
    );
  }

  const ready = reason.trim().length >= REASON_MIN;
  return (
    <>
      <button type="button" className="btn-danger" onClick={() => setOpen(true)}>
        Suspender conta
      </button>
      {open && (
        <Modal title={`Suspender ${name}?`} onClose={() => !busy && close()}>
          <p className="text-sm text-muted">Ninguém da conta entra e nada é publicado até reativar. O motivo fica no registro de auditoria.</p>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (ready && !busy) void send('suspend', { reason });
            }}
          >
            <div className="space-y-1.5">
              <label htmlFor="suspend-reason" className="text-sm font-semibold">
                Motivo
              </label>
              <textarea
                id="suspend-reason"
                className="input min-h-24"
                value={reason}
                maxLength={REASON_MAX}
                autoFocus
                disabled={busy}
                placeholder="Ex.: pagamento em atraso há 15 dias"
                onChange={(e) => setReason(e.target.value)}
              />
              <p className="text-sm text-muted">Obrigatório.</p>
            </div>
            {error && <ErrorLine>{error}</ErrorLine>}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-ghost" disabled={busy} onClick={close}>
                Cancelar
              </button>
              <button type="submit" className="btn bg-danger text-on-danger hover:opacity-90" disabled={!ready || busy}>
                {busy && <Spinner />}
                Suspender conta
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
