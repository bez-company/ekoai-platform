'use client';

// Modal.tsx: janela de diálogo sobre <dialog> nativo. O navegador cuida do foco preso, do Esc e do
// fundo inerte; aqui entram o fechar por clique no fundo e o foco no título ao abrir.

import { useEffect, useRef, type ReactNode } from 'react';

export default function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const el = dialog.current;
    if (el && !el.open) el.showModal();
    heading.current?.focus();
  }, []);

  return (
    <dialog
      ref={dialog}
      aria-labelledby="modal-title"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === dialog.current) onClose();
      }}
      className={`w-[calc(100%-2rem)] ${wide ? 'max-w-xl' : 'max-w-md'} rounded-xl border border-line bg-raised p-0 text-fg shadow-lg backdrop:bg-ink/60`}
    >
      <div className="space-y-4 p-6">
        <h2 id="modal-title" ref={heading} tabIndex={-1} className="text-xl font-semibold outline-none focus-visible:outline-none">
          {title}
        </h2>
        {children}
      </div>
    </dialog>
  );
}
