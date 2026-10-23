'use client';

// PlanBanner.tsx: o que o Início diz quando o planejamento da semana não saiu como de costume (SPEC 018).
// `failed`: não montou as sugestões; a pessoa tenta de novo ou cria um post agora. `simple`: o modelo ficou fora
// (ou o teto de custo do dia passou) e as ideias saíram do objetivo; horário, objetivo e motivo são os mesmos.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Spinner } from '@/components/auth/ui';

export default function PlanBanner({ kind, canRetry, withCampaign }: { kind: 'failed' | 'simple'; canRetry: boolean; withCampaign: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function retry() {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/suggestions/plan', { method: 'POST' });
      if (res.status === 401) return router.push('/login');
      const j = await res.json().catch(() => ({}));
      if (!res.ok) return setError(j.error || 'Não foi possível montar as sugestões agora. Tente de novo em instantes.');
      router.refresh();
    } catch {
      setError('Sem conexão. Confira a rede e tente de novo.');
    } finally {
      setBusy(false);
    }
  }

  if (kind === 'simple') {
    return (
      <div role="status" className="rounded-xl border border-info/30 bg-info/10 p-3 text-sm">
        <strong>As sugestões desta semana usam o modo simples.</strong> Horários, objetivos e motivos seguem {withCampaign ? 'a campanha' : 'a rotação'}; só as ideias ficaram mais curtas. Volta ao normal amanhã.
      </div>
    );
  }
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
      <span>
        <strong>Não foi possível montar as sugestões desta semana.</strong> Seus posts e horários estão salvos. Tente de novo ou crie um post agora.
        {error && <span className="mt-1 block">{error}</span>}
      </span>
      {canRetry && (
        <button type="button" className="btn-ghost" disabled={busy} onClick={() => void retry()}>
          {busy && <Spinner />}
          Tentar de novo
        </button>
      )}
    </div>
  );
}
