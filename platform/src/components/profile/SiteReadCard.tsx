'use client';

// SiteReadCard.tsx: "Ler minha marca" (SPEC 033, BEZ-525). A pessoa informa o site, a Ekoai lê e mostra o que achou; ela escolhe as cores
// e aplica ao formulário do Visual, que ela ainda revisa e salva. Nada é gravado aqui.

import { useState } from 'react';
import { ErrorLine, Spinner } from '@/components/auth/ui';
import type { SiteRead } from '@/lib/site-read/extract';

type Props = { initialSite: string; disabled?: boolean; onApply: (read: SiteRead, colors: string[]) => number };

export default function SiteReadCard({ initialSite, disabled, onApply }: Props) {
  const [site, setSite] = useState(initialSite);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [read, setRead] = useState<SiteRead | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [applied, setApplied] = useState<number | null>(null);

  async function run() {
    setBusy(true);
    setError('');
    setRead(null);
    setApplied(null);
    try {
      const res = await fetch('/api/profile/site-read', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ site_url: site }) });
      const data = (await res.json().catch(() => ({}))) as { read?: SiteRead; error?: string };
      if (res.ok && data.read) {
        setRead(data.read);
        setPicked(data.read.colors);
      } else {
        setError(data.error ?? 'Não deu para ler o site agora. Tente de novo em instantes ou preencha à mão.');
      }
    } catch {
      setError('Sem conexão. Confira a rede e tente de novo.');
    }
    setBusy(false);
  }

  const nothing = read && !read.colors.length && !read.fonts.heading && !read.fonts.body;

  return (
    <div className="space-y-3 rounded-lg border border-line bg-inset p-3">
      <div>
        <p className="text-sm font-semibold">Ler minha marca</p>
        <p className="text-sm text-muted">A Ekoai lê o seu site público e sugere cores e fontes. Você escolhe o que usar e revisa antes de salvar.</p>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-48 flex-1 space-y-1.5">
          <label htmlFor="site-read-url" className="text-sm font-semibold">
            Site da empresa
          </label>
          <input id="site-read-url" className="input" value={site} onChange={(e) => setSite(e.target.value)} placeholder="seusite.com.br" disabled={disabled || busy} autoComplete="url" inputMode="url" />
        </div>
        <button type="button" className="btn-primary" disabled={disabled || busy || !site.trim()} onClick={() => void run()}>
          {busy && <Spinner />}
          {busy ? 'Lendo' : 'Ler minha marca'}
        </button>
      </div>
      {error && <ErrorLine>{error}</ErrorLine>}
      {read && (
        <div className="space-y-3" aria-live="polite">
          {nothing ? (
            <p className="text-sm text-muted">Achamos pouco em {new URL(read.url).hostname}: o site quase não declara cores nem fontes. Preencha à mão.</p>
          ) : (
            <>
              {read.colors.length > 0 && (
                <fieldset className="space-y-1.5">
                  <legend className="text-sm font-semibold">Cores achadas</legend>
                  <div className="flex flex-wrap gap-2">
                    {read.colors.map((hex) => {
                      const on = picked.includes(hex);
                      return (
                        <label key={hex} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2 py-1.5 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/30 ${on ? 'border-accent-text bg-raised' : 'border-line-strong'}`}>
                          <input type="checkbox" className="sr-only" checked={on} onChange={() => setPicked(on ? picked.filter((c) => c !== hex) : [...picked, hex])} />
                          <span aria-hidden="true" className="h-5 w-5 rounded border border-line-strong" style={{ background: hex }} />
                          <span className="font-mono">{hex}</span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
              )}
              {(read.fonts.heading || read.fonts.body) && (
                <p className="text-sm">
                  <span className="font-semibold">Fontes: </span>
                  {[read.fonts.heading && `títulos em ${read.fonts.heading}`, read.fonts.body && `texto em ${read.fonts.body}`].filter(Boolean).join(', ')}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" className="btn-primary" disabled={disabled || (!picked.length && !read.fonts.heading && !read.fonts.body)} onClick={() => setApplied(onApply(read, picked))}>
                  Usar no visual
                </button>
                {applied !== null && (
                  <span role="status" className="text-sm text-success">
                    {applied > 0 ? `${applied} ${applied === 1 ? 'cor entrou' : 'cores entraram'} no visual. Revise e salve.` : 'Nada novo para entrar: as cores já estão no visual.'}
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
