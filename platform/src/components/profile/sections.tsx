'use client';

// sections.tsx (perfil): os três blocos de formulário do perfil da empresa, usados no cadastro em
// passos e em Configurações › Empresa, e a chamada que grava uma seção (PUT /api/profile).

import type { Dispatch, SetStateAction } from 'react';
import { BODY_FONTS, CTAS, HEADING_FONTS, LIST_MAX_ITEMS, NICHES, BANNED_MAX_ITEMS, type CompanyProfile, type FieldErrors, type Section } from '@/lib/company-profile-model';
import { CTA_HELP, CTA_LABEL, sectionBody, type AboutForm, type VisualForm, type VoiceForm } from '@/lib/company-profile-form';
import { ChipsField, ColorField, Counter, ListField, RadioCards, ScaleField, SelectField, TextAreaField, TextField } from './ui';

// onChange é o setter do estado (aceita função): dois campos mudando no mesmo instante não se sobrescrevem.
// `onClearError` tira o erro de um campo quando a pessoa o edita: a mensagem não fica contradizendo o valor novo.
type Props<T> = { value: T; onChange: Dispatch<SetStateAction<T>>; errors: FieldErrors; onClearError: (field: string) => void; disabled?: boolean };

export function AboutSection({ value, onChange, errors, onClearError, disabled }: Props<AboutForm>) {
  const set = (patch: Partial<AboutForm>) => {
    onChange((v) => ({ ...v, ...patch }));
    Object.keys(patch).forEach(onClearError);
  };
  return (
    <div className="space-y-5">
      <SelectField label="Nicho" value={value.niche} onChange={(niche) => set({ niche })} options={NICHES} placeholder="Escolha o nicho" error={errors.niche} disabled={disabled} />
      <TextAreaField label="O que a empresa vende" value={value.offering} onChange={(offering) => set({ offering })} placeholder="Em 1 ou 2 frases" max={280} error={errors.offering} disabled={disabled} />
      <TextAreaField label="Para quem vende" value={value.audience} onChange={(audience) => set({ audience })} placeholder="Quem compra de você" max={280} error={errors.audience} disabled={disabled} />
      <div className="grid gap-5 sm:grid-cols-2">
        <TextField label="Cidade ou região" optional value={value.region} onChange={(region) => set({ region })} error={errors.region} disabled={disabled} />
        <TextField label="Site" optional value={value.site_url} onChange={(site_url) => set({ site_url })} placeholder="seusite.com.br" autoComplete="url" error={errors.site_url} disabled={disabled} />
      </div>
      <TextField label="@ do Instagram" optional value={value.instagram_handle} onChange={(instagram_handle) => set({ instagram_handle })} placeholder="@suamarca" help="Só para referência. A conexão com o Instagram é feita depois." error={errors.instagram_handle} disabled={disabled} />
    </div>
  );
}

export function VoiceSection({ value, onChange, errors, onClearError, disabled }: Props<VoiceForm>) {
  const set = (patch: Partial<VoiceForm>) => {
    onChange((v) => ({ ...v, ...patch }));
    Object.keys(patch).forEach(onClearError);
  };
  return (
    <div className="space-y-6">
      <div className="card space-y-4">
        <ScaleField label="Formalidade" left="Formal" right="Descontraído" value={value.voice_formal} onChange={(voice_formal) => set({ voice_formal })} disabled={disabled} />
        <ScaleField label="Linguagem" left="Técnico" right="Simples" value={value.voice_technical} onChange={(voice_technical) => set({ voice_technical })} disabled={disabled} />
        <ScaleField label="Humor" left="Sério" right="Bem-humorado" value={value.voice_serious} onChange={(voice_serious) => set({ voice_serious })} disabled={disabled} />
        {(errors.voice_formal || errors.voice_technical || errors.voice_serious) && <p role="alert" className="text-sm text-danger">{errors.voice_formal ?? errors.voice_technical ?? errors.voice_serious}</p>}
      </div>
      <ChipsField label="Palavras que a marca nunca usa" optional value={value.banned_words} onChange={(banned_words) => set({ banned_words })} placeholder="Digite e aperte Enter" max={BANNED_MAX_ITEMS} error={errors.banned_words} disabled={disabled} />
      <ListField label="Diferenciais" optional value={value.differentiators} onChange={(differentiators) => set({ differentiators })} placeholder="Ex.: entrega no mesmo dia" addLabel="Adicionar diferencial" itemLabel="Diferencial" max={LIST_MAX_ITEMS} error={errors.differentiators} disabled={disabled} />
      <ListField label="Dores do cliente" optional value={value.pains} onChange={(pains) => set({ pains })} placeholder="Ex.: não sabe quanto bolo pedir" addLabel="Adicionar dor" itemLabel="Dor do cliente" max={LIST_MAX_ITEMS} error={errors.pains} disabled={disabled} />
    </div>
  );
}

export function VisualSection({ value, onChange, errors, onClearError, disabled }: Props<VisualForm>) {
  const set = (patch: Partial<VisualForm>) => {
    onChange((v) => ({ ...v, ...patch }));
    Object.keys(patch).forEach(onClearError);
  };
  return (
    <div className="space-y-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <ColorField label="Cor principal" value={value.color_primary} onChange={(color_primary) => set({ color_primary })} error={errors.color_primary} disabled={disabled} />
        <ColorField label="Cor de destaque" value={value.color_accent} onChange={(color_accent) => set({ color_accent })} error={errors.color_accent} disabled={disabled} />
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <SelectField label="Fonte dos títulos" value={value.font_heading} onChange={(font_heading) => set({ font_heading })} options={HEADING_FONTS} placeholder="Escolha a fonte" error={errors.font_heading} disabled={disabled} />
        <SelectField label="Fonte do texto" value={value.font_body} onChange={(font_body) => set({ font_body })} options={BODY_FONTS} placeholder="Escolha a fonte" error={errors.font_body} disabled={disabled} />
      </div>
      <RadioCards
        legend="Para onde o post leva as pessoas"
        value={value.cta_default as (typeof CTAS)[number] | ''}
        onChange={(cta_default) => set({ cta_default })}
        options={CTAS.map((c) => ({ value: c, label: CTA_LABEL[c], help: CTA_HELP[c] }))}
        disabled={disabled}
      />
      <Counter label="Posts por semana" value={value.posts_per_week} onChange={(posts_per_week) => set({ posts_per_week })} min={1} max={14} help="Vira a grade de horários de publicação. Dá para mudar em Configurações." error={errors.posts_per_week} disabled={disabled} />
    </div>
  );
}

export type SaveResult = { ok: true; profile: CompanyProfile } | { ok: false; error: string; fields: FieldErrors; unauthorized: boolean };

// Grava uma seção. Erro de campo volta com o nome do campo; 401 pede para entrar de novo.
export async function saveProfileSection(section: Section, form: AboutForm | VoiceForm | VisualForm): Promise<SaveResult> {
  try {
    const res = await fetch('/api/profile', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(sectionBody(section, form)) });
    const data = (await res.json().catch(() => ({}))) as { profile?: CompanyProfile; error?: string; fields?: FieldErrors };
    if (res.ok && data.profile) return { ok: true, profile: data.profile };
    return { ok: false, error: data.error ?? 'Não deu para salvar agora. Seus dados continuam aqui: tente de novo em instantes.', fields: data.fields ?? {}, unauthorized: res.status === 401 };
  } catch {
    return { ok: false, error: 'Sem conexão. Seus dados continuam aqui: confira a rede e tente de novo.', fields: {}, unauthorized: false };
  }
}
