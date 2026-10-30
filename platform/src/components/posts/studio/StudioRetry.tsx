'use client';

// StudioRetry.tsx: o pedido era Refinado ou Autoral e saiu como Rápido (BEZ-497). Um clique cria o mesmo pedido de novo no nível escolhido, sem
// redigitar; a tela segue para Aprovar, onde o post em criação aparece com as etapas.

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Spinner } from '@/components/auth/ui';

export default function StudioRetry({ briefId, levelName }: { briefId: string; levelName: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function retry() {
    if (busy) return;
    setBusy(true);
    setError('');
    const res = await fetch(`/api/posts/${encodeURIComponent(briefId)}/retry-level`, { method: 'POST' });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      setBusy(false);
      setError(j.error || 'Não deu para criar o pedido agora. Tente de novo em instantes.');
      return;
    }
    router.push('/aprovar');
  }

  return (
    <div className="space-y-1">
      <button type="button" className="btn-primary inline-flex items-center gap-2" disabled={busy} onClick={retry}>
        {busy && <Spinner />}
        Tentar de novo no {levelName}
      </button>
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}
