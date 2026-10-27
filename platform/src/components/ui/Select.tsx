'use client';

// Select.tsx: o dropdown da plataforma (BEZ-371). Substitui o select nativo, que abre o menu do sistema
// operacional. Botão com listbox: setas, Home, End, Enter, Esc e digitar para ir à opção; `searchable` abre um
// campo de busca (listas longas, como as fontes). Cada opção pode levar um estilo próprio (a fonte na sua letra).

import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react';

export type SelectOption = { value: string; label: string; hint?: string; style?: CSSProperties };

type Props = {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  id?: string;
  ariaLabel?: string;
  describedBy?: string;
  invalid?: boolean;
  disabled?: boolean;
  searchable?: boolean;
  // Trigger compacto (linha de filtros) em vez do campo de formulário.
  compact?: boolean;
};

function Chevron() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0 text-muted">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function Check() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
      <path d="m5 12 5 5 9-10" />
    </svg>
  );
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export default function Select({ value, onChange, options, placeholder = 'Escolha', id, ariaLabel, describedBy, invalid, disabled, searchable = false, compact = false }: Props) {
  const auto = useId();
  const listId = `${auto}-list`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const typed = useRef({ text: '', at: 0 });

  const shown = useMemo(() => (query ? options.filter((o) => norm(o.label).includes(norm(query))) : options), [options, query]);
  const selected = options.find((o) => o.value === value);

  function openMenu() {
    if (disabled) return;
    const at = Math.max(0, options.findIndex((o) => o.value === value));
    setQuery('');
    setActive(at);
    setOpen(true);
  }

  function close(focusTrigger = true) {
    setOpen(false);
    if (focusTrigger) trigger.current?.focus();
  }

  function pick(option: SelectOption | undefined) {
    if (!option) return;
    onChange(option.value);
    close();
  }

  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, [open]);

  // A opção ativa acompanha o teclado dentro da rolagem da lista.
  useEffect(() => {
    if (open) list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key) && !(searchable && e.key === ' ')) {
        e.preventDefault();
        openMenu();
      }
      return;
    }
    const last = shown.length - 1;
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, last));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActive(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActive(last);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(shown[active]);
    } else if (e.key === 'Tab') {
      setOpen(false);
    } else if (!searchable && e.key.length === 1 && /\S/.test(e.key)) {
      // Digitar vai para a primeira opção que começa com o texto.
      const now = Date.now();
      typed.current = { text: now - typed.current.at > 700 ? e.key : typed.current.text + e.key, at: now };
      const hit = shown.findIndex((o) => norm(o.label).startsWith(norm(typed.current.text)));
      if (hit >= 0) setActive(hit);
    }
  }

  const triggerClass = compact
    ? 'flex items-center justify-between gap-2 rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm outline-none transition focus-visible:border-accent-text focus-visible:ring-2 focus-visible:ring-accent/30 disabled:opacity-60'
    : 'input flex items-center justify-between gap-2 text-left';

  return (
    <div ref={root} className={`relative ${compact ? 'inline-block' : ''}`} onKeyDown={onKeyDown}>
      <button
        ref={trigger}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={describedBy}
        disabled={disabled}
        onClick={() => (open ? close(false) : openMenu())}
        className={`${triggerClass} ${compact ? '' : 'w-full'}`}
      >
        <span className={`min-w-0 truncate ${selected ? '' : 'text-muted'}`} style={selected?.style}>
          {selected?.label ?? placeholder}
        </span>
        <Chevron />
      </button>
      {open && (
        <div className="absolute left-0 z-50 mt-1.5 min-w-full max-w-[min(22rem,90vw)] overflow-hidden rounded-xl border border-line bg-raised shadow-lg">
          {searchable && (
            <div className="border-b border-line p-2">
              <input
                autoFocus
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                placeholder="Buscar"
                aria-label="Buscar na lista"
                className="w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-accent-text"
              />
            </div>
          )}
          <ul ref={list} id={listId} role="listbox" aria-label={ariaLabel} className="max-h-64 overflow-auto p-1">
            {shown.length === 0 && <li className="px-3 py-2 text-sm text-muted">Nada encontrado.</li>}
            {shown.map((o, i) => {
              const isSelected = o.value === value;
              return (
                <li
                  key={o.value}
                  data-index={i}
                  role="option"
                  aria-selected={isSelected}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(o)}
                  className={`flex cursor-pointer items-center justify-between gap-3 rounded-md px-3 py-2 text-sm ${i === active ? 'bg-inset' : ''} ${isSelected ? 'font-semibold text-accent-text' : ''}`}
                >
                  <span className="min-w-0">
                    <span className="block truncate" style={o.style}>
                      {o.label}
                    </span>
                    {o.hint && <small className="block truncate text-xs font-normal text-muted">{o.hint}</small>}
                  </span>
                  {isSelected && <Check />}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
