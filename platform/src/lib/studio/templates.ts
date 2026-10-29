// templates.ts: o motor de modelos de post com slots (SPEC 030, revisão de 30/10/2026). Puro, menos o executor no fim, que usa o
// modelo e o renderizador por injeção. O template é desenhado e verificado uma vez (pelo estúdio completo, com lint e aprovação de
// uma pessoa); por post só roda uma chamada curta que escolhe o modelo e preenche os slots.

import { contrast, mix } from '../design/color';
import { blocking, reviewText } from '../design/review';
import { clicheIssues } from '../off-topic-facts';
import { layoutBlocking, sanitizeHtml, type Logos } from './html';
import type { ImageQuality } from './levels';
import type { MeasureIssue, PostTemplate, Ratio, StudioBrand, TemplateFill } from './model';
import { type Parsed } from './parse';
import { templateFillPrompt } from './prompts';
import { rng } from './territories';
import type { Renderer, StudioModel } from './pipeline';

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const HEX = /^#[0-9a-fA-F]{6}$/;
const SLOT_NAME = /^[a-z][a-z0-9-]{0,24}$/;

// O template guardado passa por aqui antes de entrar na biblioteca: formato, slots usados no HTML declarados e sem script.
export function parseTemplate(raw: unknown): Parsed<PostTemplate> {
  const o = obj(raw);
  const meta = obj(o?.meta);
  if (!o || !meta) return fail('O template precisa de id, meta e html.');
  const id = typeof o.id === 'string' && /^[\w-]{1,60}$/.test(o.id) ? o.id : null;
  const html = typeof o.html === 'string' ? o.html : '';
  if (!id || !/<html[\s>]|<body[\s>]/i.test(html)) return fail('O template precisa de um id válido e de um documento HTML.');
  if (/<script|\son\w+=|@import|<link/i.test(html)) return fail('O HTML do template não pode ter script, evento, link nem import.');
  const slotsRaw = obj(meta.slots) ?? {};
  const slots: Record<string, { max: number }> = {};
  for (const [name, spec] of Object.entries(slotsRaw)) {
    const max = Number(obj(spec)?.max);
    if (!SLOT_NAME.test(name) || !Number.isInteger(max) || max < 2 || max > 600) return fail(`O slot "${name}" é inválido (nome e limite de caracteres).`);
    slots[name] = { max };
  }
  if (!slots.headline) return fail('O template precisa do slot headline.');
  const used = [...html.matchAll(/\{\{slot:([\w-]+)\}\}/g)].map((m) => m[1]);
  const undeclared = used.filter((n) => !slots[n]);
  if (undeclared.length) return fail(`Slot usado no HTML e não declarado: ${[...new Set(undeclared)].join(', ')}.`);
  const tone = meta.tone === 'light' ? 'light' : 'dark';
  const needsImage = meta.needsImage === true;
  const imageSlot = typeof meta.imageSlot === 'string' ? meta.imageSlot : null;
  if (needsImage && (!imageSlot || !/\{\{asset:[\w-]+\}\}/.test(html))) return fail('Template com imagem precisa descrever o espaço da imagem e ter o marcador {{asset:id}}.');
  return { ok: true, value: { id, ...(typeof o.territory === 'string' ? { territory: o.territory } : {}), meta: { tone, needsImage, imageSlot, slots, summary: typeof meta.summary === 'string' ? meta.summary.slice(0, 300) : '' }, html: sanitizeHtml(html) } };
}

// A resposta do preenchimento: o template escolhido (ou o primeiro candidato), cada slot dentro do limite, paleta em hex.
export function parseTemplateFill(raw: unknown, candidates: PostTemplate[]): Parsed<TemplateFill & { chosen: PostTemplate }> {
  const o = obj(Array.isArray(raw) && raw.length === 1 ? raw[0] : raw);
  if (!o) return fail('O preenchimento não é um objeto.');
  const chosen = candidates.find((c) => c.id === o.template) ?? candidates[0];
  const slotsIn = obj(o.slots) ?? {};
  const slots: Record<string, string> = {};
  for (const [name, spec] of Object.entries(chosen.meta.slots)) {
    const v = slotsIn[name];
    if (typeof v !== 'string' || !v.trim()) {
      if (name === 'headline') return fail('O slot headline é obrigatório.');
      continue;
    }
    // Texto acima do limite não cabe na caixa: o motor corta no limite em vez de recusar o post inteiro.
    slots[name] = v.trim().length > spec.max ? v.trim().slice(0, spec.max).replace(/\s+\S*$/, '').trim() || v.trim().slice(0, spec.max) : v.trim();
  }
  const caption = typeof o.caption === 'string' ? o.caption.trim() : '';
  if (caption.length < 60 || caption.length > 2200) return fail('A legenda tem de 60 a 2200 caracteres.');
  const p = obj(o.palette);
  const palette = { bg: HEX.test(String(p?.bg)) ? String(p?.bg) : '', ink: HEX.test(String(p?.ink)) ? String(p?.ink) : '', accent: HEX.test(String(p?.accent)) ? String(p?.accent) : '' };
  return {
    ok: true,
    value: {
      chosen,
      template: chosen.id,
      slots,
      caption,
      hashtags: (Array.isArray(o.hashtags) ? o.hashtags : []).map((h) => (typeof h === 'string' ? h.trim() : '')).filter((h) => /^#\S{1,60}$/.test(h)).slice(0, 30),
      altText: typeof o.altText === 'string' ? o.altText.trim().slice(0, 1000) : '',
      palette,
      imagePrompt: typeof o.imagePrompt === 'string' && o.imagePrompt.trim().length >= 20 ? o.imagePrompt.trim().slice(0, 1500) : null,
    },
  };
}

const escapeHtml = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

// A paleta final: a escolhida pelo modelo onde é válida, as cores da marca no resto, e o texto com contraste de 4.5:1 (senão preto ou branco).
export function resolvePalette(chosen: { bg: string; ink: string; accent: string }, colors: string[], tone: 'dark' | 'light'): { bg: string; ink: string; accent: string } {
  const bg = chosen.bg || colors[0] || (tone === 'dark' ? '#111111' : '#F7F1EF');
  const accent = chosen.accent || colors[1] || colors[0] || '#B83262';
  const wanted = chosen.ink || '#FFFFFF';
  const ink = contrast(wanted, bg) >= 4.5 ? wanted : contrast('#FFFFFF', bg) >= contrast('#111111', bg) ? '#FFFFFF' : '#111111';
  return { bg, ink, accent };
}

// O HTML final: slots escapados, @ da conta, e a paleta e as fontes da marca como variáveis CSS (por cima das do template).
export function fillTemplate(template: PostTemplate, input: { slots: Record<string, string>; handle: string | null; palette: { bg: string; ink: string; accent: string }; fonts: { display: string; body: string } }): string {
  let html = template.html;
  for (const [name, value] of Object.entries(input.slots)) html = html.split(`{{slot:${name}}}`).join(escapeHtml(value));
  html = html.replace(/\{\{slot:[\w-]+\}\}/g, '').split('{{handle}}').join(escapeHtml(input.handle ? `@${input.handle}` : ''));
  const { bg, ink, accent } = input.palette;
  const vars = `--bg:${bg};--ink:${ink};--accent:${accent};--muted:${mix(ink, bg, 0.42)};--display:"${input.fonts.display}";--body:"${input.fonts.body}";`;
  const style = `<style>:root{${vars}}</style>`;
  return /<\/head>/i.test(html) ? html.replace(/<\/head>/i, `${style}</head>`) : `${style}${html}`;
}

// Lint do template (antes de entrar na biblioteca): preenche cada slot com uma sentinela única; o render devolve os textos visíveis e
// todo texto que não for sentinela (nem o @) é texto fixo que sobrou no HTML.
export const SENTINEL = (n: number): string => `Zq${n}x`;

export function sentinelHtml(template: PostTemplate): string {
  const names = Object.keys(template.meta.slots);
  return template.html.replace(/\{\{slot:([\w-]+)\}\}/g, (_, n: string) => SENTINEL(names.indexOf(n) + 1)).split('{{handle}}').join('@conta');
}

export function leftoverTexts(visible: { text: string; ghost?: boolean }[]): string[] {
  return visible.filter((t) => !t.ghost && t.text.length > 2 && !/Zq\d+x/.test(t.text) && t.text !== '@conta').map((t) => t.text);
}

const swapLogoTone = (html: string): string => html.replace(/\{\{logo:on-light\}\}/g, '{{logo:@@}}').replace(/\{\{logo:on-dark\}\}/g, '{{logo:on-light}}').replace(/\{\{logo:@@\}\}/g, '{{logo:on-dark}}');

// ── Executor ─────────────────────────────────────────────────────────────────────────────────────────────────────
export type TemplatePostInput = {
  brand: StudioBrand;
  request: string;
  library: PostTemplate[];
  style?: string; // id de um template, ou vazio: a Ekoai escolhe entre candidatos sorteados
  seed: number;
  ratio: Ratio;
  imageQuality: ImageQuality;
  colors: string[]; // as cores da marca (hex): paleta que o modelo pode usar
  logos: Logos;
  recentTemplates?: string[];
  recentTitles?: string[];
};

export type TemplatePostResult = { png: Uint8Array; html: string; template: string; caption: string; hashtags: string[]; altText: string; headline: string; assets: Record<string, Uint8Array>; layoutIssues: MeasureIssue[]; tries: number; textIssues: string[]; costUsd: number };

const pickCandidates = (library: PostTemplate[], seed: number, recent: string[], count = 4): PostTemplate[] => {
  const rand = rng(seed);
  const fresh = library.filter((t) => !recent.includes(t.id));
  const bag = [...(fresh.length >= Math.min(count, library.length) ? fresh : library)];
  const out: PostTemplate[] = [];
  while (out.length < count && bag.length) out.push(bag.splice(Math.floor(rand() * bag.length), 1)[0]);
  return out;
};

export async function runTemplatePost(deps: { model: StudioModel; renderer: Renderer }, input: TemplatePostInput): Promise<TemplatePostResult> {
  const { model, renderer } = deps;
  if (!input.library.length) throw new Error('A biblioteca de templates está vazia.');
  const chosenOne = input.style ? input.library.find((t) => t.id === input.style) : undefined;
  const candidates = chosenOne ? [chosenOne] : pickCandidates(input.library, input.seed, input.recentTemplates ?? []);
  const fonts = { display: input.brand.profile.fontHeading ?? 'Sora', body: input.brand.profile.fontBody ?? 'Inter' };
  const hard = (issues: MeasureIssue[]) => layoutBlocking(issues).length;

  async function attempt(options: PostTemplate[]) {
    let fill: (TemplateFill & { chosen: PostTemplate }) | null = null;
    let last = '';
    for (let n = 1; n <= 2 && !fill; n += 1) {
      const text = await model.text({ model: 'fast', step: 'preenchimento', thinking: 'low', json: true, temperature: n === 1 ? 0.9 : 0.4, prompt: templateFillPrompt({ brand: input.brand, request: input.request, candidates: options, recentTitles: input.recentTitles, colors: input.colors }) });
      try {
        const parsed = parseTemplateFill(JSON.parse(text.replace(/```json\n?|```\n?/g, '').trim()), options);
        if (parsed.ok) fill = parsed.value;
        else last = parsed.error;
      } catch (e) {
        last = e instanceof Error ? e.message : String(e);
      }
    }
    if (!fill) throw new Error(`preenchimento: ${last}`);
    const template = fill.chosen;
    const palette = resolvePalette(fill.palette, input.colors, template.meta.tone);
    const assets: Record<string, Uint8Array> = {};
    const assetId = /\{\{asset:([\w-]+)\}\}/.exec(template.html)?.[1];
    if (template.meta.needsImage && assetId && fill.imagePrompt) {
      try {
        assets[assetId] = await model.image({ prompt: `${fill.imagePrompt}\n\nEditorial quality, real materials and natural imperfections, no text, no letters, no numbers, no logos, no watermark, no frames, no recognizable faces, no children.`, aspect: '4:5', quality: input.imageQuality, step: 'imagem' });
      } catch {
        // Sem a imagem o template ainda renderiza (a área fica na cor do fundo); a medição diz se ficou legível.
      }
    }
    let html = fillTemplate(template, { slots: fill.slots, handle: input.brand.handle, palette, fonts });
    let rendered = await renderer.render({ html, ratio: input.ratio, assets, logos: input.logos });
    // Conserto determinístico, sem modelo: o logo na versão errada para o fundo.
    if (rendered.issues.some((i) => i.rule === 'logo_contrast')) {
      const swapped = swapLogoTone(html);
      const again = await renderer.render({ html: swapped, ratio: input.ratio, assets, logos: input.logos });
      if (hard(again.issues) <= hard(rendered.issues)) {
        html = swapped;
        rendered = again;
      }
    }
    return { fill, template, html, rendered, assets };
  }

  // Porta de qualidade por medição: se o render mediu defeito, uma segunda tentativa com o próximo candidato (só se a pessoa não fixou o modelo).
  let best = await attempt(candidates);
  let tries = 1;
  if (hard(best.rendered.issues) > 0 && !chosenOne) {
    const rest = candidates.filter((c) => c.id !== best.template.id).slice(0, 1);
    if (rest.length) {
      const second = await attempt(rest);
      tries = 2;
      if (hard(second.rendered.issues) < hard(best.rendered.issues)) best = second;
    }
  }
  const imageTexts = [...Object.values(best.fill.slots), input.brand.handle ? `@${input.brand.handle}` : null].filter((t): t is string => !!t);
  const textIssues = blocking([
    ...reviewText({ imageTexts, caption: best.fill.caption, hashtags: best.fill.hashtags, facts: input.brand.facts, never: input.brand.never, banned: input.brand.profile.bannedWords ?? [], request: input.request }),
    ...clicheIssues({ imageTexts, caption: best.fill.caption }),
  ]).map((i) => i.rule);
  return { png: best.rendered.png, html: best.html, template: best.template.id, caption: best.fill.caption, hashtags: best.fill.hashtags, altText: best.fill.altText, headline: best.fill.slots.headline ?? '', assets: best.assets, layoutIssues: best.rendered.issues, tries, textIssues, costUsd: model.costUsd };
}

