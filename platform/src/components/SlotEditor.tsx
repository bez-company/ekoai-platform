'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { weekdayName } from '@/lib/format';
import { CHANNELS, type PublishSlot, type Channel } from '@/lib/types';

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0]; // seg..sáb, dom

export default function SlotEditor({ initial }: { initial: PublishSlot[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [channel, setChannel] = useState<Channel>('instagram');
  const [weekday, setWeekday] = useState(2);
  const [hour, setHour] = useState(18);
  const [minute, setMinute] = useState(0);

  async function add() {
    setBusy(true);
    const res = await fetch('/api/slots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel, weekday, hour, minute }),
    });
    setBusy(false);
    if (res.ok) router.refresh();
    else alert((await res.json().catch(() => ({}))).error || 'Falha');
  }

  async function remove(id: string) {
    setBusy(true);
    const res = await fetch(`/api/slots?id=${id}`, { method: 'DELETE' });
    setBusy(false);
    if (res.ok) router.refresh();
    else alert('Falha ao remover');
  }

  const byChannel = (c: Channel) => initial.filter((s) => s.channel === c);

  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <h2 className="label">Adicionar slot</h2>
        <div className="flex flex-wrap items-end gap-2">
          <select
            value={channel}
            onChange={(e) => setChannel(e.target.value as Channel)}
            className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm"
          >
            {CHANNELS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select
            value={weekday}
            onChange={(e) => setWeekday(Number(e.target.value))}
            className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm"
          >
            {WEEKDAYS.map((d) => (
              <option key={d} value={d}>
                {weekdayName(d)}
              </option>
            ))}
          </select>
          <input
            type="number"
            min={0}
            max={23}
            value={hour}
            onChange={(e) => setHour(Number(e.target.value))}
            className="w-16 rounded-md border border-line bg-surface px-2 py-1.5 text-sm"
          />
          <span className="self-center text-muted">:</span>
          <input
            type="number"
            min={0}
            max={59}
            value={minute}
            onChange={(e) => setMinute(Number(e.target.value))}
            className="w-16 rounded-md border border-line bg-surface px-2 py-1.5 text-sm"
          />
          <button onClick={add} disabled={busy} className="btn-primary">
            Adicionar
          </button>
        </div>
      </div>

      {CHANNELS.map((c) => (
        <div key={c} className="card space-y-2">
          <h2 className="label uppercase">{c}</h2>
          {byChannel(c).length === 0 && <p className="text-sm text-muted">Sem slots.</p>}
          <div className="grid gap-1">
            {byChannel(c).map((s) => (
              <div key={s.id} className="flex items-center gap-3 rounded-md border border-line px-3 py-1.5 text-sm">
                <span className="w-24">{weekdayName(s.weekday)}</span>
                <span className="font-mono">
                  {String(s.hour).padStart(2, '0')}:{String(s.minute).padStart(2, '0')}
                </span>
                {!s.active && <span className="chip">inativo</span>}
                <button onClick={() => remove(s.id)} disabled={busy} className="ml-auto text-xs text-danger hover:underline">
                  remover
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
