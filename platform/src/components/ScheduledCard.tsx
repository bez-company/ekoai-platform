'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { isoToLocalInput, localInputToIso } from '@/lib/format';
import type { ScheduledPost } from '@/lib/types';

const STATUS_STYLE: Record<string, string> = {
  scheduled: 'text-accent-text border-accent/40',
  publishing: 'text-warning border-warning/30',
  failed: 'text-danger border-danger/30',
  published: 'text-success border-success/30',
};

export default function ScheduledCard({ post, time }: { post: ScheduledPost; time: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [when, setWhen] = useState(isoToLocalInput(post.scheduled_for));

  async function act(action: string, extra: Record<string, unknown> = {}) {
    setBusy(true);
    const res = await fetch('/api/scheduled', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: post.id, action, ...extra }),
    });
    setBusy(false);
    if (res.ok) {
      setEditing(false);
      router.refresh();
    } else {
      const j = await res.json().catch(() => ({}));
      alert(j.error || 'Falha');
    }
  }

  return (
    <div className="card flex gap-3">
      {post.image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={post.image_url} alt="" className="h-16 w-16 shrink-0 rounded-md object-cover" />
      ) : (
        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-md border border-line text-xs text-muted">
          s/ arte
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm">{time}</span>
          <span className="chip uppercase">{post.channel}</span>
          <span className={`chip ${STATUS_STYLE[post.status] ?? ''}`}>{post.status}</span>
          {post.pillar && <span className="chip">{post.pillar}</span>}
        </div>
        <p className="mt-1 line-clamp-2 text-sm">{post.variation?.hook || post.caption_final.slice(0, 100)}</p>
        {post.last_error && <p className="mt-1 line-clamp-2 text-xs text-danger">erro: {post.last_error}</p>}

        {editing ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              type="datetime-local"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
              className="rounded-md border border-line bg-surface px-2 py-1 text-sm outline-none focus:border-accent"
            />
            <button
              disabled={busy}
              onClick={() => act('reschedule', { scheduledFor: localInputToIso(when) })}
              className="btn-primary px-2 py-1 text-xs"
            >
              Salvar
            </button>
            <button onClick={() => setEditing(false)} className="btn-ghost px-2 py-1 text-xs">
              Cancelar
            </button>
          </div>
        ) : (
          <div className="mt-2 flex flex-wrap gap-2">
            {post.status !== 'publishing' && (
              <button onClick={() => setEditing(true)} disabled={busy} className="btn-ghost px-2 py-1 text-xs">
                Reagendar
              </button>
            )}
            {post.status === 'failed' && (
              <button onClick={() => act('retry')} disabled={busy} className="btn-primary px-2 py-1 text-xs">
                Re-tentar
              </button>
            )}
            {post.status !== 'publishing' && (
              <button onClick={() => act('cancel')} disabled={busy} className="btn-danger px-2 py-1 text-xs">
                Cancelar
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
