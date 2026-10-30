// browser-scripts.ts: o código que roda DENTRO da página do Chromium na medição do render (SPEC 030, F3). Fica em string e não em
// função de TypeScript para o empacotador (esbuild, SWC) nunca injetar helper dele no meio e quebrar a avaliação no navegador.
// Portado de evals/studio/render.js sem mudança de lógica; cada constante é uma função que recebe um argumento e devolve JSON.

// Encolhe o texto dos elementos com data-fit até caber na caixa (6% por passo, até 60%).
export const AUTOFIT = `(function autofit(_) {
  for (const el of document.querySelectorAll('[data-fit]')) {
    const start = parseFloat(getComputedStyle(el).fontSize);
    let size = start;
    while ((el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1) && size > start * 0.6) {
      size *= 0.94;
      el.style.fontSize = \`\${size}px\`;
    }
  }
})`;

// Lista cada elemento com texto próprio: onde está, corpo, cor e se sai da margem do feed.
export const AUDIT_PAGE = `(function auditPage({ width, height, margin }) {
  const out = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const text = node.textContent.replace(/\\s+/g, ' ').trim();
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
    // data-bleed marca o texto que sangra de propósito (numeral gigante, palavra cortada pela borda): vale para a margem e para o quadro.
    if (!bleed && (r.right > width + 2 || r.bottom > height + 2 || r.left < -2 || r.top < -2)) issues.push('fora do quadro');
    if (el.scrollWidth > el.clientWidth + 2 && cs.overflow !== 'visible') issues.push('texto cortado');
    el.setAttribute('data-audit-i', String(out.length));
    out.push({ i: out.length, text: text.slice(0, 80), x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), size: Math.round(parseFloat(cs.fontSize)), weight: cs.fontWeight, family, color: cs.color, ghost: opacity < 0.4 || (parseFloat(cs.fontSize) >= 160 && text.length <= 3), issues });
  }
  return out;
})`;

// Texto coberto por outro elemento pintado (post-it, cartão, imagem por cima da lista): em pontos do meio de cada linha do texto (um a cada 6px), o elemento do
// topo não é o próprio texto nem parente dele e tem pintura. Recebe as caixas do AUDIT_PAGE (o índice liga ao data-audit-i) e devolve os textos cobertos.
export const COVERED_TEXT = `((boxes) => {
  const SHAPES = ['svg', 'path', 'rect', 'circle', 'ellipse', 'polygon', 'polyline', 'line'];
  const paints = (el) => {
    const cs = getComputedStyle(el);
    if (Number(cs.opacity) < 0.5 || cs.visibility === 'hidden') return false;
    const tag = el.tagName.toLowerCase();
    if (tag === 'img' || tag === 'canvas' || tag === 'video' || tag === 'image') return true;
    if (SHAPES.includes(tag)) return (cs.fill && cs.fill !== 'none') || (cs.stroke && cs.stroke !== 'none');
    const bg = /rgba?\\(([^)]+)\\)/.exec(cs.backgroundColor);
    const alpha = bg ? (bg[1].split(',').length > 3 ? Number(bg[1].split(',')[3]) : 1) : 0;
    return alpha > 0.5 || (cs.backgroundImage && cs.backgroundImage !== 'none');
  };
  const out = [];
  for (const b of boxes) {
    const el = document.querySelector('[data-audit-i="' + b.i + '"]');
    if (!el) continue;
    // Linha por linha (a caixa de um parágrafo tem vazios, e ali pode haver outro elemento legítimo).
    let covered = 0;
    for (const child of el.childNodes) {
      if (child.nodeType !== Node.TEXT_NODE || !child.textContent.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(child);
      for (const q of range.getClientRects()) {
        if (q.width < 4 || q.height < 4) continue;
        // Um ponto a cada 6px no máximo: 2 pontos cobertos são pelo menos 12px de texto escondido.
        const steps = Math.max(10, Math.ceil(q.width / 6));
        for (let k = 0; k < steps; k += 1) {
          const x = q.left + 2 + ((q.width - 4) * (k + 0.5)) / steps;
          const y = q.top + q.height / 2;
          if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
          // Tudo o que está acima do texto neste ponto, do topo para baixo: um pai transparente (o texto do post-it) não esconde o post-it pintado.
          let hidden = false;
          for (const above of document.elementsFromPoint(x, y)) {
            if (above === el || el.contains(above)) break;
            if (above.contains(el)) continue;
            if (paints(above)) {
              hidden = true;
              break;
            }
          }
          if (hidden) covered += 1;
        }
      }
    }
    if (covered >= 2) out.push(b.text);
  }
  return out;
})`;

// Os logos da página (img[data-logo]) com posição e tom.
export const FIND_LOGOS = `(() => [...document.querySelectorAll('img[data-logo]')].map((el, i) => {
    el.setAttribute('data-logo-i', String(i));
    const r = el.getBoundingClientRect();
    return { i, tone: el.getAttribute('data-logo'), x: Math.max(0, r.left), y: Math.max(0, r.top), w: r.width, h: r.height };
  }))`;

// Luminância média de uma imagem em base64 (o fundo atrás do logo).
export const MEAN_LUMINANCE = `(async (b64) => {
      const img = new Image();
      img.src = \`data:image/png;base64,\${b64}\`;
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
    })`;

// Traços SVG sem preenchimento que passam por dentro de um texto.
export const STROKES_OVER_TEXT = `((rects) => {
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
  })`;

// Contraste do texto contra o que há atrás, pixel a pixel (com o texto escondido).
export const LOW_CONTRAST = `(async (b64, rects) => {
    const img = new Image();
    img.src = \`data:image/png;base64,\${b64}\`;
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
      const m = /rgba?\\(([^)]+)\\)/.exec(t.color);
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
      if (n && bad / n > 0.3) out.push(\`"\${t.text}" (\${Math.round((100 * bad) / n)}% do fundo abaixo de \${min}:1)\`);
    }
    return out;
  })`;

// Quantos pixels têm tinta nos dois textos (cada um fotografado sozinho, contra o fundo sem texto): onde as letras de fato se tocam.
export const INK_OVERLAP = `(async (base64, a64, b64) => {
      const load = async (b) => { const img = new Image(); img.src = \`data:image/png;base64,\${b}\`; await img.decode(); const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0); return ctx.getImageData(0, 0, c.width, c.height).data; };
      const [base, a, b] = await Promise.all([load(base64), load(a64), load(b64)]);
      let both = 0;
      const ink = (d, p) => Math.abs(d[p] - base[p]) + Math.abs(d[p + 1] - base[p + 1]) + Math.abs(d[p + 2] - base[p + 2]) > 90;
      for (let p = 0; p < base.length; p += 4) if (ink(a, p) && ink(b, p)) both += 1;
      return both;
    })`;

// Logo com fundo opaco de uma cor só (um quadrado atrás do ícone): tira essa cor e deixa só o ícone. Só age quando os 4 cantos são opacos e da
// mesma cor. O ícone é recomposto sem o fundo (a borda suavizada vira transparência, sem aro), então a logo assenta em qualquer fundo do post.
export const KEY_LOGOS = `(async () => {
  const keyed = [];
  for (const img of document.querySelectorAll('img[data-logo]')) {
    if (img.dataset.keyed) continue;
    if (!img.complete) await new Promise((r) => { img.onload = r; img.onerror = r; });
    const w = img.naturalWidth, h = img.naturalHeight;
    if (!w || !h || w > 4096 || h > 4096) continue;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    const im = ctx.getImageData(0, 0, w, h);
    const d = im.data;
    const at = (x, y) => { const p = (y * w + x) * 4; return [d[p], d[p + 1], d[p + 2], d[p + 3]]; };
    const corners = [at(1, 1), at(w - 2, 1), at(1, h - 2), at(w - 2, h - 2)];
    const bg = corners[0];
    const dist = (a, b) => Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
    if (corners.some((k) => k[3] < 250 || dist(k, bg) > 18)) continue;
    // A cor do ícone: a média dos pixels bem distantes do fundo (o ícone é de uma cor só na grande maioria das logos).
    let maxD = 0;
    for (let p = 0; p < d.length; p += 4) maxD = Math.max(maxD, dist([d[p], d[p + 1], d[p + 2]], bg));
    if (maxD < 40) continue;
    let sr = 0, sg = 0, sb = 0, n = 0;
    for (let p = 0; p < d.length; p += 4) { if (dist([d[p], d[p + 1], d[p + 2]], bg) > maxD * 0.85) { sr += d[p]; sg += d[p + 1]; sb += d[p + 2]; n += 1; } }
    const fg = [sr / n, sg / n, sb / n];
    const span = dist(fg, bg);
    for (let p = 0; p < d.length; p += 4) {
      const a = Math.max(0, Math.min(1, dist([d[p], d[p + 1], d[p + 2]], bg) / span));
      d[p] = fg[0]; d[p + 1] = fg[1]; d[p + 2] = fg[2];
      d[p + 3] = a < 0.04 ? 0 : Math.round(a * 255);
    }
    ctx.putImageData(im, 0, 0);
    img.src = c.toDataURL('image/png');
    img.dataset.keyed = '1';
    await img.decode().catch(() => undefined);
    keyed.push(1);
  }
  return keyed.length;
})`;
