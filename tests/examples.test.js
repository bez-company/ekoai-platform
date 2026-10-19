import { describe, it, expect } from 'vitest';
import { pickAutoExamples } from '../src/utils/examples.js';

const NOW = Date.parse('2026-10-19T12:00:00Z');
const post = (n, score, extra = {}) => ({
  pillar: 'dor', angle: 'a', chosen_variation: 1, channels: { instagram: { id: String(n) } },
  post: { hook: `h${n}`, body: `corpo ${n}` }, engagement_score: score,
  published_at: `2026-10-${String(10 + n).padStart(2, '0')}T10:00:00Z`, ...extra,
});

describe('exemplos automáticos de few-shot', () => {
  it('topo vira referência e fundo vira anti-exemplo, no formato dos arquivos curados', () => {
    const list = [1, 2, 3, 4, 5, 6, 7].map((n) => post(n, n * 10));
    const { high, low } = pickAutoExamples(list, { now: NOW });
    expect(high.map((e) => e.score)).toEqual([70, 60, 50]);
    expect(low.map((e) => e.score)).toEqual([30, 20, 10]);
    expect(high[0].name).toBe('auto-2026-10-17-instagram-dor-1.md');
    expect(high[0].content).toMatch(/Engajamento: 70 \(coletado automaticamente\)/);
    expect(high[0].content).toContain('corpo 7');
  });

  it('com menos de 4 posts não escolhe nada', () => {
    expect(pickAutoExamples([1, 2, 3].map((n) => post(n, n)), { now: NOW })).toEqual({ high: [], low: [] });
  });

  it('ignora post sem texto, sem nota e fora da janela', () => {
    const list = [
      post(1, 10), post(2, 20), post(3, 30), post(4, 40),
      post(5, 99, { post: { hook: 'x', body: '' } }),
      post(6, undefined),
      post(7, 99, { published_at: '2026-08-01T00:00:00Z' }),
    ];
    const { high, low } = pickAutoExamples(list, { now: NOW, windowDays: 30 });
    expect([...high, ...low].map((e) => e.score).sort((a, b) => a - b)).toEqual([10, 20, 30, 40]);
  });

  it('não repete o mesmo post em referência e anti-exemplo', () => {
    const { high, low } = pickAutoExamples([1, 2, 3, 4].map((n) => post(n, n)), { now: NOW });
    const names = new Set(high.map((e) => e.name));
    expect(low.filter((e) => names.has(e.name))).toEqual([]);
    expect(high.length + low.length).toBe(4);
  });
});
