'use client';

// RowMenu.tsx: o menu "⋯" de uma linha (Equipe, SPEC 029). Abre sob o botão, fecha com Esc, com clique fora ou ao escolher, e as setas
// andam entre os itens ativos. Item desligado continua visível, com o motivo escrito em `note`.

import { useEffect, useId, useRef, useState } from 'react';

export type MenuItem = { key: string; label: string; danger?: boolean; disabled?: boolean; onSelect: () => void } | 'separator';

export default function RowMenu({ label, items, note }: { label: string; items: MenuItem[]; note?: string }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    // Foco no primeiro item ativo ao abrir.
    root.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not([disabled])')?.focus();
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      setOpen(false);
      trigger.current?.focus();
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const enabled = Array.from(root.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])') ?? []);
    if (!enabled.length) return;
    const at = enabled.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === 'ArrowDown' ? (at + 1) % enabled.length : (at - 1 + enabled.length) % enabled.length;
    enabled[next].focus();
  }

  return (
    <div ref={root} className="relative" onKeyDown={onKeyDown}>
      <button
        ref={trigger}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={label}
        onClick={() => setOpen((v) => !v)}
        className="flex h-10 w-10 items-center justify-center rounded-lg text-muted hover:bg-inset hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="19" cy="12" r="1.8" />
        </svg>
      </button>
      {open && (
        <div id={id} role="menu" aria-label={label} className="absolute right-0 top-11 z-20 min-w-[15.5rem] rounded-lg border border-line bg-raised p-1.5 text-left shadow-lg">
          {items.map((item, i) =>
            item === 'separator' ? (
              <hr key={`sep-${i}`} className="my-1 border-line" />
            ) : (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
                className={`flex w-full items-center rounded-md px-2.5 py-2.5 text-left text-sm hover:bg-inset focus-visible:bg-inset disabled:cursor-not-allowed disabled:text-muted disabled:hover:bg-transparent ${item.danger ? 'text-danger' : ''}`}
              >
                {item.label}
              </button>
            ),
          )}
          {note && <p className="px-2.5 pb-2 pt-1 text-xs leading-snug text-muted">{note}</p>}
        </div>
      )}
    </div>
  );
}
