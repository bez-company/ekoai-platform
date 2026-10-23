'use client';

// NoticeBell.tsx: o sino de avisos (SPEC 011 R6.3): contador de não lidos e um painel com os últimos.
// "Marcar todos como lidos" vale para a pessoa; "Ver todos" abre a página. Mora na barra lateral no
// desktop (o painel abre para a direita, sobre o conteúdo) e na barra de cima no celular.

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import NoticeItem, { type NoticeView } from './NoticeItem';
import { bellLabel } from '@/lib/notice-view';

export default function NoticeBell({ notices, unread, placement = 'top' }: { notices: NoticeView[]; unread: number; placement?: 'side' | 'top' }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  async function markAll() {
    setBusy(true);
    try {
      const res = await fetch('/api/notifications/read', { method: 'POST' });
      if (res.status === 401) router.push('/entrar');
      else router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={root} className="relative">
      <button type="button" onClick={() => setOpen(!open)} aria-label={bellLabel(unread)} aria-expanded={open} aria-haspopup="dialog" className="relative flex h-10 w-10 items-center justify-center rounded-full text-fg transition hover:bg-inset">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 9a6 6 0 1 1 12 0c0 6 2 7 2 7H4s2-1 2-7zM10 20a2 2 0 0 0 4 0" />
        </svg>
        {unread > 0 && <span aria-hidden="true" className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-on-accent">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div role="dialog" aria-label="Avisos" className={`z-50 max-h-[calc(100vh-6rem)] overflow-y-auto rounded-xl border border-line bg-raised p-4 text-fg shadow-lg ${placement === 'side' ? 'absolute left-0 top-12 w-[22rem] max-w-[calc(100vw-1.5rem)]' : 'fixed inset-x-3 top-14'}`}>
          <div className="flex items-center justify-between gap-3">
            <strong className="text-sm">Avisos</strong>
            {unread > 0 && (
              <button type="button" className="link text-sm" disabled={busy} onClick={() => void markAll()}>
                Marcar todos como lidos
              </button>
            )}
          </div>
          {notices.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">Nenhum aviso por enquanto.</p>
          ) : (
            <ul className="mt-1 divide-y divide-line">
              {notices.map((n) => (
                <NoticeItem key={n.id} n={n} />
              ))}
            </ul>
          )}
          <div className="mt-1 border-t border-line pt-3">
            <Link href="/notificacoes" className="link text-sm" onClick={() => setOpen(false)}>
              Ver todos os avisos
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
