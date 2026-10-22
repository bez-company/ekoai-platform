'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { isoToLocalInput, localInputToIso } from '@/lib/format';
import type { ScheduledPost } from '@/lib/types';

const STATUS_STYLE: Record<string, string> = {
  queued: 'text-warning border-warning/30',
  scheduled: 'text-accent-text border-accent/40',
  publishing: 'text-warning border-warning/30',
  failed: 'text-danger border-danger/30',
  published: 'text-success border-success/30',
};

const STATUS_LABEL: Record<string, string> = {
  queued: 'Na fila',
  scheduled: 'Agendado',
  publishing: 'Publicando',
  failed: 'Não publicado',
  published: 'Publicado',
};

const CHANNEL_LABEL: Record<string, string> = { instagram: 'Instagram', linkedin: 'LinkedIn', twitter: 'X' };

// O mínimo que o cartão usa: serve ao post completo da fila e à célula da Agenda (BEZ-247).
export type ScheduledLike = Pick<ScheduledPost, 'id' | 'channel' | 'status' | 'scheduled_for' | 'caption_final' | 'image_url' | 'last_error'> & Partial<Pick<ScheduledPost, 'variation' | 'pillar'>>;

export default function ScheduledCard({ post, time }: { post: ScheduledLike; time: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [publishAsked, setPublishAsked] = useState(false);
  const [error, setError] = useState('');
  const [when, setWhen] = useState(post.scheduled_for ? isoToLocalInput(post.scheduled_for) : '');

  async function act(action: string, extra: Record<string, unknown> = {}) {
    setBusy(true);
    setError('');
    const res = await fetch('/api/scheduled', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: post.id, action, ...extra }),
    });
    setBusy(false);
    setEditing(false);
    setPublishAsked(false);
    // Publicar agora que falha também muda o post (fica como não publicado): recarrega nos dois casos.
    if (!res.ok) setError((await res.json().catch(() => ({}))).error || 'Não deu para concluir agora. Tente de novo.');
    router.refresh();
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
          <span className="chip">{CHANNEL_LABEL[post.channel] ?? post.channel}</span>
          <span className={`chip ${STATUS_STYLE[post.status] ?? ''}`}>{STATUS_LABEL[post.status] ?? post.status}</span>
          {post.pillar && <span className="chip">{post.pillar}</span>}
        </div>
        <p className="mt-1 line-clamp-2 text-sm">{post.variation?.hook || post.caption_final.slice(0, 100)}</p>
        {post.last_error && <p className="mt-1 line-clamp-2 text-xs text-danger">Motivo: {post.last_error}</p>}
        {error && <p className="mt-1 text-xs text-danger" role="alert">{error}</p>}

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
        ) : publishAsked ? (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <span>Publicar agora, fora da agenda?</span>
            <button onClick={() => act('publish_now')} disabled={busy} className="btn-primary px-2 py-1 text-xs">
              {busy ? 'Publicando…' : 'Publicar agora'}
            </button>
            <button onClick={() => setPublishAsked(false)} disabled={busy} className="btn-ghost px-2 py-1 text-xs">
              Cancelar
            </button>
          </div>
        ) : (
          <div className="mt-2 flex flex-wrap gap-2">
            {post.status !== 'publishing' && (
              <button onClick={() => setPublishAsked(true)} disabled={busy} className="btn-ghost px-2 py-1 text-xs">
                Publicar agora
              </button>
            )}
            {post.status !== 'publishing' && (
              <button onClick={() => setEditing(true)} disabled={busy} className="btn-ghost px-2 py-1 text-xs">
                {post.scheduled_for ? 'Reagendar' : 'Escolher horário'}
              </button>
            )}
            {post.status === 'failed' && (
              <button onClick={() => act('retry')} disabled={busy} className="btn-primary px-2 py-1 text-xs">
                Tentar de novo
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
