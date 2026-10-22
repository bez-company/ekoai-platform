import { describe, it, expect } from 'vitest';
import { cropBox as serverCrop } from '../platform/src/lib/design/photo.ts';
import { cropBox, objectPositionFor, countsOf, filterAssets, precheckFile, parseHashtagInput, blockedReason, usedLabel, whenLabel } from '../platform/src/lib/media-view.ts';

describe('prévia do corte', () => {
  const sizes = [{ width: 1200, height: 1500 }, { width: 2000, height: 1050 }, { width: 1080, height: 1080 }, { width: 900, height: 2000 }];
  const focuses = [{ x: 0.5, y: 0.5 }, { x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0.2, y: 0.8 }];
  it('o recorte da tela é o mesmo que o servidor publica', () => {
    for (const size of sizes) for (const ratio of ['4:5', '1:1', '1.91:1']) for (const f of focuses) {
      const a = cropBox(size, ratio, f);
      const b = serverCrop(size, ratio, f);
      for (const k of ['x', 'y', 'w', 'h']) expect(a[k], `${size.width}x${size.height} ${ratio} ${f.x},${f.y} ${k}`).toBeCloseTo(b[k], 6);
    }
  });

  it('object-position leva o object-cover ao recorte', () => {
    expect(objectPositionFor({ width: 2000, height: 1000 }, { x: 0, y: 0, w: 1000, h: 1000 })).toBe('0.00% 50.00%');
    expect(objectPositionFor({ width: 2000, height: 1000 }, { x: 1000, y: 0, w: 1000, h: 1000 })).toBe('100.00% 50.00%');
    expect(objectPositionFor({ width: 1000, height: 2000 }, { x: 0, y: 500, w: 1000, h: 1000 })).toBe('50.00% 50.00%');
  });
});

describe('banco de imagens na tela', () => {
  const list = [{ usedAt: null }, { usedAt: '2026-10-14T12:00:00Z' }, { usedAt: null }];
  it('contagens e filtros', () => {
    expect(countsOf(list)).toEqual({ all: 3, unused: 2, used: 1 });
    expect(filterAssets(list, 'used')).toHaveLength(1);
    expect(filterAssets(list, 'unused')).toHaveLength(2);
    expect(filterAssets(list, 'all')).toHaveLength(3);
  });

  it('antes de enviar: tipo, tamanho e vazio', () => {
    expect(precheckFile({ name: 'a.gif', size: 10, type: 'image/gif' })).toMatch(/JPEG ou PNG/);
    expect(precheckFile({ name: 'a.jpg', size: 11 * 1024 * 1024, type: 'image/jpeg' })).toMatch(/10 MB/);
    expect(precheckFile({ name: 'a.png', size: 0, type: 'image/png' })).toMatch(/vazio/);
    expect(precheckFile({ name: 'a.png', size: 100, type: '' })).toBeNull();
  });

  it('hashtags, autorização, rótulos', () => {
    expect(parseHashtagInput('#Bolo, #bolo  marilia')).toEqual(['bolo', 'marilia']);
    expect(blockedReason({ hasPeople: true, peopleConsent: false })).toMatch(/autorização/);
    expect(blockedReason({ hasPeople: true, peopleConsent: true })).toBeNull();
    expect(usedLabel(null)).toBe('Não usada');
    expect(usedLabel('2026-10-14T15:00:00Z')).toBe('Usada em 14/10');
    expect(whenLabel(null)).toMatch(/fila/);
  });
});
