// Contador do limite de taxa contra o Postgres (BEZ-29, migration 0035): soma por janela, recusa acima do
// teto, separa baldes e chaves, guarda só o hash e aguenta chamadas ao mesmo tempo.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL ausente');
process.env.DATABASE_URL = url;

const admin = new pg.Pool({ connectionString: url, max: 2 });
const { hit } = await import('../../platform/src/lib/rate-limit.ts');

const RULE = { bucket: 'it.test', windowS: 3600, limit: 3 };
const OTHER = { bucket: 'it.other', windowS: 3600, limit: 3 };

beforeAll(async () => {
  await admin.query("delete from rate_limit_hits where bucket like 'it.%'");
});
afterAll(async () => {
  await admin.query("delete from rate_limit_hits where bucket like 'it.%'");
  await admin.end();
});

describe('contador', () => {
  it('até o teto passa; acima, recusa e diz em quantos segundos a janela vira', async () => {
    const results = [];
    for (let i = 0; i < 4; i += 1) results.push(await hit(RULE, '203.0.113.7'));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results[3].hits).toBe(4);
    expect(results[3].retryAfterS).toBeGreaterThan(0);
    expect(results[3].retryAfterS).toBeLessThanOrEqual(3600);
  });

  it('outra chave e outro balde contam à parte; e-mail é igual em maiúscula e minúscula', async () => {
    expect((await hit(RULE, '198.51.100.1')).allowed).toBe(true);
    expect((await hit(OTHER, '203.0.113.7')).allowed).toBe(true);
    await hit(RULE, 'Ana@Exemplo.test');
    expect((await hit(RULE, 'ana@exemplo.test')).hits).toBe(2);
  });

  it('o banco guarda só o hash da chave', async () => {
    const { rows } = await admin.query("select key_hash from rate_limit_hits where bucket = 'it.test'");
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.key_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(r.key_hash).not.toContain('203');
    }
  });

  it('10 chamadas ao mesmo tempo somam 10, sem perder nenhuma', async () => {
    const rule = { bucket: 'it.race', windowS: 3600, limit: 5 };
    const results = await Promise.all(Array.from({ length: 10 }, () => hit(rule, 'mesma-chave')));
    expect(results.filter((r) => r.allowed)).toHaveLength(5);
    expect(Math.max(...results.map((r) => r.hits))).toBe(10);
  });

  it('o banco recusa janela ou teto inválidos', async () => {
    const err = await admin.query("select * from app.rate_limit_hit('it.test', $1, 0, 3)", ['a'.repeat(64)]).then(() => null, (e) => e);
    expect(err?.code).toBe('23514');
  });
});
