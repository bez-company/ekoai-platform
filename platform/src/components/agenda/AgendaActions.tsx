'use client';

// AgendaActions.tsx: o botão "Horários" e o aviso de horário vazio da Agenda. O diálogo abre pelo botão
// ou pela URL (?edit=slots, usado pelo Início e por Configurações); salvar recarrega a Agenda.

import { useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import SlotsDialog from './SlotsDialog';
import type { Recommendation } from '@/lib/content-analysis-model';
import { defaultSlots, POSTS_PER_WEEK } from '@/lib/onboarding';

type Slot = { weekday: number; hour: number; minute: number };

function useSlotsDialog() {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const open = params.get('edit') === 'slots';
  const [notice, setNotice] = useState('');
  const href = (edit: boolean) => {
    const q = new URLSearchParams(params.toString());
    if (edit) q.set('edit', 'slots');
    else q.delete('edit');
    const s = q.toString();
    return s ? `${path}?${s}` : path;
  };
  return {
    open,
    notice,
    show: () => router.push(href(true), { scroll: false }),
    close: () => router.replace(href(false), { scroll: false }),
    saved: (scheduled: number) => {
      setNotice(scheduled ? `Horários salvos. ${scheduled === 1 ? '1 post da fila ganhou horário' : `${scheduled} posts da fila ganharam horário`}.` : 'Horários salvos.');
      router.replace(href(false), { scroll: false });
      router.refresh();
    },
  };
}

export function SlotsButton({ slots, recommendation = null }: { slots: Slot[]; recommendation?: Recommendation | null }) {
  const d = useSlotsDialog();
  return (
    <>
      <button type="button" className="btn-ghost" onClick={d.show}>
        Horários
      </button>
      {d.notice && (
        <span className="sr-only" role="status">
          {d.notice}
        </span>
      )}
      {d.open && <SlotsDialog initial={slots} recommendation={recommendation} onClose={d.close} onSaved={d.saved} />}
    </>
  );
}

// Agenda sem nenhum horário: escolher um ritmo pronto já cria a grade.
export function NoSlots({ canManage }: { canManage: boolean }) {
  const d = useSlotsDialog();
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState('');

  async function pick(n: (typeof POSTS_PER_WEEK)[number]) {
    setBusy(n);
    setError('');
    const res = await fetch('/api/slots', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel: 'instagram', slots: defaultSlots(n) }) });
    const j = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return setError(j.error || 'Não deu para criar os horários. Tente de novo.');
    d.saved(Number(j.scheduled ?? 0));
  }

  return (
    <section className="card space-y-3 py-8 text-center">
      <h2 className="text-lg font-semibold">Escolha quando publicar</h2>
      <p className="mx-auto max-w-md text-sm text-muted">Sem horários, os posts aprovados esperam na fila. Escolha um ritmo e ajuste depois.</p>
      {canManage ? (
        <>
          <div className="flex flex-wrap justify-center gap-2">
            {POSTS_PER_WEEK.map((n) => (
              <button key={n} type="button" className={n === 3 ? 'btn-primary' : 'btn-ghost'} disabled={busy !== null} onClick={() => void pick(n)}>
                {busy === n ? 'Criando…' : `${n} por semana`}
              </button>
            ))}
          </div>
          <button type="button" className="text-sm font-semibold text-accent-text hover:underline" onClick={d.show}>
            Escolher dias e horas
          </button>
          {error && (
            <p className="text-sm text-danger" role="alert">
              {error}
            </p>
          )}
          {d.open && <SlotsDialog initial={[]} onClose={d.close} onSaved={d.saved} />}
        </>
      ) : (
        <p className="text-sm text-muted">Quem administra a conta escolhe os horários.</p>
      )}
    </section>
  );
}
