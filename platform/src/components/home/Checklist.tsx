'use client';

// Checklist.tsx: "Deixe a conta pronta", no Início (SPEC 011 R6). O que está feito vem do banco;
// aqui só se mostra, se leva a quem resolve e se pula (ou volta a mostrar) o passo opcional.

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ErrorLine, Spinner } from '@/components/auth/ui';
import type { Checklist as ChecklistData, ChecklistItem } from '@/lib/onboarding';

function Mark({ status }: { status: ChecklistItem['status'] }) {
  return (
    <span
      aria-hidden="true"
      className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${
        status === 'done' ? 'border-success bg-success text-on-accent' : status === 'skipped' ? 'border-line-strong text-muted' : 'border-line-strong'
      }`}
    >
      {status === 'done' ? '✓' : status === 'skipped' ? '–' : ''}
    </span>
  );
}

const STATUS_TEXT = { done: 'Feito', skipped: 'Pulado por agora', todo: '' } as const;

export default function Checklist({ checklist, summary }: { checklist: ChecklistData; summary: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function setSkipped(item: string, skipped: boolean) {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/onboarding', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ item, skipped }) });
      if (res.status === 401) {
        router.push('/login');
        return;
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? 'Não deu para salvar agora. Tente de novo em instantes.');
        return;
      }
      router.refresh();
    } catch {
      setError('Sem conexão. Confira a rede e tente de novo.');
    } finally {
      setBusy(false);
    }
  }

  if (checklist.complete) {
    return (
      <section className="card flex flex-col items-center gap-2 py-8 text-center">
        <span aria-hidden="true" className="flex h-12 w-12 items-center justify-center rounded-full bg-success/15 text-xl text-success">
          ✓
        </span>
        <h2 className="text-lg font-semibold">Tudo pronto</h2>
        <p className="max-w-sm text-sm text-muted">{summary} Quando a criação de posts chegar, os posts para aprovar aparecem aqui.</p>
        <Link href="/settings" className="btn-ghost mt-2">
          Ver horários de publicação
        </Link>
      </section>
    );
  }

  return (
    <section className="card space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Deixe a conta pronta</h2>
        <span className="text-sm text-muted">
          {checklist.resolved} de {checklist.total}
        </span>
      </div>
      <div role="progressbar" aria-label="Passos concluídos" aria-valuemin={0} aria-valuemax={checklist.total} aria-valuenow={checklist.resolved} className="h-2 overflow-hidden rounded-full bg-inset">
        <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${(checklist.resolved / checklist.total) * 100}%` }} />
      </div>
      <ul className="divide-y divide-line">
        {checklist.items.map((item) => (
          <li key={item.id} className="flex flex-wrap items-start gap-3 py-3">
            <Mark status={item.status} />
            <div className="min-w-[12rem] flex-1">
              <p className="text-sm font-semibold">{item.title}</p>
              <p className="text-sm text-muted">{STATUS_TEXT[item.status] || item.note || item.detail}</p>
            </div>
            {item.actions.length > 0 && (
              <div className="flex gap-2">
                {item.actions.map((a) =>
                  a.kind === 'link' ? (
                    <Link key={a.label} href={a.href} className={item.actions.length > 1 ? 'btn-ghost' : 'btn-primary'}>
                      {a.label}
                    </Link>
                  ) : (
                    <button key={a.label} type="button" className="btn-ghost" disabled={busy} onClick={() => void setSkipped(item.id, a.kind === 'skip')}>
                      {busy && <Spinner />}
                      {a.label}
                    </button>
                  ),
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
      {error && <ErrorLine>{error}</ErrorLine>}
    </section>
  );
}
