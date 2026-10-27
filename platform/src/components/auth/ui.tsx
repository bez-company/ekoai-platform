'use client';

// ui.tsx: peças das telas de entrada. Campo com rótulo, ajuda e erro ligados por ARIA, o campo
// de 6 dígitos do app autenticador e a casca de cada tela (o título recebe o foco ao abrir, para
// leitor de tela e teclado saberem que a tela mudou).

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

export function ErrorLine({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <p id={id} role="alert" className="flex items-start gap-1.5 text-sm text-danger">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="mt-0.5 shrink-0">
        <path d="M12 9v4M12 17h.01" />
        <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      </svg>
      <span>{children}</span>
    </p>
  );
}

type FieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  autoComplete?: string;
  autoFocus?: boolean;
  placeholder?: string;
  help?: ReactNode;
  error?: string;
  disabled?: boolean;
  readOnly?: boolean;
  below?: ReactNode;
};

// Todo campo de senha da plataforma passa por aqui: o olho mostra e oculta o que foi digitado.
function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
      {off && <path d="m3 3 18 18" />}
    </svg>
  );
}

export function Field({ label, value, onChange, type = 'text', autoComplete, autoFocus, placeholder, help, error, disabled, readOnly, below }: FieldProps) {
  const id = useId();
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  const [shown, setShown] = useState(false);
  const isPassword = type === 'password';
  const input = (
    <input
      id={id}
      type={isPassword && shown ? 'text' : type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      autoComplete={autoComplete}
      autoFocus={autoFocus}
      placeholder={placeholder}
      disabled={disabled}
      readOnly={readOnly}
      aria-invalid={error ? true : undefined}
      aria-describedby={[help ? helpId : '', error ? errorId : ''].filter(Boolean).join(' ') || undefined}
      className={isPassword ? 'input pr-11' : 'input'}
    />
  );
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      {isPassword ? (
        <div className="relative">
          {input}
          <button
            type="button"
            onClick={() => setShown((v) => !v)}
            disabled={disabled}
            aria-label={shown ? 'Ocultar senha' : 'Mostrar senha'}
            aria-pressed={shown}
            className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-muted hover:text-fg focus-visible:text-fg disabled:opacity-60"
          >
            <EyeIcon off={shown} />
          </button>
        </div>
      ) : (
        input
      )}
      {below}
      {help && (
        <p id={helpId} className="text-sm text-muted">
          {help}
        </p>
      )}
      {error && <ErrorLine id={errorId}>{error}</ErrorLine>}
    </div>
  );
}

// Seis caixas, uma por dígito: avança sozinho, volta com Backspace e aceita colar o código inteiro.
// `onComplete` dispara quando o sexto dígito entra (digitado ou colado): quem usa envia sem esperar o clique, e o botão segue na tela.
export function OtpInput({ value, onChange, onComplete, invalid, disabled }: { value: string; onChange: (value: string) => void; onComplete?: (code: string) => void; invalid?: boolean; disabled?: boolean }) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length: 6 }, (_, i) => value[i] ?? '');

  function set(index: number, raw: string) {
    const typed = raw.replace(/\D/g, '');
    if (!typed) {
      onChange(value.slice(0, index) + value.slice(index + 1));
      return;
    }
    const next = (value.slice(0, index) + typed + value.slice(index + 1)).slice(0, 6);
    onChange(next);
    if (next.length === 6 && next !== value) onComplete?.(next);
    refs.current[Math.min(index + typed.length, 5)]?.focus();
  }

  return (
    <div role="group" aria-label="Código de 6 dígitos" className="flex gap-2">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          value={d}
          onChange={(e) => set(i, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Backspace' && !d && i > 0) refs.current[i - 1]?.focus();
          }}
          onPaste={(e) => {
            const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
            if (!pasted) return;
            e.preventDefault();
            onChange(pasted);
            if (pasted.length === 6) onComplete?.(pasted);
            refs.current[Math.min(pasted.length, 5)]?.focus();
          }}
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          aria-label={`Dígito ${i + 1}`}
          aria-invalid={invalid ? true : undefined}
          disabled={disabled}
          maxLength={6}
          className="input h-12 w-11 px-0 text-center text-xl font-bold"
        />
      ))}
    </div>
  );
}

export function ViewShell({ title, lead, children, foot }: { title: string; lead?: ReactNode; children: ReactNode; foot?: ReactNode }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  return (
    <div className="w-full max-w-md">
      <div className="card space-y-5 p-8">
        <div>
          <h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold outline-none focus-visible:outline-none">
            {title}
          </h1>
          {lead && <div className="mt-1 text-sm leading-relaxed text-muted">{lead}</div>}
        </div>
        {children}
      </div>
      {foot && <div className="mt-5 text-center text-sm leading-relaxed text-muted">{foot}</div>}
    </div>
  );
}

export function Spinner() {
  return <span aria-hidden="true" className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" />;
}
