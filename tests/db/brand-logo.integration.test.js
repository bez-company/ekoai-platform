// Logo da empresa contra o Postgres (SPEC 011 R3, ADR 0014): troca, remoção, ordem das escritas,
// isolamento entre contas e auditoria. O bucket é um armazenamento de memória.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { resetTenantData } from './helpers.js';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL ausente');
process.env.DATABASE_URL = url;

const admin = new pg.Pool({ connectionString: url, max: 2 });
const { tenantDb } = await import('../../platform/src/lib/tenant-db.ts');
const logos = await import('../../platform/src/lib/brand-logo.ts');
const profile = await import('../../platform/src/lib/company-profile.ts');
const model = await import('../../platform/src/lib/logo-model.ts');
const { UserError } = await import('../../platform/src/lib/errors.ts');

const A = 'it-logo-a';
const B = 'it-logo-b';
const ANA = { id: '00000000-0000-4000-8000-000000000401', name: 'Ana', sessionVersion: 1, lastTenantId: null };
const ta = tenantDb(A);
const tb = tenantDb(B);
const one = async (sql, params) => (await admin.query(sql, params)).rows[0];

const objects = new Map();
const store = {
  put: async (key, bytes, type) => void objects.set(key, { bytes, type }),
  get: async (key) => {
    const o = objects.get(key);
    if (!o) throw new Error('sem objeto');
    return o.bytes;
  },
  remove: async (key) => void objects.delete(key),
};

const be32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const chunk = (type, data = []) => [...be32(data.length), ...[...type].map((c) => c.charCodeAt(0)), ...data, 0, 0, 0, 0];
const png = (w) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...chunk('IHDR', [...be32(w), ...be32(8), 8, 6, 0, 0, 0]), ...chunk('IDAT', [1]), ...chunk('IEND')]);
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect fill="#B83262"/></svg>';
const inspected = (bytes) => {
  const r = model.inspectLogo(bytes);
  expect(r.ok, JSON.stringify(r)).toBe(true);
  return r;
};

async function cleanup() {
  await resetTenantData(admin, [A, B]);
}

beforeAll(async () => {
  await cleanup();
  await admin.query('insert into users (id, email, name) values ($1, $2, $3)', [ANA.id, 'it-ana-logo@example.test', 'Ana']);
  await admin.query('insert into tenants (id, name) values ($1, $2), ($3, $4)', [A, 'It Logo A', B, 'It Logo B']);
});
afterAll(async () => {
  await cleanup();
  await admin.end();
});

describe('logo da empresa', () => {
  it('sem perfil ainda, não aceita o logo e nada vai para o bucket', async () => {
    const err = await logos.saveLogo(ta, ANA, inspected(png(16)), store).then(() => null, (e) => e);
    expect(err).toBeInstanceOf(UserError);
    expect(err.message).toMatch(/Sobre o negócio/);
    expect(objects.size).toBe(0);
    expect(await logos.readLogo(ta, store)).toBeNull();
  });

  it('com perfil, guarda no bucket debaixo da pasta da conta e aponta o perfil para ele', async () => {
    await profile.saveSection(ta, ANA, { ok: true, section: 'about', values: { niche: 'Alimentação', offering: 'Bolos', audience: 'Famílias', region: null, site_url: null, instagram_handle: null } });
    const { assetId } = await logos.saveLogo(ta, ANA, inspected(png(16)), store);
    const asset = await one('select storage_path, content_type, byte_size, created_by from brand_assets where id = $1', [assetId]);
    expect(asset).toMatchObject({ content_type: 'image/png', created_by: ANA.id });
    expect(asset.storage_path).toBe(`tenants/${A}/logo/${assetId}.png`);
    expect(objects.has(asset.storage_path)).toBe(true);
    expect((await one('select logo_asset_id from company_profiles where tenant_id = $1', [A])).logo_asset_id).toBe(assetId);
    const read = await logos.readLogo(ta, store);
    expect(read).toMatchObject({ contentType: 'image/png', assetId });
    expect(read.bytes.length).toBe(asset.byte_size);
  });

  it('trocar tira o logo antigo do banco e do bucket', async () => {
    const before = await one('select logo_asset_id as id from company_profiles where tenant_id = $1', [A]);
    const oldPath = (await one('select storage_path from brand_assets where id = $1', [before.id])).storage_path;
    const { assetId } = await logos.saveLogo(ta, ANA, inspected(new TextEncoder().encode(SVG)), store);
    expect(assetId).not.toBe(before.id);
    expect(await one('select count(*)::int as n from brand_assets where tenant_id = $1', [A])).toEqual({ n: 1 });
    expect(objects.has(oldPath)).toBe(false);
    expect((await logos.readLogo(ta, store)).contentType).toBe('image/svg+xml');
    expect([...objects.keys()].filter((k) => k.startsWith(`tenants/${A}/`))).toEqual([`tenants/${A}/logo/${assetId}.svg`]);
  });

  it('se o banco falha depois do upload, o arquivo novo não fica órfão e o logo antigo segue', async () => {
    const before = await logos.readLogo(ta, store);
    const failing = { ...store, put: async (k, b, t) => store.put(k, b, t) };
    // força falha na FK: apaga o perfil da conta só dentro desta tentativa não é possível; simula pelo tipo inválido
    const bad = { ...inspected(png(16)), contentType: 'image/gif' };
    await expect(logos.saveLogo(ta, ANA, bad, failing)).rejects.toThrow();
    expect([...objects.keys()].filter((k) => k.startsWith(`tenants/${A}/`)).length).toBe(1);
    expect((await logos.readLogo(ta, store)).assetId).toBe(before.assetId);
  });

  it('cada conta tem o seu logo e o seu bucket de caminho', async () => {
    expect(await logos.readLogo(tb, store)).toBeNull();
    await profile.saveSection(tb, ANA, { ok: true, section: 'about', values: { niche: 'Moda', offering: 'Roupas', audience: 'Mulheres', region: null, site_url: null, instagram_handle: null } });
    const { assetId } = await logos.saveLogo(tb, ANA, inspected(png(32)), store);
    expect((await logos.readLogo(tb, store)).assetId).toBe(assetId);
    expect((await logos.readLogo(ta, store)).assetId).not.toBe(assetId);
    expect([...objects.keys()].filter((k) => k.startsWith(`tenants/${B}/`)).length).toBe(1);
  });

  it('o banco recusa caminho fora da pasta da conta', async () => {
    const err = await admin.query("insert into brand_assets (tenant_id, kind, storage_path, content_type, byte_size) values ($1, 'logo', 'tenants/outra/logo/x.png', 'image/png', 10)", [A]).then(() => null, (e) => e);
    expect(err?.code).toBe('23514');
  });

  it('remover limpa o perfil, a linha e o arquivo, e é idempotente', async () => {
    await logos.removeLogo(ta, ANA, store);
    expect((await one('select logo_asset_id from company_profiles where tenant_id = $1', [A])).logo_asset_id).toBeNull();
    expect(await one('select count(*)::int as n from brand_assets where tenant_id = $1', [A])).toEqual({ n: 0 });
    expect([...objects.keys()].some((k) => k.startsWith(`tenants/${A}/`))).toBe(false);
    expect(await logos.readLogo(ta, store)).toBeNull();
    await logos.removeLogo(ta, ANA, store);
  });

  it('a auditoria diz o que mudou, sem o conteúdo', async () => {
    const rows = (await admin.query("select action, metadata from audit_events where tenant_id = $1 and action like 'profile.logo%' order by created_at", [A])).rows;
    expect(rows.map((r) => r.action)).toEqual(['profile.logo_changed', 'profile.logo_changed', 'profile.logo_removed']);
    expect(rows[0].metadata).toMatchObject({ type: 'image/png' });
    expect(JSON.stringify(rows)).not.toContain('<svg');
  });
});
