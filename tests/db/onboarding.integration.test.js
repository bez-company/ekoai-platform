// Passos pulados do checklist de Início contra o Postgres (SPEC 011 R6, migration 0021).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { resetTenantData } from './helpers.js';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL ausente');
process.env.DATABASE_URL = url;

const admin = new pg.Pool({ connectionString: url, max: 2 });
const accounts = await import('../../platform/src/lib/accounts.ts');

const A = 'it-onb-a';
const B = 'it-onb-b';

async function cleanup() {
  await resetTenantData(admin, [A, B]);
}

beforeAll(async () => {
  await cleanup();
  await admin.query('insert into tenants (id, name) values ($1, $2), ($3, $4)', [A, 'It Onb A', B, 'It Onb B']);
});
afterAll(async () => {
  await cleanup();
  await admin.end();
});

describe('passos pulados', () => {
  it('conta nova não pulou nada', async () => {
    expect(await accounts.onboardingSkipped(A)).toEqual([]);
  });

  it('pular grava uma vez só; pular de novo não duplica', async () => {
    await accounts.setOnboardingSkip(A, 'team', true);
    await accounts.setOnboardingSkip(A, 'team', true);
    expect(await accounts.onboardingSkipped(A)).toEqual(['team']);
  });

  it('voltar a mostrar tira o passo da lista', async () => {
    await accounts.setOnboardingSkip(A, 'team', false);
    expect(await accounts.onboardingSkipped(A)).toEqual([]);
  });

  it('cada conta tem a sua lista', async () => {
    await accounts.setOnboardingSkip(A, 'team', true);
    expect(await accounts.onboardingSkipped(B)).toEqual([]);
  });

  it('o banco só aceita o passo "team"', async () => {
    const err = await admin.query("update tenants set onboarding_skipped = array['profile'] where id = $1", [A]).then(() => null, (e) => e);
    expect(err?.code).toBe('23514');
  });
});
