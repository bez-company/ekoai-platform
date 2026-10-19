import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tenantDb } from '../platform/src/lib/tenant-db.ts';
import { isTenantId } from '../platform/src/lib/tenant.ts';
import { createSessionToken, verifySessionToken } from '../platform/src/lib/auth.ts';

const SRC = join(import.meta.dirname, '../platform/src');

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(name) ? [p] : [];
  });
}

// Únicos lugares com acesso cru ao banco: a definição, o escopo por tenant e os usos de
// sistema que atravessam tenants de propósito (com quantas ocorrências cada um tem).
const RAW_DB_ALLOWED = {
  'lib/db.ts': Infinity,
  'lib/tenant-db.ts': Infinity,
  'lib/publish.ts': 1, // varredura dos vencidos de todos os tenants
  'lib/accounts.ts': Infinity, // login e sessão: uma pessoa atravessa contas (SPEC 009)
  'app/api/health/route.ts': 1, // ping do banco, sem dado de tenant
};

describe('escopo por tenant na plataforma', () => {
  it('nenhum módulo fala com o banco sem passar pelo tenantDb', () => {
    const offenders = [];
    for (const f of files(SRC)) {
      const rel = relative(SRC, f);
      const n = (readFileSync(f, 'utf8').match(/\bdb\(\)/g) || []).length;
      if (n > (RAW_DB_ALLOWED[rel] ?? 0)) offenders.push(`${rel} (${n}x)`);
    }
    expect(offenders).toEqual([]);
  });

  it('o env TENANT_ID não é lido fora do login de senha única', () => {
    const offenders = files(SRC)
      .map((f) => relative(SRC, f))
      .filter((rel) => rel !== 'lib/auth.ts' && readFileSync(join(SRC, rel), 'utf8').includes('TENANT_ID'));
    expect(offenders).toEqual([]);
  });
});

function fakeClient() {
  const calls = [];
  const builder = new Proxy(
    {},
    { get: (_, method) => (...args) => (calls.push([method, ...args]), builder) },
  );
  return { calls, client: { from: (table) => (calls.push(['from', table]), builder) } };
}

describe('tenantDb', () => {
  it('select, update e delete saem filtrados pelo tenant', () => {
    const { calls, client } = fakeClient();
    const t = tenantDb('acme', client);
    t.select('posts', 'id').eq('id', 'x');
    t.update('posts', { note: 'a' });
    t.delete('posts');
    const eqs = calls.filter(([m, col]) => m === 'eq' && col === 'tenant_id');
    expect(eqs).toEqual([['eq', 'tenant_id', 'acme'], ['eq', 'tenant_id', 'acme'], ['eq', 'tenant_id', 'acme']]);
  });

  it('insert e upsert carimbam o tenant, por cima do que vier', () => {
    const { calls, client } = fakeClient();
    const t = tenantDb('acme', client);
    t.insert('feedback', { note: 'x', tenant_id: 'pilar' });
    t.insert('feedback', [{ note: 'a' }, { note: 'b' }]);
    t.upsert('publishing_controls', { paused: true }, { onConflict: 'tenant_id' });
    expect(calls.find(([m]) => m === 'insert')[1]).toEqual({ note: 'x', tenant_id: 'acme' });
    expect(calls.filter(([m]) => m === 'insert')[1][1]).toEqual([
      { note: 'a', tenant_id: 'acme' },
      { note: 'b', tenant_id: 'acme' },
    ]);
    expect(calls.find(([m]) => m === 'upsert')[1]).toEqual({ paused: true, tenant_id: 'acme' });
  });

  it('update não troca o dono da linha', () => {
    const { calls, client } = fakeClient();
    tenantDb('acme', client).update('feedback', { note: 'x', tenant_id: 'pilar' });
    expect(calls.find(([m]) => m === 'update')[1]).toEqual({ note: 'x' });
  });

  it('recusa tenant fora do formato', () => {
    expect(() => tenantDb('Acme; drop', fakeClient().client)).toThrow(/tenant inválido/);
    expect(isTenantId('pilar')).toBe(true);
    expect(isTenantId('')).toBe(false);
  });
});

describe('sessão carrega o tenant', () => {
  beforeAll(() => {
    process.env.AUTH_SECRET = 'segredo-de-teste';
  });

  it('o token devolve o tenant que foi assinado', async () => {
    const token = await createSessionToken('acme');
    expect(await verifySessionToken(token)).toEqual({ tenantId: 'acme', userId: null, sessionVersion: null });
  });

  it('trocar o tenant no cookie invalida a sessão', async () => {
    const [, exp, sig] = (await createSessionToken('acme')).split('.');
    expect(await verifySessionToken(`pilar.${exp}.${sig}`)).toBeNull();
  });

  it('token antigo (sem tenant), vencido ou lixo não valida', async () => {
    const [, exp, sig] = (await createSessionToken('acme')).split('.');
    expect(await verifySessionToken(`${exp}.${sig}`)).toBeNull();
    expect(await verifySessionToken(`acme.${Date.now() - 1000}.${sig}`)).toBeNull();
    expect(await verifySessionToken('acme.abc.def')).toBeNull();
    expect(await verifySessionToken(undefined)).toBeNull();
  });
});
