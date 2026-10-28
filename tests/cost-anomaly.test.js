import { describe, it, expect } from 'vitest';
import { detectCostAnomalies, median, MIN_BASELINE_POSTS } from '../platform/src/lib/cost-anomaly.ts';

const now = Date.parse('2026-10-28T12:00:00Z');
const hoursAgo = (h) => new Date(now - h * 3_600_000).toISOString();
const post = (id, costUsd, h) => ({ briefId: id, tenantId: 't1', costUsd, approvedAt: hoursAgo(h) });
const baseline = (n, cost = 0.1) => Array.from({ length: n }, (_, i) => post(`b${i}`, cost, 10 + i));

describe('alerta de custo por post aprovado (BEZ-410)', () => {
  it('mediana de lista par, ímpar e vazia', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
  });

  it('post recente acima de 2x a mediana alerta; exatamente 2x não', () => {
    const r = detectCostAnomalies([...baseline(MIN_BASELINE_POSTS), post('caro', 0.25, 1), post('limite', 0.2, 2), post('normal', 0.1, 3)], now);
    expect(r.median).toBeCloseTo(0.1);
    expect(r.anomalies.map((a) => a.briefId)).toEqual(['caro']);
  });

  it('sem amostra mínima não alerta, mesmo com custo absurdo', () => {
    const r = detectCostAnomalies([...baseline(MIN_BASELINE_POSTS - 1), post('caro', 5, 1)], now);
    expect(r.anomalies).toEqual([]);
    expect(r.baselineSize).toBe(MIN_BASELINE_POSTS - 1);
  });

  it('o post recente não entra na própria mediana', () => {
    const r = detectCostAnomalies([...baseline(MIN_BASELINE_POSTS), ...Array.from({ length: 30 }, (_, i) => post(`r${i}`, 9, 0.5))], now);
    expect(r.median).toBeCloseTo(0.1);
    expect(r.anomalies).toHaveLength(30);
  });

  it('fora da janela de 30 dias é ignorado; mediana zero não gera alerta', () => {
    const old = Array.from({ length: 20 }, (_, i) => post(`o${i}`, 0.1, 24 * 31 + i));
    expect(detectCostAnomalies([...old, post('caro', 5, 1)], now).anomalies).toEqual([]);
    expect(detectCostAnomalies([...baseline(MIN_BASELINE_POSTS, 0), post('x', 1, 1)], now).anomalies).toEqual([]);
  });

  it('ignora linha com data ou custo inválidos', () => {
    const r = detectCostAnomalies([...baseline(MIN_BASELINE_POSTS), { briefId: 'x', tenantId: 't', costUsd: Number.NaN, approvedAt: hoursAgo(1) }, { briefId: 'y', tenantId: 't', costUsd: 9, approvedAt: 'nope' }], now);
    expect(r.anomalies).toEqual([]);
    expect(r.recentSize).toBe(0);
  });
});
