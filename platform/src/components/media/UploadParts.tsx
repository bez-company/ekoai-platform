'use client';

// UploadParts.tsx: a área de soltar fotos e a lista do envio, usadas no banco de imagens, no seletor
// de foto e no Publicar foto.

import { useId, useRef, useState, type ReactNode } from 'react';
import type { UploadItem } from './useUploadPhotos';

export function UploadIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 16V4M7 9l5-5 5 5M4 16v4h16v-4" />
    </svg>
  );
}

// Soltar arquivos ou clicar para escolher. O input é o próprio controle (acessível pelo teclado).
export function DropZone({ onFiles, disabled, title = 'Arraste as fotos ou clique para escolher', compact }: { onFiles: (files: FileList) => void; disabled?: boolean; title?: string; compact?: boolean }) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <label
      htmlFor={id}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (!disabled && e.dataTransfer.files.length) onFiles(e.dataTransfer.files);
      }}
      className={`flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed text-center text-sm transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/30 ${
        over ? 'border-accent-text bg-accent/10' : 'border-line-strong bg-inset hover:bg-raised'
      } ${compact ? 'px-4 py-5' : 'px-6 py-10'} ${disabled ? 'pointer-events-none opacity-60' : ''}`}
    >
      <UploadIcon />
      <strong>{title}</strong>
      <span className="text-muted">JPEG ou PNG, até 10 MB cada, 10 por vez</span>
      <input
        ref={input}
        id={id}
        type="file"
        accept="image/jpeg,image/png"
        multiple
        disabled={disabled}
        className="sr-only"
        onChange={(e) => {
          if (e.target.files?.length) onFiles(e.target.files);
          if (input.current) input.current.value = '';
        }}
      />
    </label>
  );
}

const STATUS: Record<UploadItem['status'], string> = { queued: 'Na fila', sending: 'Enviando', done: 'Enviada', error: 'Não enviada' };

export function UploadList({ items, title }: { items: UploadItem[]; title?: ReactNode }) {
  if (!items.length) return null;
  const done = items.filter((i) => i.status === 'done').length;
  return (
    <section className="card space-y-3" aria-live="polite">
      <h2 className="text-base font-semibold">{title ?? `Enviando ${items.length === 1 ? '1 foto' : `${items.length} fotos`} · ${done} ${done === 1 ? 'pronta' : 'prontas'}`}</h2>
      <ul className="space-y-2">
        {items.map((i) => (
          <li key={i.key} className="grid gap-1 text-sm sm:grid-cols-[minmax(0,14rem)_10rem_minmax(0,1fr)] sm:items-center sm:gap-3">
            <span className="truncate font-semibold">{i.name}</span>
            <span className="flex items-center gap-2">
              <span className="h-1.5 w-16 overflow-hidden rounded-full bg-inset" role="progressbar" aria-label={`${i.name}: ${STATUS[i.status]}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={i.status === 'done' ? 100 : i.status === 'sending' ? 50 : 0}>
                <span className={`block h-full rounded-full ${i.status === 'error' ? 'bg-danger' : 'bg-accent'} ${i.status === 'sending' ? 'w-1/2 animate-pulse' : i.status === 'done' || i.status === 'error' ? 'w-full' : 'w-0'}`} />
              </span>
              <span className={`whitespace-nowrap ${i.status === 'error' ? 'text-danger' : 'text-muted'}`}>{STATUS[i.status]}</span>
            </span>
            <span className={`text-xs ${i.status === 'error' ? 'text-danger' : 'text-muted'}`}>
              {i.status === 'error' ? i.message : i.status === 'done' ? (i.asset?.description ? `Descrita: "${i.asset.description}"` : 'Sem descrição ainda: escreva no cartão da foto') : ''}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
