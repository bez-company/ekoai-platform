'use client';

// CampaignActions.tsx: o que o administrador faz com uma campanha (SPEC 018): confirmar, pausar, retomar,
// encerrar e editar. Encerrar não volta, então pede confirmação. A mensagem do servidor (por exemplo, "já existe
// uma campanha ativa") aparece ao lado, sem esconder o que houve.

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Spinner } from '@/components/auth/ui';
import Modal from '@/components/Modal';
import type { CampaignStatus } from '@/lib/campaign-model';

type Action = 'confirm' | 'pause' | 'resume' | 'end';

export default function CampaignActions({ id, status }: { id: string; status: CampaignStatus }) {
  const router = useRouter();
  const [busy, setBusy] = useState<Action | ''>('');
  const [error, setError] = useState('');
  const [asking, setAsking] = useState(false);

  async function run(action: Action) {
    setBusy(action);
    setError('');
    try {
      const res = await fetch(`/api/campaigns/${id}/${action}`, { method: 'POST' });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(j.error || 'Não deu para fazer isso agora. Tente de novo em instantes.');
        return;
      }
      setAsking(false);
      router.refresh();
    } catch {
      setError('Sem conexão. Confira a rede e tente de novo.');
    } finally {
      setBusy('');
    }
  }

  const button = (action: Action, label: string, kind: 'btn-primary' | 'btn-ghost') => (
    <button type="button" className={kind} disabled={busy !== ''} onClick={() => (action === 'end' ? setAsking(true) : void run(action))}>
      {busy === action && <Spinner />}
      {label}
    </button>
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {status === 'draft' && (
          <>
            <Link href={`/campanhas/${id}/editar`} className="btn-ghost">
              Editar
            </Link>
            {button('confirm', 'Confirmar campanha', 'btn-primary')}
          </>
        )}
        {status === 'active' && (
          <>
            <Link href={`/campanhas/${id}/editar`} className="btn-ghost">
              Editar
            </Link>
            {button('pause', 'Pausar', 'btn-ghost')}
            {button('end', 'Encerrar', 'btn-ghost')}
          </>
        )}
        {status === 'paused' && (
          <>
            {button('end', 'Encerrar', 'btn-ghost')}
            {button('resume', 'Retomar', 'btn-primary')}
          </>
        )}
        {(status === 'ended' || status === 'archived') && (
          <Link href={`/campanhas/nova?from=${id}`} className="btn-ghost">
            Duplicar
          </Link>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {asking && (
        <Modal title="Encerrar esta campanha?" onClose={() => setAsking(false)}>
          <p className="text-sm text-muted">Ela não volta. As sugestões passam a seguir só a rotação, e você recebe o resumo dos posts. Para repetir a ideia depois, duplique a campanha.</p>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={() => setAsking(false)}>
              Voltar
            </button>
            <button type="button" className="btn-danger" disabled={busy !== ''} onClick={() => void run('end')}>
              {busy === 'end' && <Spinner />}
              Encerrar campanha
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
