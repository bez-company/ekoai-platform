'use client';

// LogoField.tsx: o logo no perfil da empresa (SPEC 011 R3, ADR 0014). Envia e remove na hora, sem
// esperar o "Salvar" da seção. Mostra o arquivo numa caixa só, com fundo claro ou escuro à escolha (é como ele vai
// aparecer nas artes) e abre ampliado ao clicar. O arquivo só é lido por /api/brand/logo (com sessão).

import { useRef, useState } from 'react';
import Modal from '@/components/Modal';
import { ErrorLine, Spinner } from '@/components/auth/ui';

const MAX = 2 * 1024 * 1024;

type Props = { assetId: string | null; canEdit: boolean; onChange: (assetId: string | null) => void };

export default function LogoField({ assetId, canEdit, onChange }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [tone, setTone] = useState<Tone>('claro');
  const [zoom, setZoom] = useState(false);

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
          <button
            type="button"
            onClick={() => setZoom(true)}
            aria-label="Ampliar o logo"
            title="Ampliar"
            className={`group relative flex h-24 w-40 items-center justify-center rounded-md border border-line transition hover:border-line-strong ${BACKGROUNDS[tone].bg}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt="Logo da empresa" className="max-h-20 max-w-[8.5rem] object-contain" />
            <span aria-hidden="true" className="absolute bottom-1 right-1 rounded bg-ink/60 px-1.5 py-0.5 text-[11px] font-semibold text-paper opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
              Ampliar
            </span>
          </button>
        ) : (
          <p className="min-w-[10rem] flex-1 text-sm text-muted">{canEdit ? 'PNG ou SVG, até 2 MB. Fundo transparente fica melhor.' : 'A empresa ainda não enviou o logo.'}</p>
        )}
        {src && <ToneToggle tone={tone} onChange={setTone} />}
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
      {zoom && src && (
        <Modal title="Logo da empresa" onClose={() => setZoom(false)} wide>
          <div className={`flex min-h-64 items-center justify-center rounded-lg border border-line p-6 ${BACKGROUNDS[tone].bg}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt="Logo da empresa ampliado" className="max-h-[60vh] max-w-full object-contain" />
          </div>
          <div className="flex items-center justify-between gap-3">
            <ToneToggle tone={tone} onChange={setTone} />
            <button type="button" className="btn-ghost" onClick={() => setZoom(false)}>
              Fechar
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// O logo aparece nas artes sobre fundo claro e sobre fundo escuro: uma caixa só, com o fundo à escolha.
const BACKGROUNDS = { claro: { bg: 'bg-paper' }, escuro: { bg: 'bg-ink' } } as const;
type Tone = keyof typeof BACKGROUNDS;

function ToneToggle({ tone, onChange }: { tone: Tone; onChange: (t: Tone) => void }) {
  return (
    <div role="group" aria-label="Fundo da prévia" className="inline-flex gap-1 rounded-full border border-line bg-inset p-0.5 text-sm">
      {(['claro', 'escuro'] as const).map((t) => (
        <button key={t} type="button" aria-pressed={tone === t} onClick={() => onChange(t)} className={`rounded-full px-3 py-1 font-semibold capitalize ${tone === t ? 'bg-raised text-fg shadow-sm' : 'text-muted hover:text-fg'}`}>
          Fundo {t}
        </button>
      ))}
    </div>
  );
}
