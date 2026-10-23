'use client';

// Guide.tsx: "Até a primeira publicação", no Início (SPEC 017, decisões 11 e 12; protótipo v10
// home:guia). Cada passo vem marcado do banco (lib/onboarding.ts, buildGuide): aqui só se mostra, se
// leva a quem resolve, se pula o passo opcional e se liga a publicação.

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ErrorLine, Spinner } from '@/components/auth/ui';
import type { Guide as GuideData, GuideAction, GuideStep } from '@/lib/onboarding';

function Mark({ status }: { status: GuideStep['status'] }) {
  return (
    <span
      aria-hidden="true"
      className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${
        status === 'done' ? 'border-success bg-success text-on-accent' : status === 'skipped' ? 'border-line-strong text-muted' : 'border-line-strong bg-raised'
      }`}
    >
      {status === 'done' ? '✓' : status === 'skipped' ? '–' : ''}
    </span>
  );
}

async function post(url: string, body: unknown): Promise<{ ok: boolean; status: number; error?: string }> {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (res.ok) return { ok: true, status: res.status };
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return { ok: false, status: res.status, error: data.error };
}

export default function Guide({ guide }: { guide: GuideData | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  if (!guide || guide.hidden) return null;

  async function run(step: GuideStep, a: GuideAction) {
    if (a.kind === 'link') return;
    setBusy(step.id);
    setError('');
    try {
      const res = a.kind === 'resume' ? await post('/api/pause', { paused: false }) : await post('/api/onboarding', { item: step.id, skipped: a.kind === 'skip' });
      if (res.status === 401) {
        router.push('/entrar');
        return;
      }
      if (!res.ok) {
        setError(res.error ?? 'Não deu para salvar agora. Tente de novo em instantes.');
        return;
      }
      router.refresh();
    } catch {
      setError('Sem conexão. Confira a rede e tente de novo.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="card space-y-3" aria-labelledby="guide-title">
      <div className="flex items-center justify-between gap-3">
        <h2 id="guide-title" className="text-lg font-semibold">
          Até a primeira publicação
        </h2>
        <span className="text-sm text-muted">
          {guide.resolved} de {guide.total}
        </span>
      </div>
      <div role="progressbar" aria-label="Passos concluídos" aria-valuemin={0} aria-valuemax={guide.total} aria-valuenow={guide.resolved} className="h-2 overflow-hidden rounded-full bg-inset">
        <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${(guide.resolved / guide.total) * 100}%` }} />
      </div>
      <ol className="space-y-1">
        {guide.steps.map((s) => {
          const current = s.id === guide.current;
          return (
            <li key={s.id} aria-current={current ? 'step' : undefined} className={`flex flex-wrap items-start gap-3 py-3 ${current ? 'rounded-md bg-accent/15 px-3' : 'border-t border-line first:border-t-0'}`}>
              <Mark status={s.status} />
              <div className="min-w-[12rem] flex-1">
                <p className="text-sm font-semibold">
                  {s.title}
                </p>
                <p className="text-sm text-muted">{s.note ?? s.detail}</p>
                {s.status === 'done' && <p className="mt-1 text-xs font-semibold text-success">Feito</p>}
                {s.status === 'skipped' && <p className="mt-1 text-xs text-muted">Pulado por agora</p>}
              </div>
              {/* Como no protótipo: a ação aparece no passo atual e no opcional; os outros só mostram o estado. */}
              {s.actions.length > 0 && (current || s.optional) && (
                <div className="flex flex-wrap gap-2">
                  {s.actions.map((a, i) => {
                    const primary = current && i === 0;
                    if (a.kind === 'link') {
                      return (
                        <Link key={a.label} href={a.href} className={primary ? 'btn-primary' : 'btn-ghost'}>
                          {a.label}
                        </Link>
                      );
                    }
                    return (
                      <button key={a.label} type="button" className={primary ? 'btn-primary' : 'btn-ghost'} disabled={busy !== null} onClick={() => void run(s, a)}>
                        {busy === s.id && <Spinner />}
                        {a.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {error && <ErrorLine>{error}</ErrorLine>}
    </section>
  );
}

