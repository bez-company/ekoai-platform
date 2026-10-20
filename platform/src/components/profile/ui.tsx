'use client';

// ui.tsx (perfil): campos dos formulários do perfil da empresa. Todos ligam rótulo, ajuda e erro por
// ARIA, como os campos das telas de entrada (components/auth/ui.tsx).

import { useId, useState, type ReactNode } from 'react';
import { ErrorLine } from '@/components/auth/ui';

type ShellProps = {
  label: string;
  optional?: boolean;
  help?: ReactNode;
  error?: string;
  children: (a11y: { id: string; describedBy?: string; invalid?: true }) => ReactNode;
};

export function FieldShell({ label, optional, help, error, children }: ShellProps) {
  const id = useId();
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  const describedBy = [help ? helpId : '', error ? errorId : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
        {optional && <span className="ml-1.5 font-normal text-muted">(opcional)</span>}
      </label>
      {children({ id, describedBy, invalid: error ? true : undefined })}
      {help && (
        <p id={helpId} className="text-sm text-muted">
          {help}
        </p>
      )}
      {error && <ErrorLine id={errorId}>{error}</ErrorLine>}
    </div>
  );
}

type Common = { label: string; optional?: boolean; help?: ReactNode; error?: string; disabled?: boolean };

export function TextField({ value, onChange, placeholder, type = 'text', autoComplete, mono, ...shell }: Common & { value: string; onChange: (v: string) => void; placeholder?: string; type?: string; autoComplete?: string; mono?: boolean }) {
  return (
    <FieldShell {...shell}>
      {({ id, describedBy, invalid }) => (
        <input
          id={id}
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          disabled={shell.disabled}
          aria-invalid={invalid}
          aria-describedby={describedBy}
          className={`input ${mono ? 'font-mono' : ''}`}
        />
      )}
    </FieldShell>
  );
}

export function TextAreaField({ value, onChange, placeholder, max, ...shell }: Common & { value: string; onChange: (v: string) => void; placeholder?: string; max: number }) {
  return (
    <FieldShell {...shell} help={shell.help ?? (value ? `${value.length} de ${max} caracteres` : undefined)}>
      {({ id, describedBy, invalid }) => (
        <textarea
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={3}
          disabled={shell.disabled}
          aria-invalid={invalid}
          aria-describedby={describedBy}
          className="input resize-y"
        />
      )}
    </FieldShell>
  );
}

export function SelectField({ value, onChange, options, placeholder, ...shell }: Common & { value: string; onChange: (v: string) => void; options: readonly string[]; placeholder: string }) {
  return (
    <FieldShell {...shell}>
      {({ id, describedBy, invalid }) => (
        <select id={id} value={value} onChange={(e) => onChange(e.target.value)} disabled={shell.disabled} aria-invalid={invalid} aria-describedby={describedBy} className="input">
          <option value="">{placeholder}</option>
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      )}
    </FieldShell>
  );
}

// Cinco pontos entre dois polos. Clicar no ponto escolhido de novo limpa a escolha.
export function ScaleField({ label, left, right, value, onChange, disabled }: { label: string; left: string; right: string; value: number | null; onChange: (v: number | null) => void; disabled?: boolean }) {
  return (
    <div role="radiogroup" aria-label={`${label}: de ${left} a ${right}`} className="grid grid-cols-[5.5rem_1fr_5.5rem] items-center gap-2 text-sm sm:grid-cols-[7rem_1fr_7rem] sm:gap-3">
      <span className="text-muted">{left}</span>
      <div className="flex gap-1.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} de 5`}
            disabled={disabled}
            onClick={() => onChange(value === n ? null : n)}
            className={`h-9 flex-1 rounded-lg border text-sm font-semibold transition disabled:opacity-50 ${
              value === n ? 'border-accent bg-accent text-on-accent' : 'border-line-strong bg-raised text-muted hover:bg-inset'
            }`}
          >
            {n}
          </button>
        ))}
      </div>
      <span className="text-right text-muted">{right}</span>
    </div>
  );
}

// Palavras soltas: Enter ou vírgula adiciona, o X tira.
export function ChipsField({ label, value, onChange, placeholder, optional, error, help, max, disabled }: Omit<Common, never> & { value: string[]; onChange: (v: string[]) => void; placeholder: string; max: number }) {
  const [draft, setDraft] = useState('');
  function add() {
    const word = draft.trim().replace(/,+$/, '').trim();
    setDraft('');
    if (!word || value.some((w) => w.toLowerCase() === word.toLowerCase()) || value.length >= max) return;
    onChange([...value, word]);
  }
  return (
    <FieldShell label={label} optional={optional} error={error} help={help}>
      {({ id, describedBy, invalid }) => (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line-strong bg-raised p-2 focus-within:border-accent-text focus-within:ring-2 focus-within:ring-accent/30">
          {value.map((w) => (
            <span key={w} className="chip gap-1.5 py-1 text-sm text-fg">
              {w}
              <button type="button" disabled={disabled} onClick={() => onChange(value.filter((x) => x !== w))} aria-label={`Tirar ${w}`} className="text-muted hover:text-danger">
                &times;
              </button>
            </span>
          ))}
          <input
            id={id}
            value={draft}
            disabled={disabled || value.length >= max}
            onChange={(e) => (e.target.value.endsWith(',') ? (setDraft(e.target.value), add()) : setDraft(e.target.value))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
              if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1));
            }}
            onBlur={add}
            placeholder={value.length >= max ? `Máximo de ${max}` : placeholder}
            aria-invalid={invalid}
            aria-describedby={describedBy}
            className="min-w-[10rem] flex-1 bg-transparent px-1 py-1 text-sm outline-none"
          />
        </div>
      )}
    </FieldShell>
  );
}

// Lista curta em linhas (diferenciais, dores).
export function ListField({ label, value, onChange, placeholder, addLabel, itemLabel, max, optional, error, disabled }: { label: string; value: string[]; onChange: (v: string[]) => void; placeholder: string; addLabel: string; itemLabel: string; max: number; optional?: boolean; error?: string; disabled?: boolean }) {
  const errorId = useId();
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-semibold">
        {label}
        {optional && <span className="ml-1.5 font-normal text-muted">(até {max})</span>}
      </p>
      <div className="grid gap-2">
        {value.map((item, i) => (
          <div key={i} className="flex gap-2">
            <input
              value={item}
              disabled={disabled}
              onChange={(e) => onChange(value.map((v, j) => (j === i ? e.target.value : v)))}
              placeholder={placeholder}
              aria-label={`${itemLabel} ${i + 1}`}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
              className="input"
            />
            <button
              type="button"
              className="btn-ghost px-3"
              disabled={disabled || (value.length === 1 && !item)}
              onClick={() => onChange(value.length === 1 ? [''] : value.filter((_, j) => j !== i))}
              aria-label={`Remover ${itemLabel.toLowerCase()} ${i + 1}`}
            >
              &times;
            </button>
          </div>
        ))}
        {value.length < max && (
          <button type="button" className="link justify-self-start text-sm" disabled={disabled} onClick={() => onChange([...value, ''])}>
            + {addLabel}
          </button>
        )}
      </div>
      {error && <ErrorLine id={errorId}>{error}</ErrorLine>}
    </div>
  );
}

export function ColorField({ value, onChange, ...shell }: Common & { value: string; onChange: (v: string) => void }) {
  const valid = /^#?[0-9a-fA-F]{6}$/.test(value.trim());
  const swatch = valid ? (value.trim().startsWith('#') ? value.trim() : `#${value.trim()}`) : undefined;
  return (
    <FieldShell {...shell}>
      {({ id, describedBy, invalid }) => (
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="h-10 w-10 shrink-0 rounded-lg border border-line-strong" style={{ background: swatch }} />
          <input id={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder="#000000" disabled={shell.disabled} aria-invalid={invalid} aria-describedby={describedBy} className="input font-mono" />
        </div>
      )}
    </FieldShell>
  );
}

export function RadioCards<T extends string>({ legend, value, onChange, options, disabled }: { legend: string; value: T | ''; onChange: (v: T | '') => void; options: { value: T; label: string; help: string }[]; disabled?: boolean }) {
  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="text-sm font-semibold">{legend}</legend>
      {options.map((o) => (
        <label key={o.value} className="flex cursor-pointer items-start gap-3 rounded-lg border border-line-strong p-3 has-[:checked]:border-accent-text has-[:checked]:bg-inset has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/30">
          <input type="radio" name={legend} checked={value === o.value} onChange={() => onChange(o.value)} className="mt-1 accent-accent" />
          <span className="text-sm">
            <span className="block font-semibold">{o.label}</span>
            <span className="block text-muted">{o.help}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

export function Counter({ label, value, onChange, min, max, help, error, disabled }: { label: string; value: number | null; onChange: (v: number | null) => void; min: number; max: number; help?: string; error?: string; disabled?: boolean }) {
  const id = useId();
  const current = value ?? 0;
  return (
    <div className="space-y-1.5">
      <p id={id} className="text-sm font-semibold">
        {label}
      </p>
      <div role="group" aria-labelledby={id} className="inline-flex items-center overflow-hidden rounded-lg border border-line-strong bg-raised">
        <button type="button" className="h-10 w-10 text-lg hover:bg-inset disabled:opacity-50" aria-label="Menos" disabled={disabled || current <= 0} onClick={() => onChange(current - 1 < min ? null : current - 1)}>
          &minus;
        </button>
        <span className="w-12 text-center font-semibold" aria-live="polite">
          {current}
        </span>
        <button type="button" className="h-10 w-10 text-lg hover:bg-inset disabled:opacity-50" aria-label="Mais" disabled={disabled || current >= max} onClick={() => onChange(Math.max(min, current + 1))}>
          +
        </button>
      </div>
      {help && <p className="text-sm text-muted">{help}</p>}
      {error && <ErrorLine>{error}</ErrorLine>}
    </div>
  );
}
