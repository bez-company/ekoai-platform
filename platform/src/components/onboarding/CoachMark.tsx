'use client';

// CoachMark.tsx: a dica curta da primeira visita a uma tela (SPEC 017, decisão 11). Fica guardada no
// navegador (localStorage): fechou uma vez, não volta. Antes de montar no cliente não aparece nada,
// para a página servida pelo servidor não piscar a dica para quem já fechou.

import { useEffect, useState } from 'react';

const key = (id: string) => `ekoai.coach.${id}`;

export default function CoachMark({ id, title, body }: { id: string; title: string; body: string }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      setOpen(localStorage.getItem(key(id)) !== 'seen');
    } catch {
      setOpen(false);
    }
  }, [id]);

  if (!open) return null;

  function close() {
    try {
      localStorage.setItem(key(id), 'seen');
    } catch {
      // navegador sem armazenamento: a dica só some nesta visita
    }
    setOpen(false);
  }

  return (
    <aside role="note" aria-label="Dica" className="flex items-center gap-3 rounded-xl border border-info/30 bg-info/10 px-4 py-3 text-sm text-fg">
      <span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-info/20 text-xs font-bold text-info">
        i
      </span>
      <p className="flex-1">
        <strong>{title}</strong> {body}
      </p>
      <button type="button" className="link text-sm" onClick={close}>
        Entendi
      </button>
    </aside>
  );
}
