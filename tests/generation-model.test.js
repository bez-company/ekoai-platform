import { describe, it, expect } from 'vitest';
import { canonical, inputHash, isPlanPostsLimit, monthStart, usageOf, runFromRow, isPostKind, LIMIT_MESSAGE } from '../platform/src/lib/generation-model.ts';

describe('chave de idempotência da geração (SPEC 012 R5.1)', () => {
  it('a mesma entrada dá o mesmo hash, em qualquer ordem de chaves', () => {
    const a = inputHash('writer', 'gemini-2.5-flash', { tema: 'bolo', fatos: ['a', 'b'], voz: { formal: 2, serio: 3 } });
    const b = inputHash('writer', 'gemini-2.5-flash', { voz: { serio: 3, formal: 2 }, fatos: ['a', 'b'], tema: 'bolo' });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('entrada, etapa ou modelo diferentes dão hash diferente ("outra direção" é chamada nova)', () => {
    const base = inputHash('visual', 'img-1', { prompt: 'bancada com farinha' });
    expect(inputHash('visual', 'img-1', { prompt: 'bancada com farinha', direction: 2 })).not.toBe(base);
    expect(inputHash('visual', 'img-2', { prompt: 'bancada com farinha' })).not.toBe(base);
    expect(inputHash('art', 'img-1', { prompt: 'bancada com farinha' })).not.toBe(base);
  });

  it('canonical ignora undefined, mantém null e a ordem das listas', () => {
    expect(canonical({ b: 1, a: undefined, c: null })).toBe('{"b":1,"c":null}');
    expect(canonical([2, 1])).toBe('[2,1]');
    expect(canonical('x')).toBe('"x"');
  });
});

describe('limite mensal', () => {
  it('reconhece o erro do gatilho pelo hint', () => {
    expect(isPlanPostsLimit({ code: '23514', hint: 'plan_posts' })).toBe(true);
    expect(isPlanPostsLimit({ code: '23514', hint: 'plan_seats' })).toBe(false);
    expect(isPlanPostsLimit(null)).toBe(false);
  });

  it('o mês começa no dia 1º em UTC', () => {
    expect(monthStart(new Date('2026-10-21T23:30:00-03:00'))).toBe('2026-10-01T00:00:00.000Z');
    expect(monthStart(new Date('2026-11-01T00:00:00Z'))).toBe('2026-11-01T00:00:00.000Z');
  });

  it('uso nunca fica negativo e a mensagem diz o máximo', () => {
    expect(usageOf(3, 20)).toEqual({ used: 3, max: 20, remaining: 17 });
    expect(usageOf(25, 20).remaining).toBe(0);
    expect(LIMIT_MESSAGE(20)).toContain('20 posts');
  });
});

describe('linha da chamada', () => {
  it('converte a linha do banco (datas e números)', () => {
    const run = runFromRow({ id: 'r1', brief_id: 'b1', step: 'visual', input_hash: 'a'.repeat(64), status: 'done', model: 'img', model_version: null, input_tokens: '12', output_tokens: null, images: 1, cost_usd: '0.0672', duration_ms: 1500, result: { key: 'images/x.png' }, error: null, created_at: new Date('2026-10-21T10:00:00Z'), finished_at: null });
    expect(run).toMatchObject({ id: 'r1', inputTokens: 12, outputTokens: null, images: 1, costUsd: 0.0672, createdAt: '2026-10-21T10:00:00.000Z', finishedAt: null });
  });

  it('tipo do post só aceita os dois da SPEC', () => {
    expect(isPostKind('informativo')).toBe(true);
    expect(isPostKind('carrossel')).toBe(false);
  });
});
