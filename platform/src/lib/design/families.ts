// families.ts: a biblioteca de famílias de layout (ADR 0017). Cada família recebe o DesignSpec e
// devolve o SVG (em pixels, 1080 de largura) e as caixas de texto que o revisor confere. Três
// famílias na fase 1: lista numerada e título em destaque (informativo), foto com título (atmosfera).
// Com a foto anexada no layout da marca (BEZ-251): foto na janela e foto no arco.

import { FONTS } from './fonts';
import { contrast, mix, over, untilContrast, type Hex } from './color';
import { HEIGHT, MARGIN, WIDTH, paletteFor, type DesignSpec, type Logo, type LogoCorner } from './model';
import { escapeXml, fitText, textWidth, type Fit } from './text';
import type { TextBox } from './review';
import { logoBlendsWith } from './logo-blend';
import type { Element, Place } from '../directives';

export type Composed = { svg: string; boxes: TextBox[]; overflow: string[]; width: number; height: number };

const LOGO_H = 72;
const SCRIM = 0.86;

function fontFace(family: string, bold: boolean): string {
  return `font-family="${escapeXml(family)}" font-weight="${bold ? 700 : 400}"`;
}

function textLines(fit: Fit, x: number, y: number, size: number, color: Hex, family: string, bold: boolean, extra = ''): string {
  return fit.lines
    .map((line, i) => `<text x="${x}" y="${Math.round(y + size + i * fit.lineHeight)}" font-size="${size}" fill="${color}" ${fontFace(family, bold)} ${extra}>${escapeXml(line)}</text>`)
    .join('');
}

function logoAt(logo: Logo | null | undefined, corner: LogoCorner, height: number, badge: Hex | null): { svg: string; box: { x: number; y: number; w: number; h: number } | null } {
  if (!logo) return { svg: '', box: null };
  const w = Math.round((LOGO_H * logo.width) / Math.max(1, logo.height));
  const x = corner === 'tl' || corner === 'bl' ? MARGIN : WIDTH - MARGIN - w;
  const y = corner === 'tl' || corner === 'tr' ? MARGIN : height - MARGIN - LOGO_H;
  const pad = 14;
  const plate = badge ? `<rect x="${x - pad}" y="${y - pad}" width="${w + pad * 2}" height="${LOGO_H + pad * 2}" rx="18" fill="${badge}" opacity="0.96"/>` : '';
  return { svg: `${plate}<image href="${logo.dataUri}" x="${x}" y="${y}" width="${w}" height="${LOGO_H}" preserveAspectRatio="xMidYMid meet"/>`, box: { x: x - pad, y: y - pad, w: w + pad * 2, h: LOGO_H + pad * 2 } };
}

function handleText(handle: string | null, x: number, y: number, color: Hex, family: string, anchor: 'start' | 'middle' | 'end'): { svg: string; box: TextBox | null } {
  if (!handle) return { svg: '', box: null };
  const size = 24;
  const text = `@${handle}`;
  const w = textWidth(text, family as never, size, 1.05);
  return {
    svg: `<text x="${x}" y="${y + size}" font-size="${size}" fill="${color}" ${fontFace(family, true)} letter-spacing="1.5" text-anchor="${anchor}">${escapeXml(text)}</text>`,
    box: { id: 'handle', x: anchor === 'end' ? x - w : anchor === 'middle' ? x - w / 2 : x, y, w, h: size * 1.2, size, color, bg: '#000000' },
  };
}

function listaNumerada(spec: DesignSpec): Composed {
  const H = HEIGHT[spec.ratio];
  const P = paletteFor(spec);
  const b = spec.brand;
  const heading = b.fontHeading;
  const body = b.fontBody;
  const boxes: TextBox[] = [];
  const overflow: string[] = [];
  const inner = WIDTH - MARGIN * 2;
  let y = MARGIN + 36;
  const parts: string[] = [];

  // Grafismo: círculo da marca no canto superior direito, atrás do texto.
  parts.push(`<rect width="${WIDTH}" height="${H}" fill="${P.bg}"/>`);
  parts.push(`<circle cx="${WIDTH - 60}" cy="90" r="300" fill="${mix(b.primary, P.bg, 0.78)}"/><circle cx="${WIDTH - 60}" cy="90" r="190" fill="${mix(b.primary, P.bg, 0.12)}"/><circle cx="${WIDTH - 60}" cy="90" r="80" fill="${P.bg}"/>`);

  const kicker = spec.texts.kicker?.trim();
  if (kicker) {
    const size = 26;
    const text = kicker.toUpperCase();
    parts.push(`<text x="${MARGIN}" y="${y + size}" font-size="${size}" fill="${P.kicker}" ${fontFace(body, true)} letter-spacing="4">${escapeXml(text)}</text>`);
    boxes.push({ id: 'kicker', x: MARGIN, y, w: Math.min(inner, textWidth(text, body, size, 1.2)), h: size * 1.3, size, color: P.kicker, bg: P.bg, bold: true });
    y += size + 36;
  } else y += 40;

  // Em 3 linhas; se a fonte for larga e o título comprido, uma quarta linha em vez de estourar (negrito real de Poppins e Montserrat).
  const titleOpts = { family: heading, maxWidth: 760, maxLines: 3, start: 100, min: 56, step: 4, lineHeight: 1.08, weightFactor: 1.08 };
  let title = fitText(spec.texts.title, titleOpts);
  if (title.overflow) title = fitText(spec.texts.title, { ...titleOpts, maxLines: 4 });
  if (title.overflow) overflow.push('title');
  parts.push(textLines(title, MARGIN, y, title.size, P.title, heading, true, 'letter-spacing="-1.5"'));
  boxes.push({ id: 'title', x: MARGIN, y, w: title.width, h: title.height, size: title.size, color: P.title, bg: P.bg, bold: true });
  y += title.height + 28;

  const sub = spec.texts.sub?.trim();
  if (sub) {
    const fit = fitText(sub, { family: body, maxWidth: 820, maxLines: 2, start: 34, min: 26, step: 2, lineHeight: 1.3 });
    if (fit.overflow) overflow.push('sub');
    parts.push(textLines(fit, MARGIN, y, fit.size, P.sub, body, false));
    boxes.push({ id: 'sub', x: MARGIN, y, w: fit.width, h: fit.height, size: fit.size, color: P.sub, bg: P.bg });
    y += fit.height + 24;
  }

  const items = (spec.texts.items ?? []).slice(0, 4);
  const reserved = MARGIN + LOGO_H + 48; // zona do logo e do @
  const available = H - reserved - y;
  const slot = Math.min(150, Math.floor(available / Math.max(1, items.length)));
  y += spec.ratio === '4:5' ? 48 : 24;
  items.forEach((item, i) => {
    const size = slot >= 130 ? 40 : slot >= 100 ? 36 : slot >= 84 ? 32 : 28;
    const badge = 46;
    const cy = y + badge / 2;
    parts.push(`<circle cx="${MARGIN + badge / 2}" cy="${cy}" r="${badge / 2}" fill="${P.kicker}"/><text x="${MARGIN + badge / 2}" y="${cy + 10}" font-size="26" text-anchor="middle" fill="${contrast(P.kicker, '#FFFFFF') >= 3 ? '#FFFFFF' : P.bg}" ${fontFace(body, true)}>${i + 1}</text>`);
    const fit = fitText(item, { family: body, maxWidth: inner - badge - 28, maxLines: 2, start: size, min: 26, step: 2, lineHeight: 1.25 });
    if (fit.overflow) overflow.push(`item${i + 1}`);
    const ty = fit.lines.length > 1 ? y - 6 : cy - fit.size * 0.62;
    parts.push(textLines(fit, MARGIN + badge + 28, ty, fit.size, P.items, body, false));
    boxes.push({ id: `item${i + 1}`, x: MARGIN + badge + 28, y: ty, w: fit.width, h: fit.height, size: fit.size, color: P.items, bg: P.bg });
    y += Math.max(slot, fit.height + 20);
  });

  const corner = spec.logoCorner ?? 'bl';
  const logo = logoAt(spec.logo, corner, H, spec.background && spec.background !== 'light' ? '#FFFFFF' : null);
  parts.push(logo.svg);
  const handleCorner: LogoCorner = corner === 'bl' ? 'br' : 'bl';
  const handle = handleText(b.handle, handleCorner === 'br' ? WIDTH - MARGIN : MARGIN, H - MARGIN - 30, P.sub, body, handleCorner === 'br' ? 'end' : 'start');
  parts.push(handle.svg);
  if (handle.box) boxes.push({ ...handle.box, bg: P.bg });
  return { svg: wrap(parts, H), boxes, overflow, width: WIDTH, height: H };
}

function tituloDestaque(spec: DesignSpec): Composed {
  const H = HEIGHT[spec.ratio];
  const P = paletteFor(spec);
  const b = spec.brand;
  const heading = b.fontHeading;
  const body = b.fontBody;
  const boxes: TextBox[] = [];
  const overflow: string[] = [];
  const parts: string[] = [`<rect width="${WIDTH}" height="${H}" fill="${P.bg}"/>`];
  // Grafismo: faixa de destaque e um aro no canto, na cor de detalhe.
  parts.push(`<circle cx="${WIDTH - 40}" cy="${H - 40}" r="260" fill="none" stroke="${b.accent}" stroke-width="28" opacity="0.35"/>`);

  const kicker = spec.texts.kicker?.trim();
  let y = MARGIN + 36;
  if (kicker) {
    const size = 26;
    const text = kicker.toUpperCase();
    parts.push(`<text x="${MARGIN}" y="${y + size}" font-size="${size}" fill="${P.kicker}" ${fontFace(body, true)} letter-spacing="4">${escapeXml(text)}</text>`);
    boxes.push({ id: 'kicker', x: MARGIN, y, w: Math.min(WIDTH - MARGIN * 2, textWidth(text, body, size, 1.2)), h: size * 1.3, size, color: P.kicker, bg: P.bg, bold: true });
    y += size + 40;
  }

  const title = fitText(spec.texts.title, { family: heading, maxWidth: WIDTH - MARGIN * 2 - 40, maxLines: 4, start: 120, min: 64, step: 4, lineHeight: 1.05, weightFactor: 1.08 });
  if (title.overflow) overflow.push('title');
  // Título centrado na vertical entre o selo e a zona do logo.
  const zoneTop = y;
  const zoneBottom = H - MARGIN - LOGO_H - 48;
  const sub = spec.texts.sub?.trim();
  const subFit = sub ? fitText(sub, { family: body, maxWidth: 800, maxLines: 3, start: 36, min: 26, step: 2, lineHeight: 1.3 }) : null;
  if (subFit?.overflow) overflow.push('sub');
  const block = title.height + (subFit ? 36 + subFit.height : 0) + 44;
  let ty = Math.max(zoneTop, Math.round(zoneTop + (zoneBottom - zoneTop - block) / 2));
  parts.push(`<rect x="${MARGIN}" y="${ty}" width="120" height="12" rx="6" fill="${b.accent}"/>`);
  ty += 44;
  parts.push(textLines(title, MARGIN, ty, title.size, P.title, heading, true, 'letter-spacing="-2"'));
  boxes.push({ id: 'title', x: MARGIN, y: ty, w: title.width, h: title.height, size: title.size, color: P.title, bg: P.bg, bold: true });
  ty += title.height + 36;
  if (subFit) {
    parts.push(textLines(subFit, MARGIN, ty, subFit.size, P.sub, body, false));
    boxes.push({ id: 'sub', x: MARGIN, y: ty, w: subFit.width, h: subFit.height, size: subFit.size, color: P.sub, bg: P.bg });
  }

  const corner = spec.logoCorner ?? 'bl';
  const logo = logoAt(spec.logo, corner, H, '#FFFFFF');
  parts.push(logo.svg);
  const handleCorner: LogoCorner = corner === 'bl' ? 'br' : 'bl';
  const handle = handleText(b.handle, handleCorner === 'br' ? WIDTH - MARGIN : MARGIN, H - MARGIN - 30, P.sub, body, handleCorner === 'br' ? 'end' : 'start');
  parts.push(handle.svg);
  if (handle.box) boxes.push({ ...handle.box, bg: P.bg });
  return { svg: wrap(parts, H), boxes, overflow, width: WIDTH, height: H };
}

function fotoTitulo(spec: DesignSpec): Composed {
  const H = HEIGHT[spec.ratio];
  const P = paletteFor(spec);
  const b = spec.brand;
  const heading = b.fontHeading;
  const body = b.fontBody;
  const boxes: TextBox[] = [];
  const overflow: string[] = [];
  const parts: string[] = [`<rect width="${WIDTH}" height="${H}" fill="${b.deep}"/>`];
  if (spec.visual?.dataUri) parts.push(`<image href="${spec.visual.dataUri}" x="0" y="0" width="${WIDTH}" height="${H}" preserveAspectRatio="xMidYMid slice"/>`);
  // Véu de baixo para cima num tom fundo da marca: o texto lê sobre qualquer foto. Da metade para
  // baixo o véu já está cheio, que é onde o selo, o título e o @ ficam.
  const scrim = untilContrast(mix(b.deep, '#000000', 0.3), '#FFFFFF', 7);
  parts.push(`<defs><linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${scrim}" stop-opacity="0"/><stop offset="0.3" stop-color="${scrim}" stop-opacity="0.55"/><stop offset="0.5" stop-color="${scrim}" stop-opacity="${SCRIM}"/><stop offset="1" stop-color="${scrim}" stop-opacity="${SCRIM}"/></linearGradient></defs>`);
  parts.push(`<rect x="0" y="${Math.round(H * 0.3)}" width="${WIDTH}" height="${Math.round(H * 0.7)}" fill="url(#scrim)"/>`);
  // Pior caso para o contraste: a foto é branca debaixo do véu.
  const textBg = over('#FFFFFF', scrim, SCRIM);

  // Sem título nem selo (o pedido mandou "sem texto na imagem"): só a foto, com o véu para o @ ler.
  if (spec.texts.title.trim() || spec.texts.kicker?.trim()) {
    const title = fitText(spec.texts.title, { family: heading, maxWidth: 820, maxLines: 3, start: 88, min: 56, step: 6, lineHeight: 1.08, weightFactor: 1.08 });
    if (title.overflow) overflow.push('title');
    const kicker = spec.texts.kicker?.trim();
    const kSize = 26;
    const bottom = H - MARGIN - LOGO_H - 44;
    let y = bottom - title.height;
    parts.push(textLines(title, MARGIN, y, title.size, P.title, heading, true, 'letter-spacing="-1.5"'));
    boxes.push({ id: 'title', x: MARGIN, y, w: title.width, h: title.height, size: title.size, color: P.title, bg: textBg, bold: true });
    if (kicker) {
      const text = kicker.toUpperCase();
      const ky = y - kSize - 24;
      parts.push(`<text x="${MARGIN}" y="${ky + kSize}" font-size="${kSize}" fill="${P.kicker}" ${fontFace(body, true)} letter-spacing="4">${escapeXml(text)}</text>`);
      boxes.push({ id: 'kicker', x: MARGIN, y: ky, w: Math.min(820, textWidth(text, body, kSize, 1.2)), h: kSize * 1.3, size: kSize, color: P.kicker, bg: textBg, bold: true });
      y = ky;
    }

  }

  const corner = spec.logoCorner ?? 'br';
  const logo = logoAt(spec.logo, corner, H, '#FFFFFF');
  parts.push(logo.svg);
  const handleCorner: LogoCorner = corner === 'br' ? 'bl' : 'br';
  const handle = handleText(b.handle, handleCorner === 'br' ? WIDTH - MARGIN : MARGIN, H - MARGIN - 30, P.sub, body, handleCorner === 'br' ? 'end' : 'start');
  parts.push(handle.svg);
  if (handle.box) boxes.push({ ...handle.box, bg: textBg });
  return { svg: wrap(parts, H), boxes, overflow, width: WIDTH, height: H };
}

// A foto (ou o visual) recortada para caber na área, sem distorcer; sem foto, um tom da marca.
function framedVisual(spec: DesignSpec, id: string, clip: string, box: { x: number; y: number; w: number; h: number }, fallback: Hex): string {
  const fill = `<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" fill="${fallback}"/>`;
  const image = spec.visual?.dataUri ? `<image href="${spec.visual.dataUri}" x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" preserveAspectRatio="xMidYMid slice"/>` : '';
  return `<defs><clipPath id="${id}">${clip}</clipPath></defs><g clip-path="url(#${id})">${fill}${image}</g>`;
}

// Selo e título embaixo da foto, sobre a cor do fundo; devolve onde o texto terminou.
function captionBlock(spec: DesignSpec, P: ReturnType<typeof paletteFor>, y: number, maxLines: number, parts: string[], boxes: TextBox[], overflow: string[]): void {
  const heading = spec.brand.fontHeading;
  const body = spec.brand.fontBody;
  const kicker = spec.texts.kicker?.trim();
  if (kicker) {
    const size = 26;
    const text = kicker.toUpperCase();
    parts.push(`<text x="${MARGIN}" y="${y + size}" font-size="${size}" fill="${P.kicker}" ${fontFace(body, true)} letter-spacing="4">${escapeXml(text)}</text>`);
    boxes.push({ id: 'kicker', x: MARGIN, y, w: Math.min(WIDTH - MARGIN * 2, textWidth(text, body, size, 1.2)), h: size * 1.3, size, color: P.kicker, bg: P.bg, bold: true });
    y += size + 26;
  }
  const title = fitText(spec.texts.title, { family: heading, maxWidth: 820, maxLines, start: 80, min: 56, step: 4, lineHeight: 1.08, weightFactor: 1.08 });
  if (title.overflow) overflow.push('title');
  parts.push(textLines(title, MARGIN, y, title.size, P.title, heading, true, 'letter-spacing="-1.5"'));
  boxes.push({ id: 'title', x: MARGIN, y, w: title.width, h: title.height, size: title.size, color: P.title, bg: P.bg, bold: true });
}

function signature(spec: DesignSpec, P: ReturnType<typeof paletteFor>, H: number, badge: Hex | null, parts: string[], boxes: TextBox[]): void {
  const corner = spec.logoCorner ?? 'bl';
  parts.push(logoAt(spec.logo, corner, H, badge).svg);
  const handleCorner: LogoCorner = corner === 'bl' ? 'br' : 'bl';
  const handle = handleText(spec.brand.handle, handleCorner === 'br' ? WIDTH - MARGIN : MARGIN, H - MARGIN - 30, P.sub, spec.brand.fontBody, handleCorner === 'br' ? 'end' : 'start');
  parts.push(handle.svg);
  if (handle.box) boxes.push({ ...handle.box, bg: P.bg });
}

// Janela: fundo claro da marca, a foto num quadro arredondado no alto, selo e título embaixo. O texto
// fica sempre sobre a cor da marca, então o contraste não depende da foto.
function fotoJanela(spec: DesignSpec): Composed {
  const H = HEIGHT[spec.ratio];
  const P = paletteFor(spec);
  const b = spec.brand;
  const boxes: TextBox[] = [];
  const overflow: string[] = [];
  const box = { x: MARGIN, y: MARGIN, w: WIDTH - MARGIN * 2, h: spec.ratio === '4:5' ? 720 : 500 };
  const parts: string[] = [`<rect width="${WIDTH}" height="${H}" fill="${P.bg}"/>`];
  // Grafismo: meio círculo da marca saindo da borda direita, entre a foto e a assinatura.
  parts.push(`<circle cx="${WIDTH + 60}" cy="${Math.round(box.y + box.h + (H - box.y - box.h) * 0.42)}" r="170" fill="${mix(b.primary, P.bg, 0.82)}"/>`);
  parts.push(framedVisual(spec, 'janela', `<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="36"/>`, box, mix(b.primary, P.bg, 0.6)));
  captionBlock(spec, P, box.y + box.h + 48, spec.ratio === '4:5' ? 3 : 2, parts, boxes, overflow);
  signature(spec, P, H, null, parts, boxes);
  return { svg: wrap(parts, H), boxes, overflow, width: WIDTH, height: H };
}

// Arco: fundo na cor profunda da marca, a foto num arco à direita encostado no topo; título claro
// sobre a cor. O logo ganha uma placa branca para ler sobre o fundo escuro.
function fotoArco(spec: DesignSpec): Composed {
  const H = HEIGHT[spec.ratio];
  const P = paletteFor(spec);
  const b = spec.brand;
  const boxes: TextBox[] = [];
  const overflow: string[] = [];
  const w = spec.ratio === '4:5' ? 680 : 560;
  const h = spec.ratio === '4:5' ? 780 : 600;
  const x = WIDTH - MARGIN - w;
  const r = w / 2;
  const parts: string[] = [`<rect width="${WIDTH}" height="${H}" fill="${P.bg}"/>`];
  parts.push(`<circle cx="70" cy="120" r="190" fill="${mix('#FFFFFF', P.bg, 0.9)}"/>`);
  const arch = `<path d="M${x} ${h} V${r} A${r} ${r} 0 0 1 ${x + w} ${r} V${h} Z"/>`;
  parts.push(framedVisual(spec, 'arco', arch, { x, y: 0, w, h }, mix(b.primary, '#FFFFFF', 0.35)));
  captionBlock(spec, P, h + 52, spec.ratio === '4:5' ? 3 : 2, parts, boxes, overflow);
  signature(spec, P, H, '#FFFFFF', parts, boxes);
  return { svg: wrap(parts, H), boxes, overflow, width: WIDTH, height: H };
}

// Cartão de marca (SPEC 020): fundo liso pela paleta da marca e, em cada célula da grade 3x3, uma pilha com o
// que o pedido mandar pôr ali (logo, nome da empresa, frase, @). Sem instrução, o padrão é a assinatura das
// outras famílias: logo pequeno embaixo à esquerda e @ embaixo à direita; nome e frase só aparecem se existirem.
// Logo no centro sai grande. Dois elementos na mesma célula empilham (o nome vai logo abaixo do logo).
const PLACE_COL: Record<Place, 'l' | 'c' | 'r'> = { tl: 'l', ml: 'l', bl: 'l', tc: 'c', c: 'c', bc: 'c', tr: 'r', mr: 'r', br: 'r' };
const PLACE_ROW: Record<Place, 't' | 'm' | 'b'> = { tl: 't', tc: 't', tr: 't', ml: 'm', c: 'm', mr: 'm', bl: 'b', bc: 'b', br: 'b' };
const STACK_ORDER: Element[] = ['logo', 'name', 'title', 'handle'];
const STACK_GAP = 36;
const PLATE_PAD = 14;
const TEXT_GAP = 40; // folga mínima entre dois elementos da mesma linha

// Onde fica cada elemento depois de somar o pedido, o padrão e o que existe (sem logo, não há logo para pôr).
export function markPlacements(spec: DesignSpec): Partial<Record<Element, Place>> {
  const pl = spec.placements ?? {};
  const out: Partial<Record<Element, Place>> = {};
  const logo: Place | null = pl.logo === 'off' || !spec.logo ? null : pl.logo ?? spec.logoCorner ?? 'bl';
  if (logo) out.logo = logo;
  const handle: Place | null = pl.handle === 'off' || !spec.brand.handle ? null : pl.handle ?? (logo === 'br' ? 'bl' : 'br');
  if (handle) out.handle = handle;
  if (pl.name !== 'off' && spec.brandName) {
    // "O nome embaixo do logo" com o logo no centro é a mesma pilha: nome e logo na mesma célula.
    const name = pl.name === 'bc' && logo === 'c' ? 'c' : pl.name ?? logo ?? 'c';
    out.name = name;
  }
  if (pl.title !== 'off' && spec.texts.title.trim()) out.title = pl.title ?? 'c';
  return out;
}

function marca(spec: DesignSpec): Composed {
  const H = HEIGHT[spec.ratio];
  const P = paletteFor(spec);
  const b = spec.brand;
  const heading = b.fontHeading;
  const body = b.fontBody;
  const where = markPlacements(spec);
  const inner = WIDTH - MARGIN * 2;
  const boxes: TextBox[] = [];
  const overflow: string[] = [];
  const parts: string[] = [`<rect width="${WIDTH}" height="${H}" fill="${P.bg}"/>`];
  const light = spec.background === 'light';
  const plate = light ? null : '#FFFFFF';

  type Item = { id: Element; h: number; draw: (x: number, y: number, col: 'l' | 'c' | 'r') => void };
  const items: Item[] = [];
  // Larguras já ocupadas por linha da grade (topo, meio, base) e coluna: um texto largo numa célula não pode
  // invadir o logo ou o @ da célula do lado, na mesma linha. Cada texto cabe no que sobra.
  const taken: { row: 't' | 'm' | 'b'; col: 'l' | 'c' | 'r'; w: number }[] = [];
  const take = (place: Place, w: number) => taken.push({ row: PLACE_ROW[place], col: PLACE_COL[place], w });
  const roomFor = (place: Place): number => {
    const row = PLACE_ROW[place];
    const col = PLACE_COL[place];
    const others = taken.filter((t) => t.row === row && t.col !== col);
    let room = inner;
    for (const o of others) {
      const edge = o.col === 'l' ? MARGIN + o.w : o.col === 'r' ? WIDTH - MARGIN - o.w : WIDTH / 2; // borda do outro, do lado de dentro
      const half = o.col === 'c' ? o.w / 2 : 0;
      if (col === 'l') room = Math.min(room, (o.col === 'c' ? WIDTH / 2 - half : WIDTH - MARGIN - o.w) - TEXT_GAP - MARGIN);
      else if (col === 'r') room = Math.min(room, WIDTH - MARGIN - ((o.col === 'c' ? WIDTH / 2 + half : MARGIN + o.w) + TEXT_GAP));
      else room = Math.min(room, 2 * (o.col === 'l' ? WIDTH / 2 - (MARGIN + o.w) : o.col === 'r' ? WIDTH - MARGIN - o.w - WIDTH / 2 : Infinity) - 2 * TEXT_GAP);
      void edge;
    }
    return Math.max(160, Math.round(room));
  };
  const anchorOf = (col: 'l' | 'c' | 'r') => (col === 'l' ? 'start' : col === 'c' ? 'middle' : 'end');
  const left = (col: 'l' | 'c' | 'r', x: number, w: number) => (col === 'l' ? x : col === 'c' ? x - w / 2 : x - w);

  if (where.logo && spec.logo) {
    const large = where.logo === 'c';
    const logo = spec.logo;
    const h = large ? Math.round(H * 0.3) : LOGO_H;
    const w = Math.min(inner, Math.round((h * logo.width) / Math.max(1, logo.height)));
    // O logo grande some quando tem a cor do fundo: nesse caso ganha uma placa clara, como os pequenos.
    const blends = large && !light && logoBlendsWith(logo, P.bg);
    const pad = large && !blends ? 0 : large ? PLATE_PAD * 2 : PLATE_PAD;
    take(where.logo, w + pad * 2);
    items.push({
      id: 'logo',
      h: h + pad * 2,
      draw: (x, y, col) => {
        const lx = left(col, x, w + pad * 2);
        if (pad && plate) parts.push(`<rect x="${lx}" y="${y}" width="${w + pad * 2}" height="${h + pad * 2}" rx="18" fill="${plate}" opacity="0.96"/>`);
        parts.push(`<image href="${logo.dataUri}" x="${lx + pad}" y="${y + pad}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet"/>`);
      },
    });
  }
  if (where.handle && b.handle) take(where.handle, textWidth(`@${b.handle}`, body, 24, 1.05));
  if (where.name && spec.brandName) {
    const fit = fitText(spec.brandName, { family: heading, maxWidth: roomFor(where.name), maxLines: 2, start: where.logo === where.name && where.name === 'c' ? 72 : 76, min: 40, step: 4, lineHeight: 1.1, weightFactor: 1.08 });
    if (fit.overflow) overflow.push('name');
    take(where.name, fit.width);
    items.push({
      id: 'name',
      h: fit.height,
      draw: (x, y, col) => {
        parts.push(textLines(fit, x, y, fit.size, P.title, heading, true, `text-anchor="${anchorOf(col)}" letter-spacing="-1"`));
        boxes.push({ id: 'name', x: left(col, x, fit.width), y, w: fit.width, h: fit.height, size: fit.size, color: P.title, bg: P.bg, bold: true });
      },
    });
  }
  if (where.title) {
    const text = spec.texts.title.trim();
    let start = text.length <= 14 ? 200 : text.length <= 30 ? 130 : 100;
    // A frase divide a célula com o que já está nela (logo, nome): cabe no que sobra da altura, sem invadir o @.
    const sharing = items.filter((i) => where[i.id] === where.title);
    const reservedBottom = where.handle && where.handle !== where.title && PLACE_ROW[where.handle] === 'b' ? 24 * 1.2 + STACK_GAP : 0;
    const budget = H - MARGIN * 2 - reservedBottom - sharing.reduce((sum, i) => sum + i.h + STACK_GAP, 0);
    const room = roomFor(where.title);
    let fit = fitText(text, { family: heading, maxWidth: room, maxLines: 4, start, min: 56, step: 4, lineHeight: 1.08, weightFactor: 1.08 });
    while (fit.height > budget && start > 56) {
      start = Math.max(56, start - 8);
      fit = fitText(text, { family: heading, maxWidth: room, maxLines: 4, start, min: 56, step: 4, lineHeight: 1.08, weightFactor: 1.08 });
    }
    if (fit.overflow) overflow.push('title');
    take(where.title, fit.width);
    items.push({
      id: 'title',
      h: fit.height,
      draw: (x, y, col) => {
        parts.push(textLines(fit, x, y, fit.size, P.title, heading, true, `text-anchor="${anchorOf(col)}" letter-spacing="-2"`));
        boxes.push({ id: 'title', x: left(col, x, fit.width), y, w: fit.width, h: fit.height, size: fit.size, color: P.title, bg: P.bg, bold: true });
      },
    });
  }
  if (where.handle) {
    items.push({
      id: 'handle',
      h: 24 * 1.2,
      draw: (x, y, col) => {
        const h = handleText(b.handle, x, y, P.sub, body, anchorOf(col));
        parts.push(h.svg);
        if (h.box) boxes.push({ ...h.box, bg: P.bg });
      },
    });
  }

  // Uma pilha por célula, na ordem logo, nome, frase, @. A linha da célula decide de onde a pilha parte.
  const cells = new Map<Place, Item[]>();
  for (const el of STACK_ORDER) {
    const item = items.find((i) => i.id === el);
    const place = where[el];
    if (item && place) cells.set(place, [...(cells.get(place) ?? []), item]);
  }
  for (const [place, stack] of cells) {
    const total = stack.reduce((sum, i) => sum + i.h, 0) + STACK_GAP * (stack.length - 1);
    const row = PLACE_ROW[place];
    let y = row === 't' ? MARGIN : row === 'm' ? Math.round((H - total) / 2) : H - MARGIN - total;
    const col = PLACE_COL[place];
    const x = col === 'l' ? MARGIN : col === 'c' ? WIDTH / 2 : WIDTH - MARGIN;
    for (const item of stack) {
      item.draw(x, Math.round(y), col);
      y += item.h + STACK_GAP;
    }
  }
  return { svg: wrap(parts, H), boxes, overflow, width: WIDTH, height: H };
}

// Lâmina de conteúdo do carrossel (SPEC 023): o número do item num círculo da marca, o selo ao lado ("Sinal 1 de 3"
// ou o que o redator escreveu), o título grande e o subtítulo. Fundo claro da marca, assinatura como nas outras
// famílias e uma barra de progresso das lâminas embaixo, para a pessoa ver quanto falta.
function laminaItem(spec: DesignSpec): Composed {
  const H = HEIGHT[spec.ratio];
  const P = paletteFor(spec);
  const b = spec.brand;
  const heading = b.fontHeading;
  const body = b.fontBody;
  const pos = spec.slide;
  const boxes: TextBox[] = [];
  const overflow: string[] = [];
  const inner = WIDTH - MARGIN * 2;
  const parts: string[] = [`<rect width="${WIDTH}" height="${H}" fill="${P.bg}"/>`];
  parts.push(`<circle cx="${WIDTH - 40}" cy="60" r="250" fill="${mix(b.primary, P.bg, 0.86)}"/>`);

  let y = MARGIN + 36;
  const r = 84;
  const cx = MARGIN + r;
  const cy = y + r;
  const badgeText = contrast(P.kicker, '#FFFFFF') >= 3 ? '#FFFFFF' : P.bg;
  parts.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${P.kicker}"/>`);
  if (pos?.item) parts.push(`<text x="${cx}" y="${cy + 38}" font-size="112" text-anchor="middle" fill="${badgeText}" ${fontFace(heading, true)}>${pos.item}</text>`);

  const label = (spec.texts.kicker?.trim() || (pos?.item && pos.items ? `${pos.item} de ${pos.items}` : '')).toUpperCase();
  if (label) {
    const size = 28;
    const lx = cx + r + 32;
    parts.push(`<text x="${lx}" y="${cy + size / 2 - 4}" font-size="${size}" fill="${P.kicker}" ${fontFace(body, true)} letter-spacing="4">${escapeXml(label)}</text>`);
    boxes.push({ id: 'kicker', x: lx, y: cy - size / 2 - 8, w: Math.min(WIDTH - MARGIN - lx, textWidth(label, body, size, 1.2)), h: size * 1.3, size, color: P.kicker, bg: P.bg, bold: true });
  }
  y = cy + r + 72;

  const title = fitText(spec.texts.title, { family: heading, maxWidth: inner, maxLines: 4, start: 96, min: 56, step: 4, lineHeight: 1.08, weightFactor: 1.08 });
  if (title.overflow) overflow.push('title');
  parts.push(textLines(title, MARGIN, y, title.size, P.title, heading, true, 'letter-spacing="-1.5"'));
  boxes.push({ id: 'title', x: MARGIN, y, w: title.width, h: title.height, size: title.size, color: P.title, bg: P.bg, bold: true });
  y += title.height + 36;

  const sub = spec.texts.sub?.trim();
  if (sub) {
    const fit = fitText(sub, { family: body, maxWidth: 860, maxLines: 4, start: 40, min: 26, step: 2, lineHeight: 1.3 });
    if (fit.overflow) overflow.push('sub');
    parts.push(textLines(fit, MARGIN, y, fit.size, P.sub, body, false));
    boxes.push({ id: 'sub', x: MARGIN, y, w: fit.width, h: fit.height, size: fit.size, color: P.sub, bg: P.bg });
  }

  if (pos && pos.of > 1) {
    const gap = 10;
    const seg = Math.min(96, Math.floor((inner - gap * (pos.of - 1)) / pos.of));
    const by = H - MARGIN - LOGO_H - 44;
    for (let i = 0; i < pos.of; i += 1) {
      parts.push(`<rect x="${MARGIN + i * (seg + gap)}" y="${by}" width="${seg}" height="8" rx="4" fill="${i + 1 === pos.n ? P.kicker : mix(b.primary, P.bg, 0.78)}"/>`);
    }
  }
  signature(spec, P, H, null, parts, boxes);
  return { svg: wrap(parts, H), boxes, overflow, width: WIDTH, height: H };
}

function wrap(parts: string[], H: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${H}" viewBox="0 0 ${WIDTH} ${H}">${parts.join('')}</svg>`;
}

export function compose(spec: DesignSpec): Composed {
  if (spec.layout === 'lista-numerada') return listaNumerada(spec);
  if (spec.layout === 'titulo-destaque') return tituloDestaque(spec);
  if (spec.layout === 'foto-janela') return fotoJanela(spec);
  if (spec.layout === 'foto-arco') return fotoArco(spec);
  if (spec.layout === 'marca') return marca(spec);
  if (spec.layout === 'lamina-item') return laminaItem(spec);
  return fotoTitulo(spec);
}

// As famílias que servem a cada tipo de post (a tela de "trocar layout" da fase 2 lê daqui).
export const FAMILIES_BY_KIND = { informativo: ['lista-numerada', 'titulo-destaque'], atmosfera: ['foto-titulo', 'foto-janela', 'foto-arco'] } as const;

export { FONTS };
