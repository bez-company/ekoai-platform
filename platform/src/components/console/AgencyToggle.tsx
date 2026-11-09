'use client';

// AgencyToggle.tsx: liga ou desliga o plano Agência de uma conta no console (SPEC 039, BEZ-265).

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ErrorLine, Spinner } from '../auth/ui';

export default function AgencyToggle({ id, isAgency, hasClients }: { id: string; isAgency: boolean; hasClients: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function send(on: boolean) {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/console/accounts/${id}/agency`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ on }) });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? 'Não deu para concluir agora. Tente de novo em instantes.');
        return;
      }
      router.refresh();
    } catch {
      setError('Sem conexão. Confira a internet e tente de novo.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      {isAgency ? (
        <button type="button" className="btn-ghost" disabled={busy || hasClients} onClick={() => void send(false)} title={hasClients ? 'Só sem clientes' : undefined}>
          {busy && <Spinner />}
          Voltar ao plano Time
        </button>
      ) : (
        <button type="button" className="btn-primary" disabled={busy} onClick={() => void send(true)}>
          {busy && <Spinner />}
          Tornar agência
        </button>
      )}
      {error && <ErrorLine>{error}</ErrorLine>}
    </div>
  );
}
