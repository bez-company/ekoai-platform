'use client';

// SiteReview.tsx: a revisão do que a Ekoai leu no site (SPEC 033, BEZ-525). A pessoa escolhe item a item e edita o negócio antes de qualquer
// gravação. Dois usos: o cartão "Ler minha marca" do perfil (modo `card`: cores e fontes têm botão próprio e vão para o formulário do Visual)
// e a confirmação do cadastro rápido (modo `signup`: nicho, o que vende e para quem são obrigatórios, e as cores e fontes entram junto).

import { useState, type ReactNode } from 'react';
import { Spinner } from '@/components/auth/ui';
import Select from '@/components/ui/Select';
import { NICHES } from '@/lib/company-profile-model';
import type { SiteRead } from '@/lib/site-read/extract';
import type { Understanding } from '@/lib/site-read/understand-model';

export type SiteResponse = { read: SiteRead; understanding: Understanding | null; notice: string | null };

type Props = {
  res: SiteResponse;
  mode: 'card' | 'signup';
  disabled?: boolean;
  submitting?: boolean;
  submitLabel: string;
  // Modo card: põe cores e fontes no formulário do Visual e devolve quantas cores entraram.
  onApplyColors?: (read: SiteRead, colors: string[]) => number;
  // O corpo de /api/profile/site-read/apply e as cores escolhidas (o modo signup as aplica junto).
  onSubmit: (body: Record<string, unknown>, colors: string[]) => void;
};

const SCALES = [
  ['formal', 'Formal', 'Descontraído'],
  ['technical', 'Técnico', 'Simples'],
  ['serious', 'Sério', 'Bem-humorado'],
] as const;
const ABOUT_KEYS = ['niche', 'offering', 'audience', 'region'] as const;
const ABOUT_LABEL = { niche: 'Nicho', offering: 'O que a empresa vende', audience: 'Para quem vende', region: 'Cidade ou região' } as const;
const REQUIRED = ['niche', 'offering', 'audience'] as const;

function Pick({ on, onChange, label, children }: { on: boolean; onChange: (v: boolean) => void; label: string; children: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 py-1.5 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/30">
      <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-[rgb(var(--c-accent-text))]" checked={on} onChange={(e) => onChange(e.target.checked)} aria-label={label} />
      <span className="min-w-0 flex-1">{children}</span>
    </label>
  );
}

const origin = (url: string): string => {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
};
const where = (url: string): string => {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname === '/' ? '' : u.pathname}`;
  } catch {
    return url;
  }
};

export default function SiteReview({ res, mode, disabled, submitting, submitLabel, onApplyColors, onSubmit }: Props) {
  const u = res.understanding;
  const signup = mode === 'signup';
  const [colors, setColors] = useState<string[]>(res.read.colors);
  const [colorsDone, setColorsDone] = useState<number | null>(null);
  const [about, setAbout] = useState<Record<string, { on: boolean; value: string }>>(() =>
    Object.fromEntries(ABOUT_KEYS.filter((k) => signup || u?.about[k]).map((k) => [k, { on: true, value: u?.about[k] ?? '' }])),
  );
  const [voiceOn, setVoiceOn] = useState(true);
  const [lists, setLists] = useState({ differentiators: (u?.differentiators ?? []).map(() => true), pains: (u?.pains ?? []).map(() => true), facts: (u?.facts ?? []).map(() => true) });
  const [logoOn, setLogoOn] = useState(!!res.read.logoUrl);

  const hasVoice = !!u && (u.voice.formal != null || u.voice.technical != null || u.voice.serious != null);
  const hasText = !!u && (Object.values(about).some((v) => v.value) || hasVoice || u.differentiators.length > 0 || u.pains.length > 0 || u.facts.length > 0);
  const anyPick = Object.values(about).some((v) => v.on && v.value.trim()) || (hasVoice && voiceOn) || Object.values(lists).some((l) => l.some(Boolean)) || (logoOn && !!res.read.logoUrl) || (signup && (colors.length > 0 || !!res.read.fonts.heading || !!res.read.fonts.body));
  const missing = signup ? REQUIRED.filter((k) => !about[k]?.value.trim()) : [];
  const nothing = !res.read.colors.length && !res.read.fonts.heading && !res.read.fonts.body && !hasText && !res.read.logoUrl;

  function submit() {
    const chosen = <T,>(items: T[], flags: boolean[]) => items.filter((_, i) => flags[i]);
    const aboutPick = Object.fromEntries(Object.entries(about).filter(([, v]) => v.on && v.value.trim()).map(([k, v]) => [k, v.value.trim()]));
    onSubmit(
      {
        site_url: res.read.url,
        about: Object.keys(aboutPick).length ? aboutPick : undefined,
        voice: u && voiceOn ? Object.fromEntries(Object.entries(u.voice).filter(([, v]) => v != null)) : undefined,
        differentiators: chosen(u?.differentiators ?? [], lists.differentiators),
        pains: chosen(u?.pains ?? [], lists.pains),
        facts: chosen(u?.facts ?? [], lists.facts).map((f) => ({ text: f.text, category: f.category, source_note: f.source_note })),
        logo_url: logoOn ? res.read.logoUrl : undefined,
      },
      colors,
    );
  }

  const setField = (k: string, patch: Partial<{ on: boolean; value: string }>) => setAbout({ ...about, [k]: { ...about[k], ...patch } });

  return (
    <div className="space-y-4" aria-live="polite">
      {res.notice && <p className="text-sm text-muted">{res.notice}</p>}
      {nothing && !signup && <p className="text-sm text-muted">Achamos pouco em {origin(res.read.url)}: o site quase não declara cores, fontes nem texto. Preencha à mão.</p>}

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
          {signup ? (
            <p className="text-sm text-muted">As cores marcadas e as fontes entram no visual da marca.</p>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" className="btn-ghost" disabled={disabled || (!colors.length && !res.read.fonts.heading && !res.read.fonts.body)} onClick={() => onApplyColors && setColorsDone(onApplyColors(res.read, colors))}>
                Usar cores e fontes no visual
              </button>
              {colorsDone !== null && (
                <span role="status" className="text-sm text-success">
                  {colorsDone > 0 ? `${colorsDone} ${colorsDone === 1 ? 'cor entrou' : 'cores entraram'} no visual. Revise e salve abaixo.` : 'Nada novo para entrar: as cores já estão no visual.'}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {(hasText || signup) && (
        <div className="space-y-3 border-t border-line pt-3">
          {Object.keys(about).length > 0 && (
            <fieldset>
              <legend className="text-sm font-semibold">Negócio</legend>
              {ABOUT_KEYS.filter((k) => about[k]).map((k) =>
                k === 'niche' && signup ? (
                  // O seletor é um botão: fica fora do rótulo da caixa de seleção, para o clique não marcar nem desmarcar.
                  <div key={k} className="flex items-start gap-2.5 py-1.5 text-sm">
                    <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-[rgb(var(--c-accent-text))]" checked={about.niche.on} onChange={(e) => setField('niche', { on: e.target.checked })} aria-label={`Usar: ${ABOUT_LABEL.niche}`} />
                    <div className="min-w-0 flex-1 space-y-1">
                      <span className="block text-xs text-muted">{ABOUT_LABEL.niche} (obrigatório)</span>
                      <Select value={about.niche.value} onChange={(value) => setField('niche', { value })} options={NICHES.map((n) => ({ value: n, label: n }))} placeholder="Escolha o nicho" ariaLabel="Nicho" disabled={disabled} />
                    </div>
                  </div>
                ) : (
                  <Pick key={k} on={about[k].on} onChange={(on) => setField(k, { on })} label={`Usar: ${ABOUT_LABEL[k]}`}>
                    <span className="block text-xs text-muted">
                      {ABOUT_LABEL[k]}
                      {(REQUIRED as readonly string[]).includes(k) && signup ? ' (obrigatório)' : ''}
                    </span>
                    {k === 'niche' ? <span>{about.niche.value}</span> : <input className="input mt-1" value={about[k].value} onChange={(e) => setField(k, { value: e.target.value })} aria-label={`Editar: ${ABOUT_LABEL[k]}`} />}
                  </Pick>
                ),
              )}
            </fieldset>
          )}

          {hasVoice && u && (
            <fieldset>
              <legend className="text-sm font-semibold">Jeito de falar</legend>
              <Pick on={voiceOn} onChange={setVoiceOn} label="Usar o jeito de falar">
                {SCALES.filter(([k]) => u.voice[k] != null).map(([k, high, low]) => (
                  <span key={k} className="block">
                    {low} (1) a {high} (5): <strong>{u.voice[k]}</strong>
                  </span>
                ))}
              </Pick>
            </fieldset>
          )}

          {u && (['differentiators', 'pains'] as const).map((key) =>
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

          {u && u.facts.length > 0 && (
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

      {(hasText || res.read.logoUrl || signup) && (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn-primary" disabled={disabled || submitting || !anyPick || missing.length > 0} onClick={submit}>
            {submitting && <Spinner />}
            {submitLabel}
          </button>
          {missing.length > 0 ? (
            <span className="text-sm text-muted">Falta preencher: {missing.map((k) => ABOUT_LABEL[k].toLowerCase()).join(', ')}.</span>
          ) : (
            !signup && <span className="text-sm text-muted">Negócio, jeito de falar, fatos e logo. Cores e fontes você aplica acima.</span>
          )}
        </div>
      )}
    </div>
  );
}
