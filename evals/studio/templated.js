// templated.js: caminho rápido por template (spike BEZ-447, SPEC 030). O template vem da biblioteca (criada offline pelo estúdio
// completo, ver templater.js). Por pedido roda só: uma chamada curta que escolhe o template e preenche os slots, a imagem
// por IA em paralelo com o que sobrar, e o render por código com ajuste automático de corpo e as medições.

import { clicheIssues } from '../../platform/src/lib/off-topic-facts.ts';
import { reviewText } from '../../platform/src/lib/design/review.ts';
import { brandBlock, TEXT_RULES } from './agents.js';
import { askJson, makeImage, MODELS, newLedger } from './llm.js';
import { renderHtml } from './render.js';

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lum = (h) => {
  const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = hex(h).map(f);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const contrastOf = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const mix = (a, b, t) => `#${hex(a).map((v, i) => Math.round(v * (1 - t) + hex(b)[i] * t).toString(16).padStart(2, '0')).join('')}`;
const isHex = (v) => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);

// Aplica o preenchimento ao template: slots, @, paleta e fontes da marca. Slot ausente vira vazio (e o elemento some pelo CSS do template).
export function fillTemplate(template, { slots, handle, palette, fonts }) {
  let html = template.html;
  for (const [name, value] of Object.entries(slots)) html = html.split(`{{slot:${name}}}`).join(escapeHtml(value ?? ''));
  html = html.replace(/\{\{slot:[\w-]+\}\}/g, '').split('{{handle}}').join(escapeHtml(handle ? `@${handle}` : ''));
  const ink = contrastOf(palette.ink, palette.bg) >= 4.5 ? palette.ink : lum(palette.bg) > 0.5 ? '#111111' : '#F6F3EE';
  const vars = `--bg:${palette.bg};--ink:${ink};--accent:${palette.accent};--muted:${mix(ink, palette.bg, 0.42)};--display:"${fonts.display}";--body:"${fonts.body}";`;
  const style = `<style>:root{${vars}}</style>`;
  return /<\/head>/i.test(html) ? html.replace(/<\/head>/i, `${style}</head>`) : `${style}${html}`;
}

const swapLogoTone = (html) => html.replace(/\{\{logo:on-light\}\}/g, '{{logo:@@}}').replace(/\{\{logo:on-dark\}\}/g, '{{logo:on-light}}').replace(/\{\{logo:@@\}\}/g, '{{logo:on-dark}}');

function logosOf(company) {
  const own = company.studio?.logos;
  if (own) return { 'on-light': own.light, 'on-dark': own.dark };
  if (!company.logo) return {};
  return { 'on-light': company.logo.dataUri, 'on-dark': company.logo.dataUri };
}

function brandColors(company) {
  const p = company.profile;
  const fromStudio = Object.values(company.studio?.palette ?? {}).filter(isHex);
  return [...new Set([p.colorPrimary, p.colorAccent, ...fromStudio, '#FFFFFF', '#111111'].filter(isHex))];
}

const fillPrompt = ({ company, request, candidates, recentTitles, colors }) => `Você preenche, numa chamada só, o plano e o texto de um post de Instagram a partir de TEMPLATES prontos de agência. Escolha o template que melhor serve ao pedido e escreva os textos de cada slot.

${brandBlock(company)}

PEDIDO: "${request}"
Títulos recentes da conta (não repita nem lembre): ${recentTitles.map((t) => `"${t}"`).join('; ') || 'nenhum'}.

TEMPLATES (escolha UM):
${candidates.map((t) => `- id ${t.id}: ${t.meta.summary} Fundo ${t.meta.tone === 'dark' ? 'escuro' : 'claro'}. Slots e limites de caracteres: ${JSON.stringify(t.meta.slots)}. ${t.meta.needsImage ? `Pede imagem de IA: ${t.meta.imageSlot}` : 'Sem imagem de IA.'}`).join('\n')}

Cores permitidas para a paleta (hex da marca): ${colors.join(', ')}. Escolha bg (fundo), ink (texto, contraste de 4.5:1 com o bg) e accent; o tom do fundo deve ser o do template.

${TEXT_RULES}
Cada slot respeita o limite de caracteres. headline específico e com tensão, de 1 a 8 palavras. Legenda de 250 a 600 caracteres em texto puro, abrindo com gancho e terminando com a chamada para ação da marca. Se o template pede imagem, escreva imagePrompt em inglês (sujeito, escala, câmera, luz, materiais, paleta, e o espaço livre indicado); fotografia editorial com imperfeições reais, sem texto, letras, logos, rosto reconhecível nem criança.

Responda só um JSON: { "template": "<id>", "slots": { "headline": "...", ... }, "caption": "...", "hashtags": ["#..."], "altText": "...", "palette": { "bg": "#hex", "ink": "#hex", "accent": "#hex" }, "imagePrompt": "..." ou null }`;

export async function makeTemplatedPost({ company, request, library, seed = 1, recentTemplates = [], recentTitles = [], model = 'fast', imageModel = 'gemini-3.1-flash-image', ratio = '4:5', onStage = () => {} }) {
  const ledger = newLedger();
  const t0 = Date.now();
  const timing = {};
  const mark = (n) => (timing[n] = (Date.now() - t0) / 1000);
  const llm = model === 'smart' ? MODELS.smart : MODELS.fast;

  // Candidatos: 4 templates sorteados com semente, fora os usados recentemente na conta.
  let s = (seed >>> 0) || 1;
  const rand = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const pool = library.filter((t) => !recentTemplates.includes(t.id));
  const bag = [...(pool.length >= 4 ? pool : library)];
  const candidates = [];
  while (candidates.length < 4 && bag.length) candidates.push(bag.splice(Math.floor(rand() * bag.length), 1)[0]);

  const colors = brandColors(company);
  const fonts = { display: company.profile.fontHeading, body: company.profile.fontBody };
  const HARD = new Set(['safe_margin', 'font_size', 'off_canvas', 'text_clipped', 'text_overlap', 'arrow_over_text', 'contrast_low', 'logo_contrast', 'logo_small']);
  const hardCount = (issues) => issues.filter((i) => HARD.has(i.rule)).length;

  // Uma tentativa: o modelo escolhe entre `options` e preenche; imagem se o template pede; render e conserto do logo.
  async function attempt(options) {
    onStage('preenchimento', options.map((c) => c.id));
    const out = await askJson({ model: llm, prompt: fillPrompt({ company, request, candidates: options, recentTitles, colors }), temperature: 0.9, thinking: 'low', ledger, step: 'preenchimento' });
    const template = options.find((c) => c.id === out.template) ?? options[0];
    const palette = { bg: isHex(out.palette?.bg) ? out.palette.bg : colors[0], ink: isHex(out.palette?.ink) ? out.palette.ink : '#FFFFFF', accent: isHex(out.palette?.accent) ? out.palette.accent : colors[1] ?? colors[0] };
    const assets = {};
    const assetId = /\{\{asset:([\w-]+)\}\}/.exec(template.html)?.[1];
    if (template.meta.needsImage && assetId && out.imagePrompt) {
      onStage('imagem', assetId);
      const img = await makeImage({ model: imageModel, prompt: `${out.imagePrompt}\n\nEditorial quality, real materials and natural imperfections, no text, no letters, no numbers, no logos, no watermark, no frames.`, aspect: '4:5', ledger, step: 'imagem' }).catch(() => null);
      if (img) assets[assetId] = img.png;
    }
    const render = (h) => renderHtml(h, { ratio, assets, logos: logosOf(company) });
    let html = fillTemplate(template, { slots: out.slots ?? {}, handle: company.handle, palette, fonts });
    let rendered = await render(html);
    // Conserto determinístico (sem modelo): logo na versão errada para o fundo.
    if (rendered.issues.some((i) => i.rule === 'logo_contrast')) {
      const swapped = swapLogoTone(html);
      const again = await render(swapped);
      if (hardCount(again.issues) <= hardCount(rendered.issues)) {
        html = swapped;
        rendered = again;
      }
    }
    return { out, template, html, rendered };
  }

  // Porta de qualidade por medição: se o render mediu defeito, uma segunda tentativa com o próximo candidato (só ele).
  let best = await attempt(candidates);
  mark('tentativa1');
  let tries = 1;
  if (hardCount(best.rendered.issues) > 0) {
    const rest = candidates.filter((c) => c.id !== best.template.id);
    const second = await attempt(rest.slice(0, 1));
    tries = 2;
    if (hardCount(second.rendered.issues) < hardCount(best.rendered.issues)) best = second;
  }
  mark('render');
  const { out, template, html, rendered } = best;

  const imageTexts = [...Object.values(out.slots ?? {}), company.handle ? `@${company.handle}` : null].filter(Boolean);
  const textIssues = [
    ...reviewText({ imageTexts, caption: out.caption ?? '', hashtags: out.hashtags ?? [], facts: company.facts, never: company.never, banned: company.profile.bannedWords ?? [], request }),
    ...clicheIssues({ imageTexts, caption: out.caption ?? '' }),
  ];
  return { png: rendered.png, html, template: template.id, copy: { headline: out.slots?.headline, caption: out.caption }, layoutIssues: rendered.issues, textIssues: textIssues.map((i) => i.rule), timing, tries, seconds: (Date.now() - t0) / 1000, costUsd: ledger.total, costByStep: ledger.steps };
}
