'use client';

// AgendaPostCell.tsx: o post agendado dentro do dia da Agenda (SPEC 017 decisão 13). Mostra a hora, a
// miniatura, o começo da legenda e o estado; "Ver e agir" abre o cartão com publicar agora, reagendar,
// tentar de novo e cancelar.

import { useState } from 'react';
import Modal from '@/components/Modal';
import ScheduledCard, { type ScheduledLike } from '@/components/ScheduledCard';

export const STATUS: Record<string, { label: string; tone: string }> = {
  queued: { label: 'Na fila', tone: 'border-warning/30 text-warning' },
  scheduled: { label: 'Agendado', tone: 'border-accent/40 text-accent-text' },
  publishing: { label: 'Publicando', tone: 'border-warning/30 text-warning' },
  failed: { label: 'Não publicado', tone: 'border-danger/30 text-danger' },
  published: { label: 'Publicado', tone: 'border-success/30 text-success' },
};

export default function AgendaPostCell({ post, time }: { post: ScheduledLike; time: string }) {
  const [open, setOpen] = useState(false);
  const status = STATUS[post.status] ?? { label: post.status, tone: '' };
  const text = post.variation?.hook || post.caption_final.split('\n')[0];
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`flex w-full min-w-0 items-center gap-2 overflow-hidden rounded-md border p-2 text-left text-xs transition hover:border-accent/60 md:flex-col md:items-stretch md:gap-1.5 ${post.status === 'failed' ? 'border-danger/30 bg-danger/5' : 'border-accent/20 bg-accent/10'}`}
        aria-label={`${time}: ${status.label}. ${text}. Ver e agir`}
      >
        {post.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={post.image_url} alt="" className="order-first h-12 w-12 shrink-0 rounded object-cover md:order-none md:aspect-square md:h-auto md:w-full" />
        ) : null}
        <span className="flex min-w-0 flex-1 flex-col gap-1 md:contents">
          <span className="font-mono font-semibold text-accent-text md:order-first">{time}</span>
          <span className="line-clamp-2 text-fg">{text}</span>
          <span className={`chip max-w-full self-start truncate ${status.tone}`}>{status.label}</span>
          {post.variation?.format === 'carousel' && <span className="chip max-w-full self-start truncate">Carrossel</span>}
        </span>
      </button>
      {open && (
        <Modal title={`${status.label} · ${time}`} onClose={() => setOpen(false)} wide>
          <ScheduledCard post={post} time={time} />
          <div className="flex justify-end">
            <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>
              Fechar
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
