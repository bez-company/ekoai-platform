'use client';

// SiteReadCard.tsx: "Ler minha marca" (SPEC 033, BEZ-525). A pessoa informa o site, a Ekoai lê e mostra o que achou. Cores e fontes vão
// para o formulário do Visual (que ela revisa e salva). Negócio, jeito de falar, fatos e logo ela escolhe item a item e aplica daqui;
// o fato entra como rascunho e a logo só entra se a conta ainda não tem uma. Nada é gravado antes de ela aplicar.

import { useState } from 'react';
import { ErrorLine, Spinner } from '@/components/auth/ui';
import type { SiteRead } from '@/lib/site-read/extract';
import type { Understanding } from '@/lib/site-read/understand-model';
import { NICHES } from '@/lib/company-profile-model';

type Response = { read: SiteRead; understanding: Understanding | null; notice: string | null };
type ApplyResult = { applied: { about: boolean; voice: boolean; differentiators: number; pains: number; facts: number; logo: boolean }; skipped: string[] };

type Props = {
  initialSite: string;
  disabled?: boolean;
  // Cores e fontes: põe no formulário do Visual e devolve quantas cores entraram.
  onApply: (read: SiteRead, colors: string[]) => number;
  // Depois de aplicar negócio, jeito de falar, fatos ou logo: a tela de cima recarrega o perfil.
  onApplied?: () => void;
};

const SCALES = [
  ['formal', 'Formal', 'Descontraído'],
  ['technical', 'Técnico', 'Simples'],
  ['serious', 'Sério', 'Bem-humorado'],
] as const;

function Pick({ on, onChange, label, children }: { on: boolean; onChange: (v: boolean) => void; label: string; children: React.ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 py-1.5 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/30">
      <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-[rgb(var(--c-accent-text))]" checked={on} onChange={(e) => onChange(e.target.checked)} aria-label={label} />
      <span className="min-w-0 flex-1">{children}</span>
    </label>
  );
}

export default function SiteReadCard({ initialSite, disabled, onApply, onApplied }: Props) {
  const [site, setSite] = useState(initialSite);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [res, setRes] = useState<Response | null>(null);
  const [colors, setColors] = useState<string[]>([]);
  const [colorsDone, setColorsDone] = useState<number | null>(null);
  const [about, setAbout] = useState<Record<string, { on: boolean; value: string }>>({});
  const [voiceOn, setVoiceOn] = useState(true);
  const [lists, setLists] = useState<{ differentiators: boolean[]; pains: boolean[]; facts: boolean[] }>({ differentiators: [], pains: [], facts: [] });
  const [logoOn, setLogoOn] = useState(true);
  const [applying, setApplying] = useState(false);
  const [done, setDone] = useState<ApplyResult | null>(null);

  async function run() {
    setBusy(true);
    setError('');
    setRes(null);
    setDone(null);
    setColorsDone(null);
    try {
      const r = await fetch('/api/profile/site-read', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ site_url: site }) });
      const data = (await r.json().catch(() => ({}))) as Partial<Response> & { error?: string };
      if (r.ok && data.read) {
        const u = data.understanding ?? null;
        setRes({ read: data.read, understanding: u, notice: data.notice ?? null });
        setColors(data.read.colors);
        setAbout(Object.fromEntries((['niche', 'offering', 'audience', 'region'] as const).filter((k) => u?.about[k]).map((k) => [k, { on: true, value: u!.about[k]! }])));
        setVoiceOn(true);
        setLists({ differentiators: (u?.differentiators ?? []).map(() => true), pains: (u?.pains ?? []).map(() => true), facts: (u?.facts ?? []).map(() => true) });
        setLogoOn(!!data.read.logoUrl);
      } else {
        setError(data.error ?? 'Não deu para ler o site agora. Tente de novo em instantes ou preencha à mão.');
      }
    } catch {
      setError('Sem conexão. Confira a rede e tente de novo.');
    }
    setBusy(false);
  }

  async function apply() {
    if (!res) return;
    const u = res.understanding;
    const chosen = <T,>(items: T[], flags: boolean[]) => items.filter((_, i) => flags[i]);
    const aboutPick = Object.fromEntries(Object.entries(about).filter(([, v]) => v.on && v.value.trim()).map(([k, v]) => [k, v.value.trim()]));
    setApplying(true);
    setError('');
    try {
      const r = await fetch('/api/profile/site-read/apply', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          site_url: res.read.url,
          about: Object.keys(aboutPick).length ? aboutPick : undefined,
          voice: u && voiceOn ? Object.fromEntries(Object.entries(u.voice).filter(([, v]) => v != null)) : undefined,
          differentiators: chosen(u?.differentiators ?? [], lists.differentiators),
          pains: chosen(u?.pains ?? [], lists.pains),
          facts: chosen(u?.facts ?? [], lists.facts).map((f) => ({ text: f.text, category: f.category, source_note: f.source_note })),
          logo_url: logoOn ? res.read.logoUrl : undefined,
        }),
      });
      const data = (await r.json().catch(() => ({}))) as Partial<ApplyResult> & { error?: string };
      if (r.ok && data.applied) {
        setDone(data as ApplyResult);
        onApplied?.();
      } else setError(data.error ?? 'Não deu para aplicar agora. Seus dados continuam aqui: tente de novo em instantes.');
    } catch {
      setError('Sem conexão. Seus dados continuam aqui: confira a rede e tente de novo.');
    }
    setApplying(false);
  }

  const u = res?.understanding ?? null;
  const hasText = !!u && (Object.keys(about).length > 0 || u.voice.formal != null || u.voice.technical != null || u.voice.serious != null || u.differentiators.length > 0 || u.pains.length > 0 || u.facts.length > 0);
  const anyTextPick =
    Object.values(about).some((v) => v.on) || (!!u && voiceOn && Object.values(u.voice).some((v) => v != null)) || Object.values(lists).some((l) => l.some(Boolean)) || (logoOn && !!res?.read.logoUrl);
  const nothing = res && !res.read.colors.length && !res.read.fonts.heading && !res.read.fonts.body && !hasText && !res.read.logoUrl;
  const origin = (url: string) => {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  };
  const where = (url: string) => {
    try {
      const u = new URL(url);
      return `${u.hostname}${u.pathname === '/' ? '' : u.pathname}`;
    } catch {
      return url;
    }
  };

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

      {res && !done && (
        <div className="space-y-4" aria-live="polite">
          {res.notice && <p className="text-sm text-muted">{res.notice}</p>}
          {nothing && <p className="text-sm text-muted">Achamos pouco em {origin(res.read.url)}: o site quase não declara cores, fontes nem texto. Preencha à mão.</p>}

          {(res.read.colors.length > 0 || res.read.fonts.heading || res.read.fonts.body) && (
            <div className="space-y-2">
              {res.read.colors.length > 0 && (
                <fieldset className="space-y-1.5">
                  <legend className="text-sm font-semibold">Cores achadas</legend>
                  <div className="flex flex-wrap gap-2">
                    {res.read.colors.map((hex) => {
                      const on = colors.includes(hex);
                      return (
                        <label key={hex} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2 py-1.5 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/30 ${on ? 'border-accent-text bg-raised' : 'border-line-strong'}`}>
                          <input type="checkbox" className="sr-only" checked={on} onChange={() => setColors(on ? colors.filter((c) => c !== hex) : [...colors, hex])} />
                          <span aria-hidden="true" className="h-5 w-5 rounded border border-line-strong" style={{ background: hex }} />
                          <span className="font-mono">{hex}</span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
              )}
              {(res.read.fonts.heading || res.read.fonts.body) && (
                <p className="text-sm">
                  <span className="font-semibold">Fontes: </span>
                  {[res.read.fonts.heading && `títulos em ${res.read.fonts.heading}`, res.read.fonts.body && `texto em ${res.read.fonts.body}`].filter(Boolean).join(', ')}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" className="btn-ghost" disabled={disabled || (!colors.length && !res.read.fonts.heading && !res.read.fonts.body)} onClick={() => setColorsDone(onApply(res.read, colors))}>
                  Usar cores e fontes no visual
                </button>
                {colorsDone !== null && (
                  <span role="status" className="text-sm text-success">
                    {colorsDone > 0 ? `${colorsDone} ${colorsDone === 1 ? 'cor entrou' : 'cores entraram'} no visual. Revise e salve abaixo.` : 'Nada novo para entrar: as cores já estão no visual.'}
                  </span>
                )}
              </div>
            </div>
          )}

          {hasText && u && (
            <div className="space-y-3 border-t border-line pt-3">
              {Object.keys(about).length > 0 && (
                <fieldset>
                  <legend className="text-sm font-semibold">Negócio</legend>
                  {(['niche', 'offering', 'audience', 'region'] as const).filter((k) => about[k]).map((k) => (
                    <Pick key={k} on={about[k].on} onChange={(on) => setAbout({ ...about, [k]: { ...about[k], on } })} label={`Usar ${{ niche: 'o nicho', offering: 'o que a empresa vende', audience: 'para quem vende', region: 'a região' }[k]}`}>
                      <span className="block text-xs text-muted">{{ niche: 'Nicho', offering: 'O que a empresa vende', audience: 'Para quem vende', region: 'Cidade ou região' }[k]}</span>
                      {k === 'niche' ? (
                        <span>{NICHES.includes(about[k].value as (typeof NICHES)[number]) ? about[k].value : ''}</span>
                      ) : (
                        <input className="input mt-1" value={about[k].value} onChange={(e) => setAbout({ ...about, [k]: { ...about[k], value: e.target.value } })} aria-label={`Editar ${k}`} />
                      )}
                    </Pick>
                  ))}
                </fieldset>
              )}

              {(u.voice.formal != null || u.voice.technical != null || u.voice.serious != null) && (
                <fieldset>
                  <legend className="text-sm font-semibold">Jeito de falar</legend>
                  <Pick on={voiceOn} onChange={setVoiceOn} label="Usar o jeito de falar">
                    {SCALES.filter(([k]) => u.voice[k] != null).map(([k, high, low]) => (
                      <span key={k} className="block">
                        {low} ({1}) a {high} ({5}): <strong>{u.voice[k]}</strong>
                      </span>
                    ))}
                  </Pick>
                </fieldset>
              )}

              {(['differentiators', 'pains'] as const).map((key) =>
                u[key].length ? (
                  <fieldset key={key}>
                    <legend className="text-sm font-semibold">{key === 'differentiators' ? 'Diferenciais' : 'Dores do cliente'}</legend>
                    {u[key].map((item, i) => (
                      <Pick key={item} on={!!lists[key][i]} onChange={(on) => setLists({ ...lists, [key]: lists[key].map((v, j) => (j === i ? on : v)) })} label={`Usar: ${item}`}>
                        {item}
                      </Pick>
                    ))}
                  </fieldset>
                ) : null,
              )}

              {u.facts.length > 0 && (
                <fieldset>
                  <legend className="text-sm font-semibold">
                    Fatos <span className="chip">rascunho</span>
                  </legend>
                  <p className="text-xs text-muted">Entram em Fatos da empresa para você confirmar a validade. Os posts só usam fato confirmado.</p>
                  {u.facts.map((f, i) => (
                    <Pick key={f.text} on={!!lists.facts[i]} onChange={(on) => setLists({ ...lists, facts: lists.facts.map((v, j) => (j === i ? on : v)) })} label={`Usar o fato: ${f.text}`}>
                      <span>{f.text}</span>
                      {f.source_note && <span className="block text-xs text-muted">Origem: {where(f.source_note)}</span>}
                    </Pick>
                  ))}
                </fieldset>
              )}
            </div>
          )}

          {res.read.logoUrl && (
            <fieldset className="border-t border-line pt-3">
              <legend className="text-sm font-semibold">Logo</legend>
              <Pick on={logoOn} onChange={setLogoOn} label="Usar a logo do site">
                Logo achada em {origin(res.read.logoUrl)}. <span className="text-muted">Só entra se a conta ainda não tem uma logo principal.</span>
              </Pick>
            </fieldset>
          )}

          {(hasText || res.read.logoUrl) && (
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" className="btn-primary" disabled={disabled || applying || !anyTextPick} onClick={() => void apply()}>
                {applying && <Spinner />}
                Aplicar o que marquei
              </button>
              <span className="text-sm text-muted">Negócio, jeito de falar, fatos e logo. Cores e fontes você aplica acima.</span>
            </div>
          )}
        </div>
      )}

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
