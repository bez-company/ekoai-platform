'use client';

// SlotsDialog.tsx: "Horários" da Agenda (SPEC 017 decisão 13). Os horários de publicação do Instagram,
// por dia da semana, com ritmo pronto (2, 3 ou 5 por semana). Salvar grava a grade inteira de uma vez
// (PUT /api/slots); a fila sem horário entra nos horários novos.

import { useState } from 'react';
import Modal from '@/components/Modal';
import { ErrorLine } from '@/components/auth/ui';
import { defaultSlots, POSTS_PER_WEEK } from '@/lib/onboarding';

type Slot = { weekday: number; hour: number; minute: number };

const DAYS: [number, string][] = [
  [1, 'Segunda'],
  [2, 'Terça'],
  [3, 'Quarta'],
  [4, 'Quinta'],
  [5, 'Sexta'],
  [6, 'Sábado'],
  [0, 'Domingo'],
];
const pad = (n: number) => String(n).padStart(2, '0');
const label = (s: Slot) => `${pad(s.hour)}:${pad(s.minute)}`;
const sameSet = (a: Slot[], b: Slot[]) => a.length === b.length && a.every((x) => b.some((y) => y.weekday === x.weekday && y.hour === x.hour && y.minute === x.minute));

export default function SlotsDialog({ initial, onClose, onSaved }: { initial: Slot[]; onClose: () => void; onSaved: (scheduled: number) => void }) {
  const [slots, setSlots] = useState<Slot[]>(initial);
  const [adding, setAdding] = useState<number | null>(null);
  const [time, setTime] = useState('18:00');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const ofDay = (d: number) => slots.filter((s) => s.weekday === d).sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute));
  const preset = POSTS_PER_WEEK.find((n) => sameSet(slots, defaultSlots(n)));

  function add(day: number) {
    const [h, m] = time.split(':').map(Number);
    if (!Number.isInteger(h) || !Number.isInteger(m)) return;
    if (!slots.some((s) => s.weekday === day && s.hour === h && s.minute === m)) setSlots([...slots, { weekday: day, hour: h, minute: m }]);
    setAdding(null);
  }

  async function save() {
    setBusy(true);
    setError('');
    const res = await fetch('/api/slots', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel: 'instagram', slots }) });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(j.error || 'Não deu para salvar os horários. Tente de novo.');
    onSaved(Number(j.scheduled ?? 0));
  }

  return (
    <Modal title="Horários de publicação" onClose={onClose} wide>
      <p className="text-sm text-muted">Quando a Ekoai publica no Instagram. Post aprovado entra no próximo horário livre.</p>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Ritmo">
        <span className="text-sm text-muted">Ritmo:</span>
        {POSTS_PER_WEEK.map((n) => (
          <button key={n} type="button" aria-pressed={preset === n} onClick={() => setSlots(defaultSlots(n))} className={`chip min-h-8 px-3 text-sm ${preset === n ? 'border-accent bg-accent/20 text-fg' : 'hover:text-fg'}`}>
            {n} por semana
          </button>
        ))}
      </div>
      <div className="divide-y divide-line">
        {DAYS.map(([d, name]) => (
          <div key={d} className="flex flex-wrap items-center gap-2 py-2.5">
            <span className="w-20 text-sm font-semibold">{name}</span>
            <div className="flex flex-1 flex-wrap items-center gap-1.5">
              {ofDay(d).map((s) => (
                <span key={label(s)} className="inline-flex items-center gap-1 rounded-full border border-line-strong bg-raised py-1 pl-2.5 pr-1.5 font-mono text-sm">
                  {label(s)}
                  <button type="button" aria-label={`Remover ${name} ${label(s)}`} className="rounded-full px-1 text-muted hover:text-fg" onClick={() => setSlots(slots.filter((x) => x !== s))}>
                    ×
                  </button>
                </span>
              ))}
              {adding === d ? (
                <span className="inline-flex items-center gap-1.5">
                  <input type="time" value={time} step={300} onChange={(e) => setTime(e.target.value)} aria-label={`Novo horário de ${name}`} className="rounded-md border border-line bg-surface px-2 py-1 text-sm outline-none focus:border-accent" />
                  <button type="button" className="btn-primary min-h-8 px-3 py-1 text-xs" onClick={() => add(d)}>
                    Pôr
                  </button>
                  <button type="button" className="btn-ghost min-h-8 px-3 py-1 text-xs" onClick={() => setAdding(null)}>
                    Cancelar
                  </button>
                </span>
              ) : (
                <button type="button" className="text-sm font-semibold text-accent-text hover:underline" onClick={() => setAdding(d)} disabled={ofDay(d).length >= 4}>
                  + horário
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted">Horário de Brasília. Por enquanto só Instagram.</p>
      {error && <ErrorLine>{error}</ErrorLine>}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>
          Cancelar
        </button>
        <button type="button" className="btn-primary" onClick={() => void save()} disabled={busy}>
          {busy ? 'Salvando…' : 'Salvar horários'}
        </button>
      </div>
    </Modal>
  );
}
