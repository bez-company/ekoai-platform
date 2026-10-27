'use client';

// LogoField.tsx: a logo no perfil da empresa (SPEC 011 R3, ADR 0014; variações na SPEC 026). A principal é obrigatória e as
// variações (para fundo escuro, para fundo claro e só o símbolo) são opcionais: a Ekoai escolhe a que se lê melhor no fundo de cada
// post. Envia e remove na hora, sem esperar o "Salvar" da seção. Cada logo abre ampliada, com fundo claro ou escuro à escolha. O
// arquivo só é lido por /api/brand/logo (com sessão).

import { useRef, useState } from 'react';
import Modal from '@/components/Modal';
import { ErrorLine, Spinner } from '@/components/auth/ui';

const MAX = 2 * 1024 * 1024;

export type LogoVariantId = 'main' | 'dark' | 'light' | 'symbol';
export type LogoIds = Record<LogoVariantId, string | null>;

const SLOTS: { id: LogoVariantId; name: string; help: string; bg: string }[] = [
  { id: 'main', name: 'Principal', help: 'Obrigatória. Usada quando não há uma versão melhor para o fundo.', bg: 'bg-paper' },
  { id: 'dark', name: 'Para fundo escuro', help: 'Versão clara, para posts de fundo escuro.', bg: 'bg-ink' },
  { id: 'light', name: 'Para fundo claro', help: 'Versão escura, para posts de fundo claro.', bg: 'bg-paper' },
  { id: 'symbol', name: 'Só o símbolo', help: 'Sem o nome: para cantos pequenos e lâminas de carrossel.', bg: 'bg-inset' },
];

// `onlyMain`: o cadastro em passos pede só a principal; as variações ficam para Configurações › Empresa.
type Props = { ids: LogoIds; canEdit: boolean; onChange: (ids: LogoIds) => void; onlyMain?: boolean };

export default function LogoField({ ids, canEdit, onChange, onlyMain = false }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const target = useRef<LogoVariantId>('main');
  const [busy, setBusy] = useState<LogoVariantId | null>(null);
  const [error, setError] = useState('');
  const [zoom, setZoom] = useState<LogoVariantId | null>(null);
  const [tone, setTone] = useState<'claro' | 'escuro'>('claro');

  const src = (id: LogoVariantId) => (ids[id] ? `/api/brand/logo?variant=${id}&v=${ids[id]}` : null);

  function pick(id: LogoVariantId) {
    target.current = id;
    input.current?.click();
  }

  async function send(file: File) {
    const variant = target.current;
    setError('');
    if (file.size > MAX) {
      setError(`O arquivo tem ${(file.size / 1048576).toFixed(1).replace('.', ',')} MB. Use PNG ou SVG de até 2 MB.`);
      return;
    }
    setBusy(variant);
    try {
      const form = new FormData();
      form.set('file', file);
      form.set('variant', variant);
      const res = await fetch('/api/brand/logo', { method: 'POST', body: form });
      const data = (await res.json().catch(() => ({}))) as { assetId?: string; error?: string };
      if (!res.ok || !data.assetId) setError(data.error ?? 'Não deu para enviar agora. Tente de novo em instantes.');
      else onChange({ ...ids, [variant]: data.assetId });
    } catch {
      setError('Sem conexão. Confira a rede e tente de novo.');
    } finally {
      setBusy(null);
      if (input.current) input.current.value = '';
    }
  }

  async function remove(variant: LogoVariantId) {
    setError('');
    setBusy(variant);
    try {
      const res = await fetch(`/api/brand/logo?variant=${variant}`, { method: 'DELETE' });
      if (!res.ok) setError('Não deu para tirar a logo agora. Tente de novo em instantes.');
      else onChange({ ...ids, [variant]: null });
    } catch {
      setError('Sem conexão. Confira a rede e tente de novo.');
    } finally {
      setBusy(null);
    }
  }

  const zoomSlot = SLOTS.find((s) => s.id === zoom);
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-semibold">
        Logo<span className="ml-1.5 font-normal text-muted">(opcional)</span>
      </p>
      <p className="text-sm text-muted">{onlyMain ? 'PNG ou SVG, até 2 MB. Fundo transparente fica melhor. As versões para fundo escuro, fundo claro e só o símbolo ficam em Configurações.' : 'Envie a logo principal e, se tiver, versões para fundo escuro, fundo claro e só o símbolo. A Ekoai escolhe a que se lê melhor em cada post.'}</p>
      <input ref={input} type="file" accept="image/png,image/svg+xml,.png,.svg" className="sr-only" tabIndex={-1} aria-label="Arquivo da logo" onChange={(e) => e.target.files?.[0] && void send(e.target.files[0])} />
      <div className={`grid gap-3 pt-2 ${onlyMain ? '' : 'sm:grid-cols-2 xl:grid-cols-4'}`}>
        {SLOTS.filter((s) => !onlyMain || s.id === 'main').map((s) => {
          const url = src(s.id);
          const here = busy === s.id;
          const blocked = s.id !== 'main' && !ids.main;
          return (
            <div key={s.id} className={`flex flex-col gap-2 rounded-lg border p-3 ${s.id === 'main' ? 'border-accent ring-2 ring-accent/30' : 'border-line'}`}>
              <div className="flex items-center justify-between gap-2">
                <strong className="text-sm">{s.name}</strong>
                <span className={`chip ${url ? 'border-success/40 text-success' : s.id === 'main' ? 'border-warning/40 text-warning' : ''}`}>{url ? 'Enviada' : s.id === 'main' ? 'Falta' : 'Opcional'}</span>
              </div>
              {url ? (
                <button type="button" onClick={() => setZoom(s.id)} aria-label={`Ampliar ${s.name}`} title="Ampliar" className={`flex h-24 items-center justify-center rounded-md border border-line transition hover:border-line-strong ${s.bg}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt={`Logo: ${s.name}`} className="max-h-20 max-w-[90%] object-contain" />
                </button>
              ) : (
                <div className="flex h-24 items-center justify-center rounded-md border border-dashed border-line-strong bg-inset px-2 text-center text-xs text-muted">{s.id === 'main' ? 'Nenhuma logo enviada' : 'Opcional'}</div>
              )}
              <small className="text-xs leading-snug text-muted">{blocked ? 'Envie primeiro a logo principal.' : s.help}</small>
              {canEdit && (
                <div className="flex flex-wrap gap-1.5">
                  <button type="button" className={url ? 'btn-ghost min-h-8 px-3 py-1 text-xs' : s.id === 'main' ? 'btn-primary min-h-8 px-3 py-1 text-xs' : 'btn-ghost min-h-8 px-3 py-1 text-xs'} disabled={!!busy || blocked} onClick={() => pick(s.id)}>
                    {here && <Spinner />}
                    {url ? 'Trocar' : 'Enviar'}
                  </button>
                  {url && (
                    <button type="button" className="btn-ghost min-h-8 px-3 py-1 text-xs" onClick={() => setZoom(s.id)}>
                      Ampliar
                    </button>
                  )}
                  {url && (
                    <button type="button" className="btn-ghost min-h-8 px-3 py-1 text-xs text-danger" disabled={!!busy} onClick={() => void remove(s.id)}>
                      Tirar
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {!canEdit && !ids.main && <p className="text-sm text-muted">A empresa ainda não enviou a logo.</p>}
      {error && <ErrorLine>{error}</ErrorLine>}
      {zoom && zoomSlot && src(zoom) && (
        <Modal title={zoomSlot.name} onClose={() => setZoom(null)} wide>
          <div className={`flex min-h-64 items-center justify-center rounded-lg border border-line p-6 ${tone === 'claro' ? 'bg-paper' : 'bg-ink'}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src(zoom) as string} alt={`Logo ampliada: ${zoomSlot.name}`} className="max-h-[60vh] max-w-full object-contain" />
          </div>
          <div className="flex items-center justify-between gap-3">
            <div role="group" aria-label="Fundo da prévia" className="inline-flex gap-1 rounded-full border border-line bg-inset p-0.5 text-sm">
              {(['claro', 'escuro'] as const).map((t) => (
                <button key={t} type="button" aria-pressed={tone === t} onClick={() => setTone(t)} className={`rounded-full px-3 py-1 font-semibold ${tone === t ? 'bg-raised text-fg shadow-sm' : 'text-muted hover:text-fg'}`}>
                  Fundo {t}
                </button>
              ))}
            </div>
            <button type="button" className="btn-ghost" onClick={() => setZoom(null)}>
              Fechar
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
