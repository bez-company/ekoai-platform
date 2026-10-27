'use client';

// SlotsDialog.tsx: "Horários" da Agenda (SPEC 017 decisão 13). Os horários de publicação do Instagram,
// por dia da semana: cada horário é um post por semana. Salvar grava a grade inteira de uma vez
// (PUT /api/slots); a fila sem horário entra nos horários novos. Com 12 posts com alcance, a faixa do
// topo recomenda os melhores horários (SPEC 022): "Usar estes horários" marca as sugestões na grade, sem
// tirar os atuais, e quem salva é a pessoa.

import { useState } from 'react';
import Modal from '@/components/Modal';
import { ErrorLine } from '@/components/auth/ui';
import Link from 'next/link';
import { describeSlots, type Recommendation } from '@/lib/content-analysis-model';

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
const keyOf = (s: Slot) => `${s.weekday}-${s.hour}-${s.minute}`;

export default function SlotsDialog({ initial, recommendation = null, onClose, onSaved }: { initial: Slot[]; recommendation?: Recommendation | null; onClose: () => void; onSaved: (scheduled: number) => void }) {
  const [slots, setSlots] = useState<Slot[]>(initial);
  // Horários que vieram da recomendação (chave dia-hora-minuto), para marcar na grade e poder desfazer.
  const [suggested, setSuggested] = useState<string[]>([]);
  const [adding, setAdding] = useState<number | null>(null);
  const [time, setTime] = useState('18:00');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const ofDay = (d: number) => slots.filter((s) => s.weekday === d).sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute));

  function add(day: number) {
    const [h, m] = time.split(':').map(Number);
    if (!Number.isInteger(h) || !Number.isInteger(m)) return;
    if (!slots.some((s) => s.weekday === day && s.hour === h && s.minute === m)) setSlots([...slots, { weekday: day, hour: h, minute: m }]);
    setAdding(null);
  }

  const fresh = recommendation?.ok ? recommendation.slots.filter((r) => !slots.some((s) => keyOf(s) === keyOf(r))) : [];

  function useSuggestions() {
    if (!recommendation?.ok) return;
    setSlots([...slots, ...fresh.map((r) => ({ weekday: r.weekday, hour: r.hour, minute: r.minute }))]);
    setSuggested(fresh.map(keyOf));
  }

  function undoSuggestions() {
    setSlots(slots.filter((s) => !suggested.includes(keyOf(s))));
    setSuggested([]);
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
      {recommendation && <RecommendationStrip recommendation={recommendation} adopted={suggested.length > 0} nothingNew={fresh.length === 0} onUse={useSuggestions} onUndo={undoSuggestions} />}
      <div className="divide-y divide-line">
        {DAYS.map(([d, name]) => (
          <div key={d} className="flex flex-wrap items-center gap-2 py-2.5">
            <span className="w-20 text-sm font-semibold">{name}</span>
            <div className="flex flex-1 flex-wrap items-center gap-1.5">
              {ofDay(d).map((s) => (
                <span key={label(s)} title={suggested.includes(keyOf(s)) ? 'Horário sugerido' : undefined} className={`inline-flex items-center gap-1 rounded-full border py-1 pl-2.5 pr-1.5 font-mono text-sm ${suggested.includes(keyOf(s)) ? 'border-dashed border-accent bg-accent/10 text-accent-text' : 'border-line-strong bg-raised'}`}>
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

// A faixa do topo do diálogo: recomenda, confirma o que foi marcado ou diz quantos posts faltam.
function RecommendationStrip({ recommendation: r, adopted, nothingNew, onUse, onUndo }: { recommendation: Recommendation; adopted: boolean; nothingNew: boolean; onUse: () => void; onUndo: () => void }) {
  const box = 'flex flex-wrap items-center gap-3 rounded-lg border px-3.5 py-3';
  if (!r.ok) {
    const missing = r.need - r.have;
    return (
      <div className={`${box} border-line bg-inset`} role="status">
        <div className="min-w-0 flex-1 basis-56">
          <strong className="block text-sm">{r.reason === 'few_posts' ? `Faltam ${missing} ${missing === 1 ? 'post' : 'posts'} para recomendar horários` : 'Faltam horários diferentes para recomendar'}</strong>
          <p className="mt-0.5 text-sm text-muted">
            {r.reason === 'few_posts' ? `Com ${r.need} posts com alcance, a Ekoai sugere os melhores horários. Hoje são ${r.have}.` : 'Os posts saíram quase sempre no mesmo horário. Varie um pouco e a Ekoai compara.'}
          </p>
        </div>
      </div>
    );
  }
  if (adopted) {
    return (
      <div className={`${box} border-success/40 bg-success/10`} role="status">
        <div className="min-w-0 flex-1 basis-56">
          <strong className="block text-sm">{r.slots.length === 1 ? '1 horário sugerido marcado' : `${r.slots.length} horários sugeridos marcados`}</strong>
          <p className="mt-0.5 text-sm text-muted">Os horários atuais continuam. Remova o que não quiser e salve para valer na fila.</p>
        </div>
        <button type="button" className="btn-ghost min-h-8 px-3 py-1 text-xs" onClick={onUndo}>
          Desfazer
        </button>
      </div>
    );
  }
  return (
    <div className={`${box} border-accent/35 bg-accent/10`}>
      <div className="min-w-0 flex-1 basis-56">
        <strong className="block text-sm">{nothingNew ? 'Seus horários já seguem a recomendação' : 'Poste nos horários em que seu público está mais ativo'}</strong>
        <p className="mt-0.5 text-sm text-muted">
          {describeSlots(r.slots)}. Baseado em {r.basedOn} posts{r.usedOnline ? ' e no horário online dos seguidores' : ''}.{' '}
          <Link href="/historico/analise" className="link">
            Ver a análise
          </Link>
        </p>
      </div>
      {!nothingNew && (
        <button type="button" className="btn-primary min-h-8 px-3 py-1 text-xs" onClick={onUse}>
          Usar estes horários
        </button>
      )}
    </div>
  );
}
