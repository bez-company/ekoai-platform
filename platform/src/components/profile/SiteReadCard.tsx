'use client';

// SiteReadCard.tsx: "Ler minha marca" no perfil (SPEC 033, BEZ-525). A pessoa informa o site, a Ekoai lê e mostra o que achou (SiteReview).
// Cores e fontes vão para o formulário do Visual, que ela revisa e salva; negócio, jeito de falar, fatos e logo ela aplica daqui. O fato
// entra como rascunho e a logo só entra se a conta ainda não tem uma. Nada é gravado antes de ela aplicar.

import { useState } from 'react';
import { ErrorLine, Spinner } from '@/components/auth/ui';
import type { SiteRead } from '@/lib/site-read/extract';
import SiteReadProgress from './SiteReadProgress';
import SiteReview, { type SiteResponse } from './SiteReview';
import { applyRequest, type ApplyResult } from './site-read-api';
import { useSiteRead } from './useSiteRead';

export { applyRequest, readSiteRequest, type ApplyResult } from './site-read-api';

type Props = {
  initialSite: string;
  disabled?: boolean;
  // Cores e fontes: põe no formulário do Visual e devolve quantas cores entraram.
  onApply: (read: SiteRead, colors: string[]) => number;
  // Depois de aplicar negócio, jeito de falar, fatos ou logo: a tela de cima recarrega o perfil.
  onApplied?: () => void;
};

export default function SiteReadCard({ initialSite, disabled, onApply, onApplied }: Props) {
  const [site, setSite] = useState(initialSite);
  const siteRead = useSiteRead();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [res, setRes] = useState<SiteResponse | null>(null);
  const [applying, setApplying] = useState(false);
  const [done, setDone] = useState<ApplyResult | null>(null);

  async function run() {
    setBusy(true);
    setError('');
    setRes(null);
    setDone(null);
    const out = await siteRead.start(site.trim());
    if (out.ok) setRes(out.res);
    else setError(out.error);
    setBusy(false);
  }

  async function apply(body: Record<string, unknown>) {
    setApplying(true);
    setError('');
    const out = await applyRequest(body);
    setApplying(false);
    if (out.ok) {
      setDone(out.result);
      onApplied?.();
    } else setError(out.error);
  }

  return (
    <div className="space-y-3 rounded-lg border border-line bg-inset p-3">
      <div>
        <p className="text-sm font-semibold">Ler minha marca</p>
        <p className="text-sm text-muted">A Ekoai lê o seu site público e sugere cores, fontes, jeito de falar e fatos. Você escolhe o que usar; nada é salvo antes disso.</p>
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
      {busy && <SiteReadProgress view={siteRead.view} mode={siteRead.mode} reconnecting={siteRead.reconnecting} site={site.trim()} stack />}
      {error && <ErrorLine>{error}</ErrorLine>}

      {res && !done && <SiteReview res={res} mode="card" disabled={disabled} submitting={applying} submitLabel="Aplicar o que marquei" onApplyColors={onApply} onSubmit={(body) => void apply(body)} />}

      {done && (
        <div className="space-y-1.5" role="status">
          <p className="text-sm font-semibold text-success">Pronto. O perfil foi atualizado.</p>
          <ul className="list-disc pl-5 text-sm">
            {done.applied.about && <li>Negócio atualizado.</li>}
            {done.applied.voice && <li>Jeito de falar atualizado.</li>}
            {done.applied.differentiators > 0 && <li>{done.applied.differentiators} {done.applied.differentiators === 1 ? 'diferencial novo' : 'diferenciais novos'}.</li>}
            {done.applied.pains > 0 && <li>{done.applied.pains} {done.applied.pains === 1 ? 'dor do cliente nova' : 'dores do cliente novas'}.</li>}
            {done.applied.facts > 0 && <li>{done.applied.facts} {done.applied.facts === 1 ? 'fato espera' : 'fatos esperam'} a sua confirmação em Fatos da empresa.</li>}
            {done.applied.logo && <li>Logo do site guardada como principal.</li>}
          </ul>
          {done.skipped.length > 0 && <p className="text-sm text-muted">{done.skipped.join(' ')}</p>}
        </div>
      )}
    </div>
  );
}
