import { describe, it, expect } from 'vitest';
import { GROUPS, costByChannel, costByGroup, fmtBrl, fmtUsd, groupOf, percent, toRunCost, totalCost } from '../platform/src/lib/console-finance-model.ts';

const run = (step, channel, costUsd) => ({ step, channel, costUsd });
const POST = [run('directives', null, 0.0001), run('writer', 'instagram', 0.0024), run('adapt', 'linkedin', 0.001), run('adapt', 'twitter', 0.0007), run('critic', 'instagram', 0.0011), run('fix', 'instagram', 0.0006), run('visual', 'instagram', 0.0672), run('publish', 'twitter', 0.015)];

describe('custo por post no Console › Financeiro (SPEC 031, entrega 3)', () => {
  it('toda etapa do banco está em um grupo e nenhuma em dois', () => {
    const steps = GROUPS.flatMap((g) => g.steps);
    expect(new Set(steps).size).toBe(steps.length);
    for (const step of ['directives', 'strategist', 'writer', 'core', 'adapt', 'critic', 'fix', 'visual', 'art', 'render', 'publish']) expect(groupOf(step), step).not.toBeNull();
    expect(groupOf('etapa-nova')).toBeNull();
  });

  it('a soma dos grupos é a soma do post', () => {
    const by = costByGroup(POST);
    for (const [id, expected] of Object.entries({ core: 0.0025, networks: 0.0017, review: 0.0017, image: 0.0672, publish: 0.015 })) expect(by[id], id).toBeCloseTo(expected, 10);
    expect(Object.values(by).reduce((n, x) => n + x, 0)).toBeCloseTo(totalCost(POST), 10);
  });

  it('por rede, o que não é de uma rede fica em "shared"', () => {
    const by = costByChannel(POST);
    expect(by.shared).toBeCloseTo(0.0001, 10);
    expect(by.instagram).toBeCloseTo(0.0024 + 0.0011 + 0.0006 + 0.0672, 10);
    expect(by.linkedin).toBeCloseTo(0.001, 10);
    expect(by.twitter).toBeCloseTo(0.0007 + 0.015, 10);
    expect(Object.values(by).reduce((n, x) => n + x, 0)).toBeCloseTo(totalCost(POST), 10);
    expect(costByChannel([run('writer', 'tiktok', 1)]).shared).toBe(1);
  });

  it('lê a linha do banco: numeric como texto, nulo e lixo viram número', () => {
    expect(toRunCost({ step: 'writer', channel: 'instagram', cost_usd: '0.0024' })).toEqual({ step: 'writer', channel: 'instagram', costUsd: 0.0024 });
    expect(toRunCost({ step: 'fix', channel: null, cost_usd: null })).toEqual({ step: 'fix', channel: null, costUsd: 0 });
    expect(toRunCost({ step: 'fix', cost_usd: 'abc' }).costUsd).toBe(0);
  });

  it('formata dólar com 4 casas até 1 e 2 acima, e real com 2', () => {
    expect(fmtUsd(0.0295)).toBe('US$ 0,0295');
    expect(fmtUsd(1)).toBe('US$ 1,00');
    expect(fmtUsd(41.2)).toBe('US$ 41,20');
    expect(fmtBrl(0.1623)).toBe('R$ 0,16');
    expect(fmtBrl(1234.5)).toBe('R$ 1234,50');
    expect(percent(15, 30)).toBe(50);
    expect(percent(1, 0)).toBe(0);
  });
});
