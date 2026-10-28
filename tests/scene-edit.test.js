// As contas do editor do Studio (SPEC 027): encaixe, redimensionar, girar, alinhar, distribuir, camadas novas e avisos ao vivo.
import { describe, it, expect } from 'vitest';
import { alignLayers, boxOf, distributeLayers, duplicateLayers, liveIssues, moveLayers, newShape, newText, nextId, reorderLayer, resizeLayer, rotateLayer, snapMove } from '../platform/src/lib/design/scene-edit.ts';
import { layerHeight } from '../platform/src/lib/design/scene.ts';

const size = { width: 1080, height: 1350 };
const base = { rot: 0, opacity: 1, locked: false, hidden: false };
const text = (id, over = {}) => ({ id, type: 'text', name: id, text: 'Seu bolo está pronto', x: 64, y: 300, w: 600, font: 'Inter', size: 80, bold: true, align: 'left', color: '#FFFFFF', lineHeight: 1.1, letterSpacing: 0, ...base, ...over });
const rect = (id, over = {}) => ({ id, type: 'shape', name: id, kind: 'rect', x: 100, y: 800, w: 200, h: 100, fill: '#FF0000', radius: 0, ...base, ...over });
const logo = (id, over = {}) => ({ id, type: 'logo', name: id, variant: 'main', x: 64, y: 1000, w: 200, h: 100, ...base, ...over });
const scene = (...layers) => ({ v: 1, bg: '#7A1F4B', layers });

describe('encaixe ao mover', () => {
  it('encaixa o centro do elemento no centro do post e na margem', () => {
    const s = scene(rect('a', { x: 0, y: 0 }));
    // centro de a = 100; para chegar a 540 faltam 440; um arrasto de 436 encaixa em 440
    const r = snapMove(s, ['a'], 436, 0, size);
    expect(r.dx).toBe(440);
    expect(r.guides).toContainEqual({ axis: 'x', at: 540 });
    // longe de qualquer guia: nada muda
    expect(snapMove(s, ['a'], 300, 0, size)).toEqual({ dx: 300, dy: 0, guides: [] });
  });

  it('encaixa na borda de outro elemento e na margem de 64 px', () => {
    const s = scene(rect('a', { x: 0, y: 0 }), rect('b', { x: 500, y: 700, w: 100, h: 100 }));
    expect(snapMove(s, ['a'], 497, 0, size).guides.some((g) => g.axis === 'x' && g.at === 500)).toBe(true);
    expect(snapMove(s, ['a'], 66, 60, size)).toMatchObject({ dx: 64, dy: 64 });
  });

  it('mover não mexe em camada travada', () => {
    const s = scene(rect('a', { locked: true }), rect('b'));
    const m = moveLayers(s, ['a', 'b'], 10, 20);
    expect(m.layers[0]).toMatchObject({ x: 100, y: 800 });
    expect(m.layers[1]).toMatchObject({ x: 110, y: 820 });
  });
});

describe('redimensionar e girar', () => {
  it('texto: alça de canto muda a fonte na mesma proporção; lateral muda só a largura; as linhas guardadas saem', () => {
    const l = text('t', { lines: ['Seu bolo', 'está pronto'] });
    const corner = resizeLayer(l, 'se', 300, 0);
    expect(corner.size).toBe(Math.round(80 * (900 / 600)));
    expect(corner.lines).toBeUndefined();
    const side = resizeLayer(l, 'e', 100, 0);
    expect(side).toMatchObject({ w: 700, size: 80, lines: undefined });
  });

  it('alça noroeste de texto mantém o rodapé do bloco no lugar', () => {
    const l = text('t');
    const bottom = l.y + layerHeight(l);
    const r = resizeLayer(l, 'nw', -120, -120);
    expect(r.size).toBeGreaterThan(80);
    expect(Math.abs(r.y + layerHeight(r) - bottom)).toBeLessThan(2);
  });

  it('logo mantém a proporção e não passa de um mínimo', () => {
    const l = logo('l');
    const r = resizeLayer(l, 'se', 100, 10);
    expect(r.w / r.h).toBeCloseTo(2, 1);
    expect(resizeLayer(l, 'se', -500, -500).w).toBeGreaterThanOrEqual(24);
  });

  it('camada travada não muda; gira com encaixe de 45 graus', () => {
    expect(resizeLayer(rect('a', { locked: true }), 'se', 50, 50)).toMatchObject({ w: 200, h: 100 });
    const r = rect('a', { x: 0, y: 0, w: 100, h: 100 });
    expect(rotateLayer(r, { x: 50, y: -100 }).rot).toBe(0);
    expect(rotateLayer(r, { x: 250, y: 50 }).rot).toBe(90);
  });
});

describe('alinhar, distribuir e camadas', () => {
  it('alinha à esquerda e ao centro do conjunto', () => {
    const s = scene(rect('a', { x: 100, w: 100 }), rect('b', { x: 400, w: 200 }));
    expect(alignLayers(s, ['a', 'b'], 'left').layers.map((l) => l.x)).toEqual([100, 100]);
    expect(alignLayers(s, ['a', 'b'], 'hcenter').layers.map((l) => l.x)).toEqual([300, 250]);
    expect(alignLayers(s, ['a', 'b'], 'right').layers.map((l) => l.x + l.w)).toEqual([600, 600]);
  });

  it('distribui com o mesmo espaço; menos de 3 não faz nada', () => {
    const s = scene(rect('a', { x: 0, w: 100 }), rect('b', { x: 150, w: 100 }), rect('c', { x: 600, w: 100 }));
    const d = distributeLayers(s, ['a', 'b', 'c'], 'h');
    expect(d.layers.map((l) => l.x)).toEqual([0, 300, 600]);
    expect(distributeLayers(s, ['a', 'b'], 'h')).toBe(s);
  });

  it('camadas novas têm id único, duplicar desloca e leva para frente e para trás reordena', () => {
    const s = scene(text('t'), rect('a'));
    const id = nextId(s);
    expect(s.layers.some((l) => l.id === id)).toBe(false);
    expect(newText(s, { font: 'Inter', color: '#FFFFFF', x: 100, y: 100 })).toMatchObject({ type: 'text', size: 64 });
    expect(newShape(s, 'ellipse', { color: '#FFFFFF', x: 0, y: 0 })).toMatchObject({ kind: 'ellipse', w: 300 });
    const dup = duplicateLayers(s, ['a']);
    expect(dup.scene.layers).toHaveLength(3);
    expect(dup.scene.layers[2]).toMatchObject({ x: 130, y: 830, name: 'a (cópia)' });
    expect(new Set(dup.scene.layers.map((l) => l.id)).size).toBe(3);
    expect(reorderLayer(s, ['t'], 'front').layers.map((l) => l.id)).toEqual(['a', 't']);
    expect(reorderLayer(s, ['a'], 'back').layers.map((l) => l.id)).toEqual(['a', 't']);
    expect(boxOf(s.layers[1])).toEqual({ x: 100, y: 800, w: 200, h: 100 });
  });
});

describe('avisos ao vivo', () => {
  it('margem, tamanho mínimo e contraste, como o revisor do servidor', () => {
    const ok = scene(text('t', { role: 'title', bg: '#7A1F4B', x: 64, y: 300 }));
    expect(liveIssues(ok, 1350)).toEqual([]);
    expect(liveIssues(scene(text('t', { role: 'title', x: -10 })), 1350).some((i) => i.rule === 'safe_margin')).toBe(true);
    expect(liveIssues(scene(text('t', { role: 'title', size: 30 })), 1350).some((i) => i.rule === 'font_size')).toBe(true);
    expect(liveIssues(scene(text('t', { role: 'title', color: '#7A1F4B', bg: '#7A1F4B' })), 1350).some((i) => i.rule === 'contrast')).toBe(true);
  });
});
