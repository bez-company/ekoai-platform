// render.js: HTML do designer -> PNG, com o Chrome do sistema (puppeteer-core), e a medição que o crítico e o
// revisor usam: cada texto desenhado com posição, corpo, cor e o que passa da margem. Só entram as fontes
// curadas da plataforma (platform/fonts) e imagens em data URI: qualquer outra requisição é abortada, para o
// resultado sair igual em qualquer máquina.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';

export const WIDTH = 1080;
export const HEIGHT = { '1:1': 1080, '4:5': 1350 };
export const MARGIN = 64;

const FONT_DIR = join(import.meta.dirname, '../../platform/fonts');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const WEIGHTS = { Regular: 400, SemiBold: 600, Bold: 700 };

// 'PlayfairDisplay-Bold.ttf' -> { family: 'Playfair Display', weight: 700 }
function faceOf(file) {
  const [prefix, style] = file.replace('.ttf', '').split('-');
  const family = prefix.replace(/^DM/, 'DM ').replace(/([a-z])([A-Z])/g, '$1 $2');
  return { family, weight: WEIGHTS[style] ?? 400 };
}

let cachedCss = null;
export function fontCss() {
  if (cachedCss) return cachedCss;
  cachedCss = readdirSync(FONT_DIR)
    .filter((f) => f.endsWith('.ttf'))
    .map((file) => {
      const { family, weight } = faceOf(file);
      return `@font-face{font-family:"${family}";font-weight:${weight};font-style:normal;src:url(data:font/ttf;base64,${readFileSync(join(FONT_DIR, file)).toString('base64')}) format("truetype")}`;
    })
    .join('\n');
  return cachedCss;
}

// As famílias que o designer pode usar, com os pesos que existem de verdade (peso que não existe vira negrito falso).
export const FONT_MENU = (() => {
  const by = {};
  for (const f of readdirSync(FONT_DIR).filter((x) => x.endsWith('.ttf'))) {
    const { family, weight } = faceOf(f);
    (by[family] ??= []).push(weight);
  }
  return by;
})();

let browserPromise = null;
function browser() {
  browserPromise ??= puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--font-render-hinting=none', '--force-color-profile=srgb'] });
  return browserPromise;
}

export async function closeBrowser() {
  if (!browserPromise) return;
  const b = await browserPromise;
  browserPromise = null;
  await b.close();
}

const dataUri = (png) => `data:image/png;base64,${Buffer.from(png).toString('base64')}`;

// Troca os marcadores do designer pelos arquivos de verdade: {{asset:hero}} e {{logo:light|dark}}.
export function fillAssets(html, { assets = {}, logos = {} }) {
  return html
    .replace(/\{\{\s*asset:([\w-]+)\s*\}\}/g, (_, id) => (assets[id] ? dataUri(assets[id]) : ''))
    // O fechamento da aspa original fecha o data-logo: src="{{logo:on-light}}" vira src="URI" data-logo="on-light".
    .replace(/\{\{\s*logo:(on-light|on-dark)\s*\}\}/g, (_, tone) => `${logos[tone] ?? logos['on-light'] ?? logos['on-dark'] ?? ''}" data-logo="${tone}`);
}

// Documento completo: a página do designer mais as fontes. Script e URL externa saem antes do Chrome ver.
export function sanitize(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+="[^"]*"/gi, '')
    .replace(/<link[^>]*>/gi, '')
    .replace(/@import[^;]+;/gi, '');
}

function withFonts(html) {
  const style = `<style>${fontCss()}</style>`;
  return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => `${m}${style}`) : `${style}${html}`;
}

// Ajuste de corpo dos templates: todo elemento com data-fit encolhe o texto (6% por passo, até 60%) enquanto ele não couber
// na caixa. É código nosso, não do designer: o template só precisa dar à caixa um tamanho fixo.
function autofit() {
  for (const el of document.querySelectorAll('[data-fit]')) {
    const start = parseFloat(getComputedStyle(el).fontSize);
    let size = start;
    while ((el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1) && size > start * 0.6) {
      size *= 0.94;
      el.style.fontSize = `${size}px`;
    }
  }
}

// Roda dentro da página: lista cada elemento com texto próprio, onde ele está e se sai da margem do feed.
function auditPage({ width, height, margin }) {
  const out = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const text = node.textContent.replace(/\s+/g, ' ').trim();
    const el = node.parentElement;
    if (!text || !el || seen.has(el)) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
    seen.add(el);
    // Só o texto do próprio elemento (os filhos têm entrada à parte): união dos retângulos dos nós de texto dele.
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    for (const child of el.childNodes) {
      if (child.nodeType !== Node.TEXT_NODE || !child.textContent.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(child);
      for (const q of range.getClientRects()) {
        if (q.width === 0 || q.height === 0) continue;
        left = Math.min(left, q.left); top = Math.min(top, q.top); right = Math.max(right, q.right); bottom = Math.max(bottom, q.bottom);
      }
    }
    if (!(right > left && bottom > top)) continue;
    const r = { left, top, right, bottom, width: right - left, height: bottom - top };
    const bleed = !!el.closest('[data-bleed]');
    const family = cs.fontFamily.split(',')[0].replace(/["']/g, '').trim();
    // Opacidade efetiva: texto fantasma (aspas gigantes de fundo, marca d'água) não conta como texto lido.
    let opacity = 1;
    for (let node2 = el; node2 && node2 !== document.documentElement; node2 = node2.parentElement) opacity *= Number(getComputedStyle(node2).opacity);
    const issues = [];
    if (!bleed && (r.left < margin - 2 || r.top < margin - 2 || r.right > width - margin + 2 || r.bottom > height - margin + 2)) issues.push('margem');
    if (r.right > width + 2 || r.bottom > height + 2 || r.left < -2 || r.top < -2) issues.push('fora do quadro');
    if (el.scrollWidth > el.clientWidth + 2 && cs.overflow !== 'visible') issues.push('texto cortado');
    out.push({ text: text.slice(0, 80), x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), size: Math.round(parseFloat(cs.fontSize)), weight: cs.fontWeight, family, color: cs.color, ghost: opacity < 0.4 || (parseFloat(cs.fontSize) >= 160 && text.length <= 3), issues });
  }
  return out;
}

// Cada logo (img[data-logo]) é conferido contra o fundo que fica atrás dele: esconde o logo, fotografa a área e
// mede a luminância média. Versão para fundo claro sobre fundo escuro (ou o contrário) é o erro mais comum.
async function checkLogos(page, { sameFile }) {
  const found = await page.evaluate(() => [...document.querySelectorAll('img[data-logo]')].map((el, i) => {
    el.setAttribute('data-logo-i', String(i));
    const r = el.getBoundingClientRect();
    return { i, tone: el.getAttribute('data-logo'), x: Math.max(0, r.left), y: Math.max(0, r.top), w: r.width, h: r.height };
  }));
  const issues = [];
  for (const logo of found) {
    if (logo.h < 44 || logo.w < 110) issues.push({ rule: 'logo_small', detail: `logo com ${Math.round(logo.w)}x${Math.round(logo.h)}px (mínimo 110x44)` });
    if (logo.w < 4 || logo.h < 4) continue;
    await page.evaluate((i) => (document.querySelector(`[data-logo-i="${i}"]`).style.visibility = 'hidden'), logo.i);
    const shot = await page.screenshot({ type: 'png', clip: { x: logo.x, y: logo.y, width: logo.w, height: logo.h }, encoding: 'base64' });
    await page.evaluate((i) => (document.querySelector(`[data-logo-i="${i}"]`).style.visibility = 'visible'), logo.i);
    const lum = await page.evaluate(async (b64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let sum = 0;
      for (let p = 0; p < d.length; p += 4) sum += (0.2126 * d[p] + 0.7152 * d[p + 1] + 0.0722 * d[p + 2]) / 255;
      return sum / (d.length / 4);
    }, shot);
    if (!sameFile && ((logo.tone === 'on-light' && lum < 0.45) || (logo.tone === 'on-dark' && lum > 0.55))) issues.push({ rule: 'logo_contrast', detail: `a versão ${logo.tone} está sobre um fundo de luminância ${lum.toFixed(2)}: use a outra versão ou mude o fundo` });
  }
  return issues;
}

// Colisões e contraste (BEZ-405), medidos no navegador:
//  - text_overlap: duas caixas de texto se sobrepõem (fora o texto fantasma de fundo);
//  - arrow_over_text: um traço SVG sem preenchimento (seta, círculo, linha à mão) passa por dentro de um texto;
//  - contrast_low: com o texto escondido, fotografa o que há atrás de cada caixa e mede, pixel a pixel, o contraste da
//    cor do texto; mais de 30% dos pixels abaixo de 3:1 (o piso de texto grande do WCAG; o corpo mínimo é 24 px) reprova.
async function checkCollisions(page, texts) {
  const solid = texts.filter((t) => !t.ghost);
  const issues = [];
  for (let i = 0; i < solid.length; i += 1) {
    for (let j = i + 1; j < solid.length; j += 1) {
      const a = solid[i];
      const b = solid[j];
      // Caixa de linha com entrelinha apertada (0.9) se encosta sem colidir: compara só o miolo (60% da altura).
      const inner = (t) => ({ x: t.x, w: t.w, y: t.y + t.h * 0.2, h: t.h * 0.6 });
      const [ia, ib] = [inner(a), inner(b)];
      const w = Math.min(ia.x + ia.w, ib.x + ib.w) - Math.max(ia.x, ib.x);
      const h = Math.min(ia.y + ia.h, ib.y + ib.h) - Math.max(ia.y, ib.y);
      if (w > 4 && h > 4 && (w * h) / Math.min(ia.w * ia.h, ib.w * ib.h) > 0.15) issues.push({ rule: 'text_overlap', detail: `"${a.text}" e "${b.text}" se sobrepõem` });
    }
  }
  const crossings = await page.evaluate((rects) => {
    const hits = [];
    const geoms = [...document.querySelectorAll('svg path, svg line, svg polyline, svg circle, svg ellipse, svg rect')];
    for (const g of geoms) {
      const cs = getComputedStyle(g);
      const stroked = cs.stroke !== 'none' && parseFloat(cs.strokeWidth) > 0.5;
      const unfilled = cs.fill === 'none' || Number(cs.fillOpacity) === 0;
      if (!stroked || !unfilled || typeof g.getTotalLength !== 'function') continue;
      const m = g.getScreenCTM();
      if (!m) continue;
      const len = g.getTotalLength();
      if (!(len > 20)) continue;
      let inside = 0;
      for (let d = 0; d <= len; d += 8) {
        const p = g.getPointAtLength(d);
        const x = m.a * p.x + m.c * p.y + m.e;
        const y = m.b * p.x + m.d * p.y + m.f;
        if (rects.some((r) => x > r.x + 4 && x < r.x + r.w - 4 && y > r.y + 6 && y < r.y + r.h - 6)) inside += 1;
      }
      if (inside >= 3) hits.push(inside);
    }
    return hits;
  }, solid.map(({ x, y, w, h }) => ({ x, y, w, h })));
  if (crossings.length) issues.push({ rule: 'arrow_over_text', detail: `${crossings.length} traço(s) desenhado(s) cruzam texto` });

  const style = await page.addStyleTag({ content: '*{-webkit-text-fill-color:transparent!important;text-shadow:none!important;text-decoration-color:transparent!important} svg text{fill:transparent!important;stroke:none!important}' });
  const behind = await page.screenshot({ type: 'png', encoding: 'base64' });
  await page.evaluate((el) => el.remove(), style);
  const low = await page.evaluate(async (b64, rects) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const lin = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    const lum = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    const out = [];
    for (const t of rects) {
      // Marcas gráficas de uma ou duas letras (+, ●, aspas) são decoração, não texto lido.
      if (t.text.length <= 2) continue;
      const m = /rgba?\(([^)]+)\)/.exec(t.color);
      if (!m) continue;
      const [tr, tg, tb, ta = 1] = m[1].split(',').map((x) => parseFloat(x));
      const x0 = Math.max(0, Math.floor(t.x));
      const y0 = Math.max(0, Math.floor(t.y));
      const w = Math.min(img.width - x0, Math.ceil(t.w));
      const h = Math.min(img.height - y0, Math.ceil(t.h));
      if (w < 2 || h < 2) continue;
      const d = ctx.getImageData(x0, y0, w, h).data;
      const min = 3;
      let bad = 0;
      let n = 0;
      for (let p = 0; p < d.length; p += 12) {
        const br = d[p], bg = d[p + 1], bb = d[p + 2];
        const lt = lum(tr * ta + br * (1 - ta), tg * ta + bg * (1 - ta), tb * ta + bb * (1 - ta));
        const lb = lum(br, bg, bb);
        const ratio = (Math.max(lt, lb) + 0.05) / (Math.min(lt, lb) + 0.05);
        n += 1;
        if (ratio < min) bad += 1;
      }
      if (n && bad / n > 0.3) out.push(`"${t.text}" (${Math.round((100 * bad) / n)}% do fundo abaixo de ${min}:1)`);
    }
    return out;
  }, behind, solid.map(({ x, y, w, h, color, size, text }) => ({ x, y, w, h, color, size, text })));
  for (const l of low) issues.push({ rule: 'contrast_low', detail: l });
  return issues;
}

// Texto menor que isto não se lê no feed do celular (a plataforma usa 22 a 26 como piso).
export const MIN_TEXT_PX = 24;

export async function renderHtml(html, { ratio = '4:5', assets, logos } = {}) {
  const height = HEIGHT[ratio];
  const doc = withFonts(sanitize(fillAssets(html, { assets, logos })));
  const b = await browser();
  const page = await b.newPage();
  try {
    await page.setViewport({ width: WIDTH, height, deviceScaleFactor: 1 });
    await page.setRequestInterception(true);
    page.on('request', (req) => (req.url().startsWith('data:') || req.url().startsWith('about:') ? req.continue() : req.abort()));
    await page.setContent(doc, { waitUntil: 'load', timeout: 30_000 });
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(autofit);
    const texts = await page.evaluate(auditPage, { width: WIDTH, height, margin: MARGIN });
    const logoIssues = await checkLogos(page, { sameFile: !!logos && logos['on-light'] === logos['on-dark'] });
    const collisionIssues = await checkCollisions(page, texts);
    const png = Buffer.from(await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: WIDTH, height } }));
    const known = new Set(Object.keys(FONT_MENU));
    const issues = [];
    for (const t of texts) {
      if (t.size < MIN_TEXT_PX) issues.push({ rule: 'font_size', detail: `"${t.text}" a ${t.size}px (mínimo ${MIN_TEXT_PX}px)` });
      for (const i of t.issues) issues.push({ rule: i === 'margem' ? 'safe_margin' : i === 'texto cortado' ? 'text_clipped' : 'off_canvas', detail: `"${t.text}" (${i})` });
      if (!known.has(t.family)) issues.push({ rule: 'font_unknown', detail: `"${t.text}" usa ${t.family}, fora da lista` });
    }
    issues.push(...logoIssues, ...collisionIssues);
    return { png, texts, issues };
  } finally {
    await page.close();
  }
}

// Folha de contato (HTML -> PNG) para o relatório: várias imagens lado a lado, com legenda.
export async function contactSheet(items, { cols = 3, cell = 540, title = '' } = {}) {
  const gap = 16;
  const html = `<html><body style="margin:0;background:#111;font:600 15px/1.3 Inter,sans-serif;color:#eee"><div style="padding:${gap}px">${title ? `<div style="font-size:20px;margin-bottom:${gap}px">${title}</div>` : ''}<div style="display:grid;grid-template-columns:repeat(${cols},${cell}px);gap:${gap}px">${items
    .map((it) => `<figure style="margin:0"><img src="${dataUri(it.png)}" style="width:${cell}px;display:block;border-radius:6px"/><figcaption style="padding:6px 2px">${it.label}</figcaption></figure>`)
    .join('')}</div></div></body></html>`;
  const b = await browser();
  const page = await b.newPage();
  try {
    const w = cols * cell + (cols + 1) * gap;
    await page.setViewport({ width: w, height: 800 });
    await page.setContent(`<style>${fontCss()}</style>${html}`, { waitUntil: 'load' });
    return Buffer.from(await page.screenshot({ type: 'png', fullPage: true }));
  } finally {
    await page.close();
  }
}
