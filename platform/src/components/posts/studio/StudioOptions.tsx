'use client';

// StudioOptions.tsx: as opções de design que o estúdio entregou (SPEC 030, F4). O Autoral cria até 3 peças do mesmo texto; a pessoa vê as miniaturas e
// escolhe a que fica. Trocar não gera nada nem gasta do limite: só aponta o post para outra peça. A escolhida é a que se aprova e se publica.

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { Generation } from '@/lib/types';

export default function StudioOptions({ pendingId, studio }: { pendingId: string; studio: NonNullable<Generation['studio']> }) {
  const router = useRouter();
  const options = studio.options ?? [];
  const [selected, setSelected] = useState(studio.selected ?? 0);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState('');
  if (options.length < 2) return null;

  async function choose(index: number) {
    if (index === selected || busy !== null) return;
    setBusy(index);
    setError('');
    const res = await fetch(`/api/pendings/${encodeURIComponent(pendingId)}/option`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ index }) });
    const j = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) {
      setError(j.error || 'Não deu para trocar a opção agora. Tente de novo.');
      return;
    }
    setSelected(index);
    router.refresh();
  }

  return (
    <section className="card space-y-3" aria-label="Opções de design">
      <div>
        <h2 className="text-base font-semibold">Opções de design</h2>
        <p className="text-sm text-muted">O Autoral criou {options.length} peças com o mesmo texto. Escolha a que você prefere: é a que você aprova e publica. Trocar não gasta do seu limite.</p>
      </div>
      <div role="radiogroup" aria-label="Opção de design" className="grid grid-cols-3 gap-3">
        {options.map((o, i) => (
          <button key={o.url} type="button" role="radio" aria-checked={i === selected} disabled={busy !== null} onClick={() => choose(i)} className={`flex flex-col gap-1.5 rounded-lg border p-2 text-left transition ${i === selected ? 'border-accent bg-accent/10' : 'border-line hover:border-line-strong'}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={o.url} alt={`Opção ${i + 1}`} className="aspect-[4/5] w-full rounded-md border border-line object-cover" />
            <strong className="text-sm">{busy === i ? 'Trocando…' : `Opção ${i + 1}`}</strong>
            {i === selected && <span className="chip self-start">Escolhida</span>}
          </button>
        ))}
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
    </section>
  );
}
