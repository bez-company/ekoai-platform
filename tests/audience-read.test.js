// A leitura do público (BEZ-326): o que a Meta recusou em cada campo fica numa lista para o log, com o
// código e a mensagem cortada, sem nenhum dado de seguidor. Meta simulada.
import { describe, it, expect } from 'vitest';
import { readAudience } from '../platform/src/lib/audience.ts';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
const AGE = { data: [{ name: 'follower_demographics', total_value: { breakdowns: [{ dimension_keys: ['age'], results: [{ dimension_values: ['25-34'], value: 5 }] }] } }] };

const meta = (rules) => async (input) => {
  const u = new URL(input.toString());
  const metric = u.searchParams.get('metric');
  const key = metric ? `${metric}:${u.searchParams.get('breakdown') ?? ''}:${u.searchParams.get('timeframe') ?? ''}` : 'me';
  for (const [match, res] of rules) if (key.startsWith(match)) return typeof res === 'function' ? res() : res.clone();
  return json({ error: { code: 1, message: `sem regra para ${key}` } }, 400);
};

describe('o que a Meta recusou fica à vista', () => {
  it('leitura boa não deixa falha nenhuma', async () => {
    const fetchFn = meta([['me', json({ followers_count: 500 })], ['follower_demographics:age', json(AGE)], ['follower_demographics:gender', json({ data: [] })], ['online_followers', json({ data: [] })]]);
    const r = await readAudience(fetchFn, '1784', 'tok', true);
    expect(r.audience.status).toBe('ok');
    expect(r.failures).toEqual([]);
  });

  it('erro da Meta vira falha do campo, com código e mensagem cortada em 200 caracteres', async () => {
    const long = 'x'.repeat(500);
    const fetchFn = meta([
      ['me', json({ followers_count: 500 })],
      ['follower_demographics:age', json({ error: { code: 100, message: 'Invalid timeframe' } }, 400)],
      ['follower_demographics:gender', json(AGE)],
      ['online_followers', json({ error: { code: 100, message: long } }, 400)],
    ]);
    const r = await readAudience(fetchFn, '1784', 'tok', true);
    expect(r.failures.map((f) => [f.field, f.kind, f.code])).toEqual([['age', 'other', 100], ['online_followers', 'other', 100]]);
    expect(r.failures[0].message).toBe('Invalid timeframe');
    expect(r.failures[1].message).toHaveLength(200);
    expect(r.raw.age_error).toBe('other');
  });

  it('menos de 100 seguidores e permissão retirada aparecem como o tipo certo', async () => {
    const few = meta([['me', json({ followers_count: 500 })], ['follower_demographics', json({ error: { code: 100, message: '(#100) requires at least 100 followers' } }, 400)]]);
    const r = await readAudience(few, '1784', 'tok', true);
    expect(r.audience.status).toBe('too_few_followers');
    expect(r.failures.some((f) => f.kind === 'too_few_followers' && f.field === 'age')).toBe(true);

    const denied = meta([['me', json({ followers_count: 500 })], ['follower_demographics', json({ error: { code: 10, message: 'Permission denied' } }, 400)], ['online_followers', json({ error: { code: 10, message: 'Permission denied' } }, 400)]]);
    const d = await readAudience(denied, '1784', 'tok', true);
    expect(d.audience.status).toBe('no_permission');
    expect(d.failures.map((f) => f.kind)).toEqual(['permission', 'permission', 'permission']);
  });
});
