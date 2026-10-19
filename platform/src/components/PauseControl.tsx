'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { fmtDateTime } from '@/lib/format';
import type { PauseState } from '@/lib/pause';

export default function PauseControl({ state, overdue }: { state: PauseState; overdue: number }) {
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function toggle(paused: boolean) {
    setBusy(true);
    setError('');
    const res = await fetch('/api/pause', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paused, reason }),
    });
    setBusy(false);
    if (!res.ok) {
      const msg = (await res.json().catch(() => ({}))).error;
      setError(`Não deu para ${paused ? 'pausar' : 'retomar'}: ${msg || 'erro desconhecido'}. Tente de novo.`);
      return;
    }
    setReason('');
    router.refresh();
  }

  if (state.paused) {
    return (
      <div className="card space-y-3 border-warning/30 bg-warning/10">
        <p className="text-sm text-warning">
          Pausada{state.pausedAt ? ` desde ${fmtDateTime(state.pausedAt)}` : ''}. Nada sai até você retomar.
          {state.reason ? ` Motivo: ${state.reason}` : ''}
        </p>
        {overdue > 0 && (
          <p className="text-sm text-warning">
            {overdue === 1 ? '1 post passou' : `${overdue} posts passaram`} do horário. Ao retomar, saem juntos no
            próximo ciclo (até 10 min). Reagende no calendário o que não deve sair agora.
          </p>
        )}
        {error && <p className="text-sm text-danger">{error}</p>}
        <button onClick={() => toggle(false)} disabled={busy} className="btn-primary">
          {busy ? 'Retomando…' : 'Retomar publicação'}
        </button>
      </div>
    );
  }

  return (
    <div className="card space-y-3">
      <p className="text-sm text-muted">
        Publicando normalmente. Pausar segura todos os agendados, em todas as redes, até você retomar.
      </p>
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Motivo (opcional), ex.: revisar a campanha"
        maxLength={140}
        className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm"
      />
      {error && <p className="text-sm text-danger">{error}</p>}
      <button onClick={() => toggle(true)} disabled={busy} className="btn-danger">
        {busy ? 'Pausando…' : 'Pausar publicação'}
      </button>
    </div>
  );
}
