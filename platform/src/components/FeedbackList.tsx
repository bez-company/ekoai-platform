'use client';

// Feedback recente: o que entra cru no prompt nos próximos 14 dias. Apagar tira na hora.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ASPECT_LABEL, type Feedback } from '@/lib/learning';
import { fmtDateTime } from '@/lib/format';

const PROMPT_WINDOW_DAYS = 14;

export default function FeedbackList({ items }: { items: Feedback[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  async function remove(id: string) {
    setBusy(id);
    const res = await fetch(`/api/feedback?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    setBusy(null);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      return setError(j.error || 'Não deu para apagar. Tente de novo.');
    }
    setError('');
    router.refresh();
  }

  if (!items.length) {
    return (
      <div className="card text-sm text-muted">
        Nenhum feedback ainda. Na aprovação ou no histórico, abra "O que achou deste post".
      </div>
    );
  }

  const cutoff = Date.now() - PROMPT_WINDOW_DAYS * 86400 * 1000;

  return (
    <div className="grid gap-1">
      {error && <p className="text-sm text-danger">{error}</p>}
      {items.map((f) => (
        <div key={f.id} className="flex items-start gap-3 rounded-md border border-line px-3 py-2 text-sm">
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
              <span className={f.sentiment === 'positivo' ? 'text-success' : 'text-danger'}>
                {f.sentiment === 'positivo' ? 'Gostei' : 'Não gostei'}
              </span>
              <span className="chip">{ASPECT_LABEL[f.aspect]}</span>
              <span className="chip">{f.channel || 'todas as redes'}</span>
              <span>{fmtDateTime(f.created_at)}</span>
              {new Date(f.created_at).getTime() >= cutoff && <span className="chip">no prompt</span>}
            </p>
            <p className="mt-1">{f.note}</p>
            {f.excerpt && <p className="mt-1 line-clamp-1 text-xs text-muted">Post: {f.excerpt}</p>}
          </div>
          <button
            onClick={() => remove(f.id)}
            disabled={busy === f.id}
            className="shrink-0 text-xs text-danger hover:underline"
          >
            Apagar
          </button>
        </div>
      ))}
    </div>
  );
}
