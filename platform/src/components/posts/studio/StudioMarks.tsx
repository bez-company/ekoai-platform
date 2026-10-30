'use client';

// StudioMarks.tsx: liga e desliga a logo e o @ da marca no post do estúdio (BEZ-502). A imagem já existe em cada combinação; trocar só aponta o post
// para ela (sem gerar de novo, sem gastar do limite). O que a peça não tem não aparece como opção.

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { Generation } from '@/lib/types';

type Marks = NonNullable<NonNullable<Generation['studio']>['marks']>;

export default function StudioMarks({ pendingId, marks }: { pendingId: string; marks: Marks }) {
  const router = useRouter();
  const [show, setShow] = useState(marks.show);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!marks.has.logo && !marks.has.handle) return null;

  async function toggle(key: 'logo' | 'handle') {
    if (busy) return;
    const next = { ...show, [key]: !show[key] };
    setBusy(true);
    setError('');
    const res = await fetch(`/api/pendings/${encodeURIComponent(pendingId)}/marks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next) });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(j.error || 'Não deu para trocar agora. Tente de novo.');
      return;
    }
    setShow(j.show ?? next);
    router.refresh();
  }

  return (
    <section className="card space-y-2" aria-label="Logo e @ da marca">
      <h2 className="text-base font-semibold">Logo e @ da marca</h2>
      <p className="text-sm text-muted">Mostre ou tire na imagem. A troca é na hora e não gasta do seu limite.</p>
      <div className="flex flex-wrap gap-4">
        {marks.has.logo && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={show.logo} disabled={busy} onChange={() => toggle('logo')} />
            Logo
          </label>
        )}
        {marks.has.handle && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={show.handle} disabled={busy} onChange={() => toggle('handle')} />
            @ da marca
          </label>
        )}
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
    </section>
  );
}
