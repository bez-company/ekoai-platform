// company-profile-form.ts: o que as telas do perfil calculam, sem I/O (SPEC 011 R3). Estado dos
// formulários por seção (mesmos nomes do corpo de PUT /api/profile), progresso do perfil e os
// textos de resumo. A validação de verdade é do servidor (company-profile-model.ts).

import type { CompanyProfile, Section } from './company-profile-model';

export type AboutForm = { niche: string; offering: string; audience: string; region: string; site_url: string; instagram_handle: string };
export type VoiceForm = {
  voice_formal: number | null;
  voice_technical: number | null;
  voice_serious: number | null;
  banned_words: string[];
  differentiators: string[];
  pains: string[];
};
export type VisualForm = { color_primary: string; color_accent: string; font_heading: string; font_body: string; cta_default: string };

export function aboutFromProfile(p: CompanyProfile | null): AboutForm {
  return {
    niche: p?.niche ?? '',
    offering: p?.offering ?? '',
    audience: p?.audience ?? '',
    region: p?.region ?? '',
    site_url: p?.siteUrl ?? '',
    instagram_handle: p?.instagramHandle ? `@${p.instagramHandle}` : '',
  };
}

export function voiceFromProfile(p: CompanyProfile | null): VoiceForm {
  return {
    voice_formal: p?.voiceFormal ?? null,
    voice_technical: p?.voiceTechnical ?? null,
    voice_serious: p?.voiceSerious ?? null,
    banned_words: p?.bannedWords ?? [],
    differentiators: p?.differentiators.length ? p.differentiators : [''],
    pains: p?.pains.length ? p.pains : [''],
  };
}

export function visualFromProfile(p: CompanyProfile | null): VisualForm {
  return {
    color_primary: p?.colorPrimary ?? '',
    color_accent: p?.colorAccent ?? '',
    font_heading: p?.fontHeading ?? '',
    font_body: p?.fontBody ?? '',
    cta_default: p?.ctaDefault ?? '',
  };
}

export function sectionBody(section: Section, form: AboutForm | VoiceForm | VisualForm): Record<string, unknown> {
  return { section, ...form };
}

export function hasVoice(p: CompanyProfile): boolean {
  return p.voiceFormal != null || p.voiceTechnical != null || p.voiceSerious != null || p.bannedWords.length > 0 || p.differentiators.length > 0 || p.pains.length > 0;
}

export function hasVisual(p: CompanyProfile): boolean {
  return !!(p.logoAssetId || p.colorPrimary || p.colorAccent || p.fontHeading || p.fontBody || p.ctaDefault);
}

// Sobre o negócio vale 60%; jeito de falar e visual, 20% cada. "Completo" é 100%.
export function profileProgress(p: CompanyProfile | null): { percent: number; missing: ('voice' | 'visual')[] } {
  if (!p) return { percent: 0, missing: ['voice', 'visual'] };
  const missing: ('voice' | 'visual')[] = [];
  if (!hasVoice(p)) missing.push('voice');
  if (!hasVisual(p)) missing.push('visual');
  return { percent: 100 - missing.length * 20, missing };
}

const MISSING_TEXT = { voice: 'o jeito de falar', visual: 'o visual' } as const;

export function progressText(progress: { percent: number; missing: ('voice' | 'visual')[] }): string {
  if (progress.percent === 0) return 'Perfil vazio: comece pelo que a empresa vende.';
  if (progress.missing.length === 0) return 'Perfil completo. A IA usa tudo isso na próxima fase.';
  return `Perfil ${progress.percent}% completo: falta${progress.missing.length > 1 ? 'm' : ''} ${progress.missing.map((m) => MISSING_TEXT[m]).join(' e ')}.`;
}

// Escala 1 a 5 entre dois polos: 1 e 2 puxam para a esquerda, 4 e 5 para a direita, 3 não diz nada.
const POLES = {
  voice_formal: ['formal', 'descontraído'],
  voice_technical: ['técnico', 'simples'],
  voice_serious: ['sério', 'bem-humorado'],
} as const;

export function toneSummary(p: Pick<CompanyProfile, 'voiceFormal' | 'voiceTechnical' | 'voiceSerious'>): string {
  const picks: string[] = [];
  const add = (value: number | null, [left, right]: readonly [string, string]) => {
    if (value == null || value === 3) return;
    const word = value > 3 ? right : left;
    picks.push(value === 2 || value === 4 ? `levemente ${word}` : word);
  };
  add(p.voiceFormal, POLES.voice_formal);
  add(p.voiceTechnical, POLES.voice_technical);
  add(p.voiceSerious, POLES.voice_serious);
  if (picks.length === 0) return '';
  const text = picks.join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// A chamada que fecha a legenda quando o pedido não diz outra (BEZ-370): o rótulo mostra o que a IA escreve.
export const CTA_LABEL = { link_bio: 'Link na bio', whatsapp: 'WhatsApp', dm: 'Mensagem direta' } as const;
export const CTA_OPTION = {
  link_bio: 'Link na bio: convida a abrir o link do perfil',
  whatsapp: 'WhatsApp: convida a chamar no WhatsApp',
  dm: 'Mensagem direta: convida a mandar mensagem no Instagram',
} as const;

// "https://doceponto.com.br" na tela vira "doceponto.com.br".
export function siteLabel(url: string): string {
  return url.replace(/^https?:\/\//, '');
}

// Seção sem nada preenchido: o passo opcional do cadastro avança sem gravar.
export function isVoiceEmpty(f: VoiceForm): boolean {
  return f.voice_formal == null && f.voice_technical == null && f.voice_serious == null && f.banned_words.length === 0 && f.differentiators.every((d) => !d.trim()) && f.pains.every((d) => !d.trim());
}

export function isVisualEmpty(f: VisualForm): boolean {
  return !f.color_primary.trim() && !f.color_accent.trim() && !f.font_heading && !f.font_body && !f.cta_default;
}
