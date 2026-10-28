// scene-edit.ts: as contas do editor do Studio (SPEC 027), puras e sem DOM: encaixe nas guias, redimensionar, girar, alinhar,
// distribuir, camadas novas e os avisos ao vivo. A tela só liga o ponteiro a estas funções; o revisor do servidor repete a conferência
// ao confirmar (o PNG que o servidor desenha é a verdade).

import { MARGIN } from './model';
import { reviewLayout, type Issue } from './review';
import { layerHeight, sceneBoxes, type Scene, type SceneLayer, type ShapeLayer, type TextLayer } from './scene';
import type { Hex } from './color';

export type Box = { x: number; y: number; w: number; h: number };
export type Guide = { axis: 'x' | 'y'; at: number };
export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export const SNAP = 9;
export const MIN_SIZE = 24;

export const boxOf = (l: SceneLayer): Box => ({ x: l.x, y: l.y, w: l.w, h: layerHeight(l) });

export function unionBox(layers: readonly SceneLayer[]): Box | null {
  if (!layers.length) return null;
  const boxes = layers.map(boxOf);
  const x1 = Math.min(...boxes.map((b) => b.x)), y1 = Math.min(...boxes.map((b) => b.y));
  const x2 = Math.max(...boxes.map((b) => b.x + b.w)), y2 = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

// Encaixe ao mover: o centro do conjunto, as margens do feed e as bordas e centros das outras camadas. Devolve o deslocamento já
// corrigido e as guias a desenhar.
export function snapMove(scene: Scene, ids: readonly string[], dx: number, dy: number, size: { width: number; height: number }): { dx: number; dy: number; guides: Guide[] } {
  const moving = scene.layers.filter((l) => ids.includes(l.id));
  const u = unionBox(moving);
  if (!u) return { dx, dy, guides: [] };
  const box = { x: u.x + dx, y: u.y + dy, w: u.w, h: u.h };
  const xs: number[] = [size.width / 2, MARGIN, size.width - MARGIN];
  const ys: number[] = [size.height / 2, MARGIN, size.height - MARGIN];
  for (const o of scene.layers) {
    if (ids.includes(o.id) || o.hidden) continue;
    const b = boxOf(o);
    xs.push(b.x, b.x + b.w / 2, b.x + b.w);
    ys.push(b.y, b.y + b.h / 2, b.y + b.h);
  }
  const guides: Guide[] = [];
  const pick = (targets: number[], cur: number[]): number | null => {
    let best: { d: number; at: number } | null = null;
    for (const c of cur) for (const t of targets) { const d = t - c; if (Math.abs(d) <= SNAP && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, at: t }; }
    return best ? (guides.push({ axis: cur === curX ? 'x' : 'y', at: best.at }), best.d) : null;
  };
  const curX = [box.x, box.x + box.w / 2, box.x + box.w];
  const curY = [box.y, box.y + box.h / 2, box.y + box.h];
  const sx = pick(xs, curX);
  const sy = pick(ys, curY);
  return { dx: dx + (sx ?? 0), dy: dy + (sy ?? 0), guides };
}

export function moveLayers(scene: Scene, ids: readonly string[], dx: number, dy: number): Scene {
  return { ...scene, layers: scene.layers.map((l) => (ids.includes(l.id) && !l.locked ? { ...l, x: l.x + dx, y: l.y + dy } : l)) };
}

// Redimensiona pela alça. Texto: a alça de canto muda o tamanho da fonte na mesma proporção e a lateral muda só a largura (o texto
// quebra de novo); logo e imagem mantêm a proporção; forma é livre. Qualquer mudança de tamanho apaga as linhas guardadas.
export function resizeLayer(l: SceneLayer, handle: Handle, dx: number, dy: number): SceneLayer {
  if (l.locked) return l;
  const h0 = layerHeight(l);
  let { x, y, w } = l;
  let h = h0;
  if (handle.includes('e')) w = Math.max(MIN_SIZE, l.w + dx);
  if (handle.includes('w')) { w = Math.max(MIN_SIZE, l.w - dx); x = l.x + (l.w - w); }
  if (handle.includes('s')) h = Math.max(MIN_SIZE, h0 + dy);
  if (handle.includes('n')) { h = Math.max(MIN_SIZE, h0 - dy); y = l.y + (h0 - h); }
  if (l.type === 'text') {
    const corner = handle.length === 2;
    if (!corner) return { ...l, x, w, lines: undefined };
    const size = Math.max(8, Math.round(l.size * (w / l.w)));
    const next = { ...l, x, w, size, lines: undefined };
    return { ...next, y: handle.includes('n') ? l.y + (h0 - layerHeight(next)) : l.y };
  }
  if (l.type === 'logo') {
    const s = Math.max(w / l.w, h / h0);
    const nw = Math.round(l.w * s), nh = Math.round(l.h * s);
    return { ...l, w: nw, h: nh, x: handle.includes('w') ? l.x + l.w - nw : l.x, y: handle.includes('n') ? l.y + l.h - nh : l.y };
  }
  return { ...l, x, y, w, h };
}

export function rotateLayer(l: SceneLayer, point: { x: number; y: number }, snap = true): SceneLayer {
  if (l.locked) return l;
  const c = { x: l.x + l.w / 2, y: l.y + layerHeight(l) / 2 };
  let deg = (Math.atan2(point.y - c.y, point.x - c.x) * 180) / Math.PI + 90;
  deg = ((deg + 540) % 360) - 180;
  if (snap) for (const k of [-180, -135, -90, -45, 0, 45, 90, 135, 180]) if (Math.abs(deg - k) < 4) deg = k;
  return { ...l, rot: Math.round(deg) };
}

export type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';
export function alignLayers(scene: Scene, ids: readonly string[], mode: AlignMode): Scene {
  const u = unionBox(scene.layers.filter((l) => ids.includes(l.id)));
  if (!u) return scene;
  return {
    ...scene,
    layers: scene.layers.map((l) => {
      if (!ids.includes(l.id) || l.locked) return l;
      const b = boxOf(l);
      if (mode === 'left') return { ...l, x: u.x };
      if (mode === 'right') return { ...l, x: u.x + u.w - b.w };
      if (mode === 'hcenter') return { ...l, x: u.x + (u.w - b.w) / 2 };
      if (mode === 'top') return { ...l, y: u.y };
      if (mode === 'bottom') return { ...l, y: u.y + u.h - b.h };
      return { ...l, y: u.y + (u.h - b.h) / 2 };
    }),
  };
}

export function distributeLayers(scene: Scene, ids: readonly string[], axis: 'h' | 'v'): Scene {
  const picked = scene.layers.filter((l) => ids.includes(l.id) && !l.locked).sort((a, b) => (axis === 'h' ? a.x - b.x : a.y - b.y));
  if (picked.length < 3) return scene;
  const first = boxOf(picked[0]), last = boxOf(picked[picked.length - 1]);
  const total = axis === 'h' ? last.x + last.w - first.x : last.y + last.h - first.y;
  const sizes = picked.map((l) => (axis === 'h' ? boxOf(l).w : boxOf(l).h));
  const gap = (total - sizes.reduce((a, b) => a + b, 0)) / (picked.length - 1);
  let at = axis === 'h' ? first.x : first.y;
  const place = new Map<string, number>();
  picked.forEach((l, i) => { place.set(l.id, at); at += sizes[i] + gap; });
  return { ...scene, layers: scene.layers.map((l) => (place.has(l.id) ? (axis === 'h' ? { ...l, x: place.get(l.id)! } : { ...l, y: place.get(l.id)! }) : l)) };
}

// ── camadas novas ────────────────────────────────────────────────────────────────────────────────────────────

export function nextId(scene: Scene): string {
  const used = new Set(scene.layers.map((l) => l.id));
  for (let i = scene.layers.length + 1; ; i += 1) if (!used.has(`n${i}`)) return `n${i}`;
}

export function newText(scene: Scene, o: { font: TextLayer['font']; color: Hex; x: number; y: number }): TextLayer {
  return { id: nextId(scene), type: 'text', name: 'Texto novo', text: 'Escreva aqui', x: o.x, y: o.y, w: 640, rot: 0, opacity: 1, locked: false, hidden: false, font: o.font, size: 64, bold: true, align: 'left', color: o.color, lineHeight: 1.12, letterSpacing: 0 };
}

export function newShape(scene: Scene, kind: ShapeLayer['kind'], o: { color: Hex; x: number; y: number }): ShapeLayer {
  const dims = kind === 'line' ? { w: 400, h: 6 } : kind === 'ellipse' ? { w: 300, h: 300 } : { w: 400, h: 240 };
  return { id: nextId(scene), type: 'shape', name: kind === 'rect' ? 'Retângulo' : kind === 'ellipse' ? 'Círculo' : 'Linha', kind, x: o.x, y: o.y, ...dims, rot: 0, opacity: 1, locked: false, hidden: false, fill: o.color, radius: kind === 'rect' ? 24 : 0 };
}

export function duplicateLayers(scene: Scene, ids: readonly string[]): { scene: Scene; ids: string[] } {
  let work = scene;
  const made: SceneLayer[] = [];
  for (const l of scene.layers.filter((x) => ids.includes(x.id))) {
    const id = nextId({ ...work, layers: [...work.layers, ...made] });
    made.push({ ...l, id, name: `${l.name} (cópia)`, x: l.x + 30, y: l.y + 30, locked: false });
    work = { ...work };
  }
  return { scene: { ...scene, layers: [...scene.layers, ...made] }, ids: made.map((l) => l.id) };
}

export function reorderLayer(scene: Scene, ids: readonly string[], to: 'front' | 'back'): Scene {
  const picked = scene.layers.filter((l) => ids.includes(l.id));
  const rest = scene.layers.filter((l) => !ids.includes(l.id));
  return { ...scene, layers: to === 'front' ? [...rest, ...picked] : [...picked, ...rest] };
}

export const updateLayer = (scene: Scene, id: string, patch: Partial<SceneLayer>): Scene => ({ ...scene, layers: scene.layers.map((l) => (l.id === id ? ({ ...l, ...patch } as SceneLayer) : l)) });

// Os avisos ao vivo: os mesmos do revisor do servidor (margem, tamanho mínimo, contraste, sobreposição). Confirmar só trava no que
// o servidor também trava; aqui a pessoa vê antes de enviar.
export function liveIssues(scene: Scene, height: number): Issue[] {
  return reviewLayout(sceneBoxes(scene), height, []);
}
