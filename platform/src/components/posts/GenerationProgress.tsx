'use client';

// GenerationProgress.tsx: o andamento da geração (SPEC 012 R1). Consulta o pedido a cada 3 segundos;
// a pessoa pode sair, o post aparece em Aprovar quando fica pronto. Falha diz a etapa e oferece
// tentar de novo (as etapas que deram certo são reaproveitadas).

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Spinner } from '@/components/auth/ui';
import type { PostProgress } from '@/lib/post-requests';
import { STEPS, stateOf, type StepState } from '@/lib/generation-steps';
import { friendlyGenerationError } from '@/lib/generation-errors';
import { failedNetworks } from '@/lib/generation-networks';
import type { Channel } from '@/lib/types';

const NAME: Record<Channel, string> = { instagram: 'Instagram', linkedin: 'LinkedIn', twitter: 'X' };

function Mark({ state }: { state: StepState }) {
  if (state === 'run') return <Spinner />;
  if (state === 'done') return <span aria-hidden="true">✓</span>;
  if (state === 'fail') return <span aria-hidden="true">✕</span>;
  return null;
}

export default function GenerationProgress({ initial }: { initial: PostProgress }) {
  const [progress, setProgress] = useState(initial);
  const [retrying, setRetrying] = useState(false);
  const [retryingNetwork, setRetryingNetwork] = useState<Channel | null>(null);
  const [error, setError] = useState('');
  const active = progress.status === 'queued' || progress.status === 'generating';

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(async () => {
      const res = await fetch(`/api/posts/${progress.id}`, { cache: 'no-store' });
      if (res.ok) setProgress(await res.json());
    }, 3000);
    return () => clearInterval(timer);
  }, [active, progress.id]);

  async function retry() {
    setRetrying(true);
    setError('');
    const res = await fetch(`/api/posts/${progress.id}/retry`, { method: 'POST' });
    const j = await res.json().catch(() => ({}));
    setRetrying(false);
    if (res.ok) setProgress({ ...progress, status: 'queued', error: null });
    else setError(j.error || 'Não deu para tentar de novo.');
  }

  // Tentar de novo só uma rede (SPEC 028, BEZ-437): as outras ficam como estão e não gasta do limite de posts.
  async function retryNetwork(channel: Channel) {
    setRetryingNetwork(channel);
    setError('');
    const res = await fetch(`/api/posts/${progress.id}/retry-network`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) setError(j.error || 'Não deu para tentar de novo agora.');
    const fresh = await fetch(`/api/posts/${progress.id}`, { cache: 'no-store' });
    if (fresh.ok) setProgress(await fresh.json());
    setRetryingNetwork(null);
  }

  const steps = progress.networks
    ? progress.networks.map((n) => (n.id === retryingNetwork ? { id: n.id, title: n.title, sub: `Escrevendo o post do ${NAME[n.id as Channel]}. As outras redes não mudam.`, state: 'run' as StepState } : { id: n.id, title: n.title, sub: n.sub, state: n.state }))
    : STEPS.map((s) => ({ ...s, state: stateOf(progress, s.id) }));
  const failed = progress.networks && progress.status === 'ready' ? failedNetworks(progress.networks) : [];
  const limit = progress.status === 'failed' && /limite do plano/.test(progress.error ?? '');
  const friendly = friendlyGenerationError(progress.error);

  return (
    <div className="card max-w-2xl space-y-4">
      {progress.status === 'ready' && failed.length > 0 && (
        <div className="space-y-2 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm" role="alert">
          <p>
            <strong>O post {failed.length > 1 ? 'das redes' : `do ${NAME[failed[0].id as Channel]}`} não saiu.</strong> As outras redes estão prontas. Tentar de novo só {failed.length > 1 ? 'nelas' : `o ${NAME[failed[0].id as Channel]}`} não gasta do limite de posts.
          </p>
          {failed.some((n) => n.error) && <p className="text-muted">{friendlyGenerationError(failed.find((n) => n.error)?.error ?? null)}</p>}
          <div className="flex flex-wrap gap-2">
            {failed.filter((n) => n.canRetry).map((n) => (
              <button key={n.id} type="button" className="btn-ghost" onClick={() => retryNetwork(n.id as Channel)} disabled={!!retryingNetwork}>
                {retryingNetwork === n.id ? 'Escrevendo…' : `Tentar de novo o ${NAME[n.id as Channel]}`}
              </button>
            ))}
          </div>
          {error && <p className="text-danger">{error}</p>}
        </div>
      )}
      {progress.status === 'ready' && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-success/30 bg-success/10 px-4 py-3 text-sm" role="status">
          <span>
            <strong>{failed.length ? 'O post do Instagram está pronto.' : 'O post está pronto.'}</strong> Falta a sua revisão.
          </span>
          {progress.pendingId && (
            <Link href={`/aprovar/${encodeURIComponent(progress.pendingId)}`} className="btn-primary">
              Revisar o post
            </Link>
          )}
        </div>
      )}
      {progress.status === 'failed' && (
        <div className="space-y-2 rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm" role="alert">
          <p>
            <strong>{limit ? 'Você chegou ao limite de posts deste mês.' : 'Não deu para gerar o post.'}</strong> {limit ? 'O limite volta no dia 1º. Os posts que já existem continuam editáveis.' : friendly}
          </p>
          {!limit && (
            <p>
              A legenda que deu certo fica guardada: tentar de novo gera só o que faltou. Essa falha não conta no limite do mês.
            </p>
          )}
          {!limit && (
            <button type="button" className="btn-ghost" onClick={retry} disabled={retrying}>
              {retrying ? 'Enviando…' : 'Tentar de novo'}
            </button>
          )}
          {error && <p className="text-danger">{error}</p>}
        </div>
      )}
      {active && (
        <p className="rounded-lg border border-info/30 bg-info/10 px-4 py-3 text-sm" role="status">
          Leva cerca de 1 minuto. Você pode sair desta tela: o post aparece em Aprovar quando ficar pronto.
        </p>
      )}
      <ol className="space-y-3">
        {steps.map((s) => (
          <li key={s.id} className={`flex gap-3 ${s.state === 'todo' ? 'text-muted' : ''}`}>
            <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-bold ${s.state === 'done' ? 'border-success bg-success/10 text-success' : s.state === 'fail' ? 'border-danger bg-danger/10 text-danger' : s.state === 'run' ? 'border-accent-text text-accent-text' : 'border-line'}`} aria-hidden="true">
              <Mark state={s.state} />
            </span>
            <div>
              <strong className="block text-sm">{s.title}</strong>
              <small className="block text-sm text-muted">{s.sub}</small>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
