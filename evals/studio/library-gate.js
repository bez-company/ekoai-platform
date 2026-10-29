// library-gate.js: o portão de um template da biblioteca (SPEC 030, BEZ-477). Um template só entra se renderizar sem nenhum defeito de
// layout medido com 4 marcas bem diferentes, texto curto e no limite, e se for genérico (cor só por variável, sem marca, sem @ fixo).
// É usado pelo teste da biblioteca (tests/studio-library.test.js) e pelo gerador (library.eval.js), para os dois medirem igual.
import { layoutBlocking } from '../../platform/src/lib/studio/html.ts';
import { fillTemplate, leftoverTexts, sentinelHtml } from '../../platform/src/lib/studio/templates.ts';

// Marcas fictícias com cores e fontes bem diferentes: o template tem de aguentar qualquer uma.
export const BRANDS = [
  { name: 'escura', palette: { bg: '#2A1B3D', ink: '#F7F1EF', accent: '#FF8A65' }, fonts: { display: 'Sora', body: 'Inter' } },
  { name: 'clara', palette: { bg: '#F6EFE6', ink: '#1B2A3A', accent: '#D1495B' }, fonts: { display: 'Playfair Display', body: 'Lato' } },
  { name: 'vibrante', palette: { bg: '#0B7A75', ink: '#FFFFFF', accent: '#FFC857' }, fonts: { display: 'Poppins', body: 'Open Sans' } },
  { name: 'mono', palette: { bg: '#101010', ink: '#FAFAFA', accent: '#C8FF3D' }, fonts: { display: 'Oswald', body: 'Inter' } },
];

// Nomes de outras marcas montados por partes: o teste de marca de cliente varre os arquivos atrás desses nomes.
export const OTHER_BRANDS = new RegExp(['ekoai', ['pi', 'lar'].join(''), ['pru', 'meo'].join(''), ['trin', 'ity'].join(''), '\\bbez\\b', 'doce ponto', 'escolinha'].join('|'), 'i');

// Frases reais, de tamanhos variados: o slot recebe a mais longa que cabe no limite (ou em 45% dele, no caso curto). Nada de palavra cortada.
const SAMPLES = ['Pão', 'Hoje', 'Dia 1', 'Sem pressa', 'Massa viva', 'Pão novo, hoje', 'Fornada de hoje', 'Tempo faz o pão', 'Todo dia, pão quente', 'O pão que espera a hora', 'Fermentação natural, todo dia', 'Ingredientes que você reconhece', 'Pão bom não tem pressa nem atalho', 'Uma massa que pede tempo para crescer direito', 'Fermentação natural, todo dia, com ingredientes que você reconhece', 'Uma massa que pede tempo para crescer direito, sem pressa e sem atalho nenhum, como sempre'];
const textFor = (max, ratio) => {
  const limit = Math.max(3, Math.floor(max * ratio));
  const fit = SAMPLES.filter((t) => t.length <= limit);
  return fit.length ? fit[fit.length - 1] : SAMPLES[0].slice(0, limit);
};
const slotsFor = (t, ratio) => Object.fromEntries(Object.entries(t.meta.slots).map(([name, { max }]) => [name, textFor(max, ratio)]));
const swapTone = (html) => html.replace(/\{\{logo:on-light\}\}/g, '{{logo:@@}}').replace(/\{\{logo:on-dark\}\}/g, '{{logo:on-light}}').replace(/\{\{logo:@@\}\}/g, '{{logo:on-dark}}');
const svg = (fill) => `data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="96"><rect width="320" height="96" rx="12" fill="${fill}"/></svg>`).toString('base64')}`;
const logosFor = (bg) => {
  const dark = parseInt(bg.slice(1, 3), 16) * 0.3 + parseInt(bg.slice(3, 5), 16) * 0.59 + parseInt(bg.slice(5, 7), 16) * 0.11 < 128;
  return dark ? { 'on-light': svg('#F5F5F2'), 'on-dark': svg('#F5F5F2') } : { 'on-light': svg('#17171B'), 'on-dark': svg('#17171B') };
};

// Cor fixa fora do :root (menos branco, preto e sombras neutras) e nome de marca: o que torna um template específico demais.
export function genericProblems(t) {
  const out = [];
  const body = t.html.replace(/:root\s*\{[^}]*\}/, '');
  const colors = (body.match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g) ?? []).filter((c) => !/^(#fff(fff)?|#000(000)?|rgba\(\s*(0\s*,\s*0\s*,\s*0|255\s*,\s*255\s*,\s*255)\s*,[^)]*\))$/i.test(c));
  if (colors.length) out.push(`cor fixa fora das variáveis: ${[...new Set(colors)].join(', ')}`);
  if (OTHER_BRANDS.test(JSON.stringify(t))) out.push('nome de marca');
  if (/@[a-z0-9_.]{3,}/i.test(t.html.replace(/\{\{[^}]*\}\}/g, ''))) out.push('@ fixo (use {{handle}})');
  if (t.meta.slots.handle) out.push('o @ vem de {{handle}}, não de slot');
  if (!/\{\{logo:on-(light|dark)\}\}/.test(t.html)) out.push('sem marcador de logo');
  return out;
}

// O render com Chromium. Devolve { leftovers, defects, pngs }: texto fixo que sobrou, defeitos medidos (uma linha cada) e os PNGs 4:5 no limite.
export async function renderGate(renderer, t) {
  const hero = (await renderer.render({ html: '<body style="margin:0;width:1080px;height:1350px;background:linear-gradient(160deg,#caa27a,#6b4a35 55%,#221510)"></body>', ratio: '4:5', assets: {}, logos: {} })).png;
  const first = BRANDS[0];
  const sentinel = await renderer.render({ html: sentinelHtml(t).replace(/<\/head>/i, `<style>:root{--bg:${first.palette.bg};--ink:${first.palette.ink};--accent:${first.palette.accent}}</style></head>`), ratio: '4:5', assets: t.meta.needsImage ? { hero } : {}, logos: logosFor(first.palette.bg) });
  const leftovers = leftoverTexts(sentinel.texts ?? []);
  const defects = [];
  const pngs = {};
  for (const brand of BRANDS) {
    for (const [label, ratio] of [['no-limite', 1], ['curto', 0.45]]) {
      let html = fillTemplate(t, { slots: slotsFor(t, ratio), handle: 'minhamarca', palette: brand.palette, fonts: brand.fonts });
      const opts = { ratio: '4:5', assets: t.meta.needsImage ? { hero } : {}, logos: logosFor(brand.palette.bg) };
      let r = await renderer.render({ html, ...opts });
      if (r.issues.some((i) => i.rule === 'logo_contrast')) {
        const swapped = swapTone(html);
        const again = await renderer.render({ html: swapped, ...opts });
        if (layoutBlocking(again.issues).length <= layoutBlocking(r.issues).length) [html, r] = [swapped, again];
      }
      const hard = layoutBlocking(r.issues);
      if (hard.length) defects.push(`${brand.name} / ${label}: ${hard.map((i) => `${i.rule} ${i.detail}`).join('; ')}`);
      if (label === 'no-limite') pngs[brand.name] = r.png;
    }
  }
  return { leftovers, defects, pngs };
}
