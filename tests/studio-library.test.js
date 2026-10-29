// A biblioteca de modelos de post (SPEC 030, BEZ-477): cada template é um HTML com slots, genérico (sem marca de cliente) e já verificado.
// A porta de entrada é por máquina; a aprovação final é de uma pessoa, olhando a folha de contato (STUDIO_LIBRARY_SHEET=<pasta>).
// Parte estática roda sempre; a parte de render usa um Chromium de verdade e é pulada onde não houver (como tests/studio-renderer.test.js).
import { describe, it, expect, afterAll } from 'vitest';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromiumRenderer } from '../platform/src/lib/studio/chromium-renderer.ts';
import { layoutBlocking } from '../platform/src/lib/studio/html.ts';
import { STYLES } from '../platform/src/lib/studio/levels.ts';
import { fillTemplate, leftoverTexts, parseTemplate, sentinelHtml } from '../platform/src/lib/studio/templates.ts';

// Nomes de outras marcas montados por partes: o teste de marca de cliente varre este arquivo atrás desses nomes.
const OTHER_BRANDS = new RegExp(['ekoai', ['pi', 'lar'].join(''), ['pru', 'meo'].join(''), ['trin', 'ity'].join(''), '\\bbez\\b', 'doce ponto', 'escolinha'].join('|'), 'i');
const DIR = join(import.meta.dirname, '../platform/src/lib/studio/library');
const library = readdirSync(DIR)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => ({ file: f, ...JSON.parse(readFileSync(join(DIR, f), 'utf8')) }));

const CANDIDATES = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].filter(Boolean);
const chrome = CANDIDATES.find((p) => existsSync(p));
const renderer = chrome ? chromiumRenderer({ executablePath: chrome, fontDir: join(import.meta.dirname, '../platform/fonts') }) : null;
afterAll(async () => renderer?.close());

// Marcas fictícias com cores e fontes bem diferentes: o template tem de aguentar qualquer uma.
const BRANDS = [
  { name: 'escura', palette: { bg: '#2A1B3D', ink: '#F7F1EF', accent: '#FF8A65' }, fonts: { display: 'Sora', body: 'Inter' } },
  { name: 'clara', palette: { bg: '#F6EFE6', ink: '#1B2A3A', accent: '#D1495B' }, fonts: { display: 'Playfair Display', body: 'Lato' } },
  { name: 'vibrante', palette: { bg: '#0B7A75', ink: '#FFFFFF', accent: '#FFC857' }, fonts: { display: 'Poppins', body: 'Open Sans' } },
  { name: 'mono', palette: { bg: '#101010', ink: '#FAFAFA', accent: '#C8FF3D' }, fonts: { display: 'Oswald', body: 'Inter' } },
];
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

describe('biblioteca de modelos de post: estático', () => {
  it('tem templates, com id único e igual ao nome do arquivo', () => {
    expect(library.length).toBeGreaterThanOrEqual(4);
    expect(new Set(library.map((t) => t.id)).size).toBe(library.length);
    for (const t of library) expect(t.file).toBe(`${t.id}.json`);
  });

  it('cada template passa no parser e é de um estilo da vitrine', () => {
    const ids = new Set(STYLES.map((s) => s.id));
    for (const t of library) {
      const parsed = parseTemplate({ id: t.id, territory: t.territory, meta: t.meta, html: t.html });
      expect(parsed.ok ? 'ok' : `${t.id}: ${parsed.error}`, t.id).toBe('ok');
      expect(ids.has(t.territory), `${t.id}: território ${t.territory}`).toBe(true);
    }
  });

  it('é genérico: cor só por variável, sem nome de marca e sem @ fixo', () => {
    for (const t of library) {
      const body = t.html.replace(/:root\s*\{[^}]*\}/, '');
      const colors = (body.match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g) ?? []).filter((c) => !/^(#fff(fff)?|#000(000)?|rgba\(\s*(0\s*,\s*0\s*,\s*0|255\s*,\s*255\s*,\s*255)\s*,[^)]*\))$/i.test(c));
      expect(colors, `${t.id}: cor fixa fora das variáveis`).toEqual([]);
      expect(OTHER_BRANDS.test(JSON.stringify(t)), `${t.id}: nome de marca`).toBe(false);
      expect(/@[a-z0-9_.]{3,}/i.test(t.html.replace(/\{\{[^}]*\}\}/g, '')), `${t.id}: @ fixo`).toBe(false);
      expect(t.meta.slots.handle, `${t.id}: o @ vem de {{handle}}, não de slot`).toBeUndefined();
    }
  });

  it('cada slot declarado aparece no HTML e vice-versa (parser já confere); logo e @ usam marcador', () => {
    for (const t of library) {
      expect(/\{\{logo:on-(light|dark)\}\}/.test(t.html), `${t.id}: sem marcador de logo`).toBe(true);
    }
  });
});

describe.skipIf(!renderer)('biblioteca de modelos de post: render no Chromium', () => {
  it('sem texto fixo: preenchido com sentinelas, todo texto visível é slot ou @', async () => {
    const bad = [];
    for (const t of library) {
      const r = await renderer.render({ html: sentinelHtml(t).replace(/<\/head>/i, `<style>:root{--bg:${BRANDS[0].palette.bg};--ink:${BRANDS[0].palette.ink};--accent:${BRANDS[0].palette.accent}}</style></head>`), ratio: '4:5', assets: {}, logos: logosFor(BRANDS[0].palette.bg) });
      const left = leftoverTexts(r.texts ?? []);
      if (left.length) bad.push(`${t.id}: ${left.join(' | ')}`);
    }
    expect(bad).toEqual([]);
  }, 240_000);

  it('aguenta 4 marcas, texto curto e no limite, em 4:5, sem defeito medido (1:1 não: o layout é de 1350 px de altura)', async () => {
    const sheet = process.env.STUDIO_LIBRARY_SHEET;
    if (sheet) mkdirSync(sheet, { recursive: true });
    const hero = (await renderer.render({ html: '<body style="margin:0;width:1080px;height:1350px;background:linear-gradient(160deg,#caa27a,#6b4a35 55%,#221510)"></body>', ratio: '4:5', assets: {}, logos: {} })).png;
    const bad = [];
    for (const t of library) {
      for (const brand of BRANDS) {
        for (const [label, ratio] of [['no-limite', 1], ['curto', 0.45]]) {
          for (const shape of ['4:5']) {
            let html = fillTemplate(t, { slots: slotsFor(t, ratio), handle: 'minhamarca', palette: brand.palette, fonts: brand.fonts });
            const opts = { ratio: shape, assets: t.meta.needsImage ? { hero } : {}, logos: logosFor(brand.palette.bg) };
            let r = await renderer.render({ html, ...opts });
            if (r.issues.some((i) => i.rule === 'logo_contrast')) {
              const swapped = swapTone(html);
              const again = await renderer.render({ html: swapped, ...opts });
              if (layoutBlocking(again.issues).length <= layoutBlocking(r.issues).length) [html, r] = [swapped, again];
            }
            const hard = layoutBlocking(r.issues);
            if (hard.length) bad.push(`${t.id} / ${brand.name} / ${label} / ${shape}: ${hard.map((i) => `${i.rule} ${i.detail}`).join('; ')}`);
            if (sheet && shape === '4:5' && label === 'no-limite') writeFileSync(join(sheet, `${t.id}--${brand.name}.png`), r.png);
          }
        }
      }
    }
    if (sheet) writeFileSync(join(sheet, 'defeitos.json'), JSON.stringify(bad, null, 1));
    expect(bad).toEqual([]);
  }, 900_000);
});
