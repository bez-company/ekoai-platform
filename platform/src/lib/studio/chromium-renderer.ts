// chromium-renderer.ts: o Renderer de produção do estúdio (SPEC 030, F3): HTML -> PNG com o Chromium (puppeteer-core) e a medição que
// o crítico, o revisor e a porta de qualidade dos templates usam. Só entram as fontes curadas da plataforma (platform/fonts) e
// imagens em data URI: qualquer outra requisição é abortada, para o resultado sair igual em qualquer máquina e o HTML do designer
// nunca falar com a rede. Portado de evals/studio/render.js; as funções que rodam na página estão em browser-scripts.ts.
// Só o job do estúdio importa este arquivo (puppeteer-core não entra no pacote do app).

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Browser, Page } from 'puppeteer-core';
import { FONTS } from '../design/fonts';
import { fillAssets, sanitizeHtml } from './html';
import { AUDIT_PAGE, AUTOFIT, COVERED_TEXT, FIND_LOGOS, INK_OVERLAP, KEY_LOGOS, LOW_CONTRAST, MEAN_LUMINANCE, STROKES_OVER_TEXT } from './browser-scripts';
import type { MeasureIssue, Ratio } from './model';
import type { RenderInput, Renderer } from './pipeline';

export const WIDTH = 1080;
export const HEIGHT: Record<Ratio, number> = { '1:1': 1080, '4:5': 1350 };
export const MARGIN = 64;
// Texto menor que isto não se lê no feed do celular (a plataforma usa 22 a 26 como piso).
export const MIN_TEXT_PX = 24;

const WEIGHTS: Record<string, number> = { Regular: 400, SemiBold: 600, Bold: 700 };

// 'PlayfairDisplay-Bold.ttf' -> { family: 'Playfair Display', weight: 700 }
export function faceOf(file: string): { family: string; weight: number } {
  const [prefix, style] = file.replace('.ttf', '').split('-');
  return { family: prefix.replace(/^DM/, 'DM ').replace(/([a-z])([A-Z])/g, '$1 $2'), weight: WEIGHTS[style] ?? 400 };
}

export function fontCss(fontDir: string): string {
  return readdirSync(fontDir)
    .filter((f) => f.endsWith('.ttf'))
    .map((file) => {
      const { family, weight } = faceOf(file);
      return `@font-face{font-family:"${family}";font-weight:${weight};font-style:normal;src:url(data:font/ttf;base64,${readFileSync(join(fontDir, file)).toString('base64')}) format("truetype")}`;
    })
    .join('\n');
}

type Measured = { i: number; text: string; x: number; y: number; w: number; h: number; size: number; weight: string; family: string; color: string; ghost: boolean; issues: string[] };

// Roda uma das funções de browser-scripts.ts na página, com um argumento serializado em JSON.
const run = <T>(page: Page, script: string, ...args: unknown[]): Promise<T> => page.evaluate(`${script}(${args.map((a) => JSON.stringify(a)).join(',')})`) as Promise<T>;

// Cada logo (img[data-logo]) é conferido contra o fundo atrás dele: esconde o logo, fotografa a área e mede a luminância média.
// Versão para fundo claro sobre fundo escuro (ou o contrário) é o erro mais comum.
async function checkLogos(page: Page, sameFile: boolean): Promise<MeasureIssue[]> {
  const found = await run<{ i: number; tone: string; x: number; y: number; w: number; h: number }[]>(page, FIND_LOGOS);
  const issues: MeasureIssue[] = [];
  for (const logo of found) {
    // Altura de 44 px e área de um lockup de 110x44: o símbolo quadrado de 72x72 passa; o logo de 100x30 e o de 40x40 não.
    if (logo.h < 44 || logo.w * logo.h < 110 * 44) issues.push({ rule: 'logo_small', detail: `logo com ${Math.round(logo.w)}x${Math.round(logo.h)}px (mínimo 44 de altura e a área de 110x44)` });
    if (logo.w < 4 || logo.h < 4) continue;
    await page.evaluate(`document.querySelector('[data-logo-i="${logo.i}"]').style.visibility = 'hidden'`);
    const shot = (await page.screenshot({ type: 'png', clip: { x: logo.x, y: logo.y, width: logo.w, height: logo.h }, encoding: 'base64' })) as string;
    await page.evaluate(`document.querySelector('[data-logo-i="${logo.i}"]').style.visibility = 'visible'`);
    const lum = await run<number>(page, MEAN_LUMINANCE, shot);
    if (!sameFile && ((logo.tone === 'on-light' && lum < 0.45) || (logo.tone === 'on-dark' && lum > 0.55))) {
      issues.push({ rule: 'logo_contrast', detail: `a versão ${logo.tone} está sobre um fundo de luminância ${lum.toFixed(2)}: use a outra versão ou mude o fundo` });
    }
  }
  return issues;
}

const HIDE_TEXT = '*{-webkit-text-fill-color:transparent!important;text-shadow:none!important;text-decoration-color:transparent!important} svg text{fill:transparent!important;stroke:none!important}';

// As letras de dois textos se tocam? Fotografa a área dos dois sem texto, só com um e só com o outro, e conta os pixels com tinta nos dois.
async function inkOverlap(page: Page, a: Measured, b: Measured): Promise<boolean> {
  const view = page.viewport();
  const x = Math.max(0, Math.floor(Math.min(a.x, b.x)) - 2);
  const y = Math.max(0, Math.floor(Math.min(a.y, b.y)) - 2);
  const w = Math.min(view?.width ?? 1080, Math.ceil(Math.max(a.x + a.w, b.x + b.w)) + 2) - x;
  const h = Math.min(view?.height ?? 1350, Math.ceil(Math.max(a.y + a.h, b.y + b.h)) + 2) - y;
  if (w < 2 || h < 2) return false;
  const clip = { x, y, width: w, height: h };
  const shot = async (extra: string): Promise<string> => {
    const style = await page.addStyleTag({ content: `${HIDE_TEXT}${extra}` });
    const png = (await page.screenshot({ type: 'png', clip, encoding: 'base64' })) as string;
    await style.evaluate((el) => el.remove());
    return png;
  };
  const only = (t: Measured) => `[data-audit-i="${t.i}"]{-webkit-text-fill-color:currentColor!important}`;
  const [base, onlyA, onlyB] = [await shot(''), await shot(only(a)), await shot(only(b))];
  // Alguns pixels de borda suavizada não contam: precisa de tinta de verdade nos dois no mesmo lugar.
  return (await run<number>(page, INK_OVERLAP, base, onlyA, onlyB)) > 24;
}

// Colisões e contraste (BEZ-405): texto sobre texto, traço desenhado cruzando texto e texto com pouco contraste contra o fundo.
async function checkCollisions(page: Page, texts: Measured[]): Promise<MeasureIssue[]> {
  const solid = texts.filter((t) => !t.ghost);
  const issues: MeasureIssue[] = [];
  // Só as caixas que se cruzam viram candidatas; quem decide é a tinta (ink): entrelinha apertada faz a caixa de uma linha tocar a da
  // outra sem as letras se tocarem, e isso é escolha de tipografia, não defeito.
  for (let i = 0; i < solid.length; i += 1) {
    for (let j = i + 1; j < solid.length; j += 1) {
      const [a, b] = [solid[i], solid[j]];
      const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (w <= 2 || h <= 2) continue;
      if (await inkOverlap(page, a, b)) issues.push({ rule: 'text_overlap', detail: `"${a.text}" e "${b.text}" se sobrepõem` });
    }
  }
  const covered = await run<string[]>(page, COVERED_TEXT, solid.map(({ i, x, y, w, h, text }) => ({ i, x, y, w, h, text })));
  for (const c of covered) issues.push({ rule: 'text_covered', detail: `"${c}" fica coberto por outro elemento (post-it, cartão ou imagem por cima)` });
  const crossings = await run<number[]>(page, STROKES_OVER_TEXT, solid.map(({ x, y, w, h }) => ({ x, y, w, h })));
  if (crossings.length) issues.push({ rule: 'arrow_over_text', detail: `${crossings.length} traço(s) desenhado(s) cruzam texto` });

  const style = await page.addStyleTag({ content: HIDE_TEXT });
  const behind = (await page.screenshot({ type: 'png', encoding: 'base64' })) as string;
  await style.evaluate((el) => el.remove());
  const low = await run<string[]>(page, LOW_CONTRAST, behind, solid.map(({ x, y, w, h, color, size, text }) => ({ x, y, w, h, color, size, text })));
  for (const l of low) issues.push({ rule: 'contrast_low', detail: l });
  return issues;
}

export type ChromiumOptions = { executablePath: string; fontDir: string; args?: string[] };

export function chromiumRenderer(options: ChromiumOptions): Renderer & { close(): Promise<void> } {
  let browserPromise: Promise<Browser> | null = null;
  let css: string | null = null;
  const known = new Set(Object.keys(FONTS));

  const browser = (): Promise<Browser> => {
    browserPromise ??= import('puppeteer-core').then((p) => p.default.launch({ executablePath: options.executablePath, headless: true, args: ['--no-sandbox', '--font-render-hinting=none', '--force-color-profile=srgb', ...(options.args ?? [])] }));
    return browserPromise;
  };

  return {
    async render(input: RenderInput) {
      const height = HEIGHT[input.ratio];
      css ??= fontCss(options.fontDir);
      const filled = sanitizeHtml(fillAssets(input.html, { assets: input.assets, logos: input.logos }));
      const style = `<style>${css}</style>`;
      const doc = /<head[^>]*>/i.test(filled) ? filled.replace(/<head[^>]*>/i, (m) => `${m}${style}`) : `${style}${filled}`;
      const page = await (await browser()).newPage();
      try {
        await page.setViewport({ width: WIDTH, height, deviceScaleFactor: 1 });
        await page.setRequestInterception(true);
        page.on('request', (req) => (req.url().startsWith('data:') || req.url().startsWith('about:') ? void req.continue() : void req.abort()));
        await page.setContent(doc, { waitUntil: 'load', timeout: 30_000 });
        await page.evaluate('document.fonts.ready');
        if (input.hide?.logo || input.hide?.handle) {
          // Os modelos prontos escrevem o @ como texto solto (sem data-handle, para não mexer no CSS deles): some o nó de texto que é só o @.
          if (input.hide.handle) await page.evaluate(`(() => { const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); const hit = []; while (w.nextNode()) if (/^\\s*@[\\w.]{2,}\\s*$/.test(w.currentNode.nodeValue || '')) hit.push(w.currentNode); hit.forEach((n) => { n.nodeValue = ''; }); })()`);
          await page.addStyleTag({ content: `${input.hide.logo ? '[data-logo]' : ''}${input.hide.logo && input.hide.handle ? ',' : ''}${input.hide.handle ? '[data-handle]' : ''}{display:none!important}` });
        }
        // O quadrado de fundo da logo some (fica só o ícone) antes de qualquer medida ou foto.
        await page.evaluate(`${KEY_LOGOS}()`);
        await run(page, AUTOFIT, null);
        const texts = await run<Measured[]>(page, AUDIT_PAGE, { width: WIDTH, height, margin: MARGIN });
        const logoIssues = await checkLogos(page, !!input.logos && input.logos['on-light'] === input.logos['on-dark']);
        const collisionIssues = await checkCollisions(page, texts);
        const png = new Uint8Array(await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: WIDTH, height } }));
        const issues: MeasureIssue[] = [];
        for (const t of texts) {
          if (t.size < MIN_TEXT_PX) issues.push({ rule: 'font_size', detail: `"${t.text}" a ${t.size}px (mínimo ${MIN_TEXT_PX}px)` });
          for (const i of t.issues) issues.push({ rule: i === 'margem' ? 'safe_margin' : i === 'texto cortado' ? 'text_clipped' : 'off_canvas', detail: `"${t.text}" (${i})` });
          if (!known.has(t.family)) issues.push({ rule: 'font_unknown', detail: `"${t.text}" usa ${t.family}, fora da lista` });
        }
        issues.push(...logoIssues, ...collisionIssues);
        return { png, issues, texts: texts.map((t) => ({ text: t.text, ghost: t.ghost })) };
      } finally {
        await page.close();
      }
    },
    async close() {
      if (!browserPromise) return;
      const b = await browserPromise;
      browserPromise = null;
      await b.close();
    },
  };
}
