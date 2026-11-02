'use client';

// SiteReadCard.tsx: "Ler minha marca" no perfil (SPEC 033, BEZ-525). A pessoa informa o site, a Ekoai lê e mostra o que achou (SiteReview).
// Cores e fontes vão para o formulário do Visual, que ela revisa e salva; negócio, jeito de falar, fatos e logo ela aplica daqui. O fato
// entra como rascunho e a logo só entra se a conta ainda não tem uma. Nada é gravado antes de ela aplicar.

import { useState } from 'react';
import { ErrorLine, Spinner } from '@/components/auth/ui';
import type { SiteRead } from '@/lib/site-read/extract';
import SiteReview, { type SiteResponse } from './SiteReview';

export type ApplyResult = { applied: { about: boolean; voice: boolean; differentiators: number; pains: number; facts: number; logo: boolean }; skipped: string[] };

type Props = {
  initialSite: string;
  disabled?: boolean;
  // Cores e fontes: põe no formulário do Visual e devolve quantas cores entraram.
  onApply: (read: SiteRead, colors: string[]) => number;
  // Depois de aplicar negócio, jeito de falar, fatos ou logo: a tela de cima recarrega o perfil.
  onApplied?: () => void;
};

export async function readSiteRequest(site: string): Promise<{ ok: true; res: SiteResponse } | { ok: false; error: string }> {
  try {
    const r = await fetch('/api/profile/site-read', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ site_url: site }) });
    const data = (await r.json().catch(() => ({}))) as Partial<SiteResponse> & { error?: string };
    if (r.ok && data.read) return { ok: true, res: { read: data.read, understanding: data.understanding ?? null, notice: data.notice ?? null, instagram: data.instagram } };
    return { ok: false, error: data.error ?? 'Não deu para ler o site agora. Tente de novo em instantes ou preencha à mão.' };
  } catch {
    return { ok: false, error: 'Sem conexão. Confira a rede e tente de novo.' };
  }
}

export async function applyRequest(body: Record<string, unknown>): Promise<{ ok: true; result: ApplyResult } | { ok: false; error: string }> {
  try {
    const r = await fetch('/api/profile/site-read/apply', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const data = (await r.json().catch(() => ({}))) as Partial<ApplyResult> & { error?: string };
    if (r.ok && data.applied) return { ok: true, result: data as ApplyResult };
    return { ok: false, error: data.error ?? 'Não deu para aplicar agora. Seus dados continuam aqui: tente de novo em instantes.' };
  } catch {
    return { ok: false, error: 'Sem conexão. Seus dados continuam aqui: confira a rede e tente de novo.' };
  }
}

export default function SiteReadCard({ initialSite, disabled, onApply, onApplied }: Props) {
  const [site, setSite] = useState(initialSite);
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
    const out = await readSiteRequest(site);
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
      {busy && <p className="text-sm text-muted">Lendo o site e entendendo a empresa. Leva cerca de 1 minuto.</p>}
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
