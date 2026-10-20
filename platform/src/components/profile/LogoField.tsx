'use client';

// LogoField.tsx: o logo no perfil da empresa (SPEC 011 R3, ADR 0014). Envia e remove na hora, sem
// esperar o "Salvar" da seção. Mostra o arquivo em fundo claro e escuro, que é como ele vai aparecer
// nas artes. O arquivo só é lido por /api/brand/logo (com sessão).

import { useRef, useState } from 'react';
import { ErrorLine, Spinner } from '@/components/auth/ui';

const MAX = 2 * 1024 * 1024;

type Props = { assetId: string | null; canEdit: boolean; onChange: (assetId: string | null) => void };

export default function LogoField({ assetId, canEdit, onChange }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function send(file: File) {
    setError('');
    if (file.size > MAX) {
      setError(`O arquivo tem ${(file.size / 1048576).toFixed(1).replace('.', ',')} MB. Use PNG ou SVG de até 2 MB.`);
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.set('file', file);
      const res = await fetch('/api/brand/logo', { method: 'POST', body: form });
      const data = (await res.json().catch(() => ({}))) as { assetId?: string; error?: string };
      if (!res.ok || !data.assetId) setError(data.error ?? 'Não deu para enviar agora. Tente de novo em instantes.');
      else onChange(data.assetId);
    } catch {
      setError('Sem conexão. Confira a rede e tente de novo.');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  async function remove() {
    setError('');
    setBusy(true);
    try {
      const res = await fetch('/api/brand/logo', { method: 'DELETE' });
      if (!res.ok) setError('Não deu para tirar o logo agora. Tente de novo em instantes.');
      else onChange(null);
    } catch {
      setError('Sem conexão. Confira a rede e tente de novo.');
    } finally {
      setBusy(false);
    }
  }

  const src = assetId ? `/api/brand/logo?v=${assetId}` : null;
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-semibold">
        Logo<span className="ml-1.5 font-normal text-muted">(opcional)</span>
      </p>
      <div className="flex flex-wrap items-center gap-4 rounded-lg border border-dashed border-line-strong p-4">
        {src ? (
          <div className="flex gap-2" aria-label="Prévia do logo em fundo claro e escuro">
            {[
              ['bg-paper', 'claro'],
              ['bg-ink', 'escuro'],
            ].map(([bg, label]) => (
              <span key={label} className={`flex h-16 w-28 items-center justify-center rounded-md border border-line ${bg}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt={`Logo da empresa em fundo ${label}`} className="max-h-12 max-w-[6rem] object-contain" />
              </span>
            ))}
          </div>
        ) : (
          <p className="min-w-[10rem] flex-1 text-sm text-muted">{canEdit ? 'PNG ou SVG, até 2 MB. Fundo transparente fica melhor.' : 'A empresa ainda não enviou o logo.'}</p>
        )}
        {canEdit && (
          <div className="flex gap-2">
            <input ref={input} type="file" accept="image/png,image/svg+xml,.png,.svg" className="sr-only" tabIndex={-1} aria-label="Arquivo do logo" onChange={(e) => e.target.files?.[0] && void send(e.target.files[0])} />
            <button type="button" className="btn-ghost" disabled={busy} onClick={() => input.current?.click()}>
              {busy && <Spinner />}
              {src ? 'Trocar logo' : 'Escolher arquivo'}
            </button>
            {src && (
              <button type="button" className="btn-danger" disabled={busy} onClick={() => void remove()}>
                Tirar logo
              </button>
            )}
          </div>
        )}
      </div>
      {error && <ErrorLine>{error}</ErrorLine>}
    </div>
  );
}
