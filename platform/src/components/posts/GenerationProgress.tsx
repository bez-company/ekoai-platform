'use client';

// GenerationProgress.tsx: o andamento da geração (SPEC 012 R1). Consulta o pedido a cada 3 segundos;
// a pessoa pode sair, o post aparece em Aprovar quando fica pronto. Falha diz a etapa e oferece
// tentar de novo (as etapas que deram certo são reaproveitadas).

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Spinner } from '@/components/auth/ui';
import type { PostProgress } from '@/lib/post-requests';

type StepState = 'done' | 'run' | 'fail' | 'todo';

const STEPS: { id: string; title: string; sub: string }[] = [
  { id: 'writer', title: 'Pensando o tema e escrevendo', sub: 'Estrategista e redator, na voz da empresa, com o revisor conferindo.' },
  { id: 'visual', title: 'Desenhando a imagem', sub: 'No post de atmosfera, o visual é gerado; no informativo, a imagem sai do layout da marca.' },
  { id: 'render', title: 'Montando o post', sub: 'Texto, logo e cores da marca, conferidos: contraste, tamanho e margem.' },
];

function stateOf(progress: PostProgress, stepId: string): StepState {
  const done = new Set(progress.steps.filter((s) => s.status === 'done').map((s) => s.step));
  const failed = new Set(progress.steps.filter((s) => s.status === 'failed').map((s) => s.step));
  if (progress.status === 'ready') return 'done';
  if (stepId === 'visual' && progress.kind === 'informativo') return done.has('writer') ? 'done' : 'todo';
  if (failed.has(stepId as never) && progress.status === 'failed') return 'fail';
  if (done.has(stepId as never)) return 'done';
  if (progress.status === 'failed') return stepId === 'render' && done.has('writer') && (done.has('visual') || progress.kind === 'informativo') ? 'fail' : 'todo';
  if (progress.status === 'generating') {
    if (stepId === 'writer') return 'run';
    if (stepId === 'visual' && done.has('writer')) return 'run';
    if (stepId === 'render' && done.has('writer') && (done.has('visual') || progress.kind === 'informativo')) return 'run';
  }
  return 'todo';
}

// O erro do provedor vira uma frase de gente; o detalhe técnico fica no log do servidor.
function friendlyError(error: string | null): string {
  if (!error) return 'Algo deu errado no meio do caminho.';
  if (/Vertex AI (429|503)/.test(error)) return 'O modelo de imagem está sobrecarregado agora. Em alguns minutos costuma voltar.';
  if (/Vertex AI 4\d\d/.test(error)) return 'O modelo recusou o pedido. Tente outro tema ou outra direção.';
  if (/perfil da empresa/i.test(error)) return error;
  return error.length > 160 ? `${error.slice(0, 160)}…` : error;
}

function Mark({ state }: { state: StepState }) {
  if (state === 'run') return <Spinner />;
  if (state === 'done') return <span aria-hidden="true">✓</span>;
  if (state === 'fail') return <span aria-hidden="true">✕</span>;
  return null;
}

export default function GenerationProgress({ initial }: { initial: PostProgress }) {
  const [progress, setProgress] = useState(initial);
  const [retrying, setRetrying] = useState(false);
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

  const steps = STEPS.map((s) => ({ ...s, state: stateOf(progress, s.id) }));
  const limit = progress.status === 'failed' && /limite do plano/.test(progress.error ?? '');
  const friendly = friendlyError(progress.error);

  return (
    <div className="card max-w-2xl space-y-4">
      {progress.status === 'ready' && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-success/30 bg-success/10 px-4 py-3 text-sm" role="status">
          <span>
            <strong>O post está pronto.</strong> Falta a sua revisão.
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
