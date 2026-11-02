// Aplicar a leitura do site ao perfil contra o Postgres (SPEC 033, BEZ-525b): negócio, jeito de falar, fatos pendentes e logo, cada parte pelo
// parser de sempre. O bucket é de memória e o download da logo é um transporte simulado.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { resetTenantData } from './helpers.js';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL ausente');
process.env.DATABASE_URL = url;

const admin = new pg.Pool({ connectionString: url, max: 2 });
const { tenantDb } = await import('../../platform/src/lib/tenant-db.ts');
const { applySiteRead } = await import('../../platform/src/lib/site-read/apply.ts');
const { parseApplyBody } = await import('../../platform/src/lib/site-read/apply-model.ts');
const { getProfile } = await import('../../platform/src/lib/company-profile.ts');
const { UserError } = await import('../../platform/src/lib/errors.ts');

const A = 'it-sra-a';
const ANA = { id: '00000000-0000-4000-8000-000000000601', name: 'Ana', sessionVersion: 1, lastTenantId: null };
const ta = tenantDb(A);
const one = async (sql, params) => (await admin.query(sql, params)).rows[0];

const objects = new Map();
const store = { put: async (key, bytes, type) => void objects.set(key, { bytes, type }), get: async (key) => objects.get(key).bytes, remove: async (key) => void objects.delete(key) };

const be32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const chunk = (type, data = []) => [...be32(data.length), ...[...type].map((c) => c.charCodeAt(0)), ...data, 0, 0, 0, 0];
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...chunk('IHDR', [...be32(64), ...be32(32), 8, 6, 0, 0, 0]), ...chunk('IDAT', [1]), ...chunk('IEND')]);
const served = [];
const transport = async (u) => (served.push(u.toString()), u.pathname === '/logo.png' ? { status: 200, location: null, contentType: 'image/png', body: PNG } : { status: 404, location: null, contentType: 'text/plain', body: Buffer.alloc(0) });
const apply = (body) => applySiteRead(ta, ANA, parseApplyBody(body), { store, transport });

const FULL_ABOUT = { niche: 'Alimentação', offering: 'Bolos sob encomenda.', audience: 'Famílias de Marília.', region: 'Marília, SP' };
const FACT = { text: 'Bolo de pote por R$ 12,00', category: 'oferta_preco', source_note: 'https://doceponto.com.br/' };

beforeAll(async () => {
  await resetTenantData(admin, [A]);
  await admin.query('insert into users (id, email, name) values ($1, $2, $3)', [ANA.id, 'it-ana-sra@example.test', 'Ana']);
  await admin.query('insert into tenants (id, name) values ($1, $2)', [A, 'It SRA']);
});
afterAll(async () => {
  await resetTenantData(admin, [A]);
  await admin.end();
});

describe('aplicar a leitura do site', () => {
  it('sem perfil, o negócio incompleto é recusado com o que falta; completo, cria o perfil com o site', async () => {
    await expect(apply({ about: { offering: 'Só isto' } })).rejects.toThrow(/Escolha o nicho|Diga para quem/);
    await expect(apply({ voice: { formal: 2 } })).rejects.toThrow(/Preencha primeiro/);
    expect(await getProfile(ta)).toBeNull();
    const res = await apply({ site_url: 'doceponto.com.br', about: FULL_ABOUT });
    expect(res.applied.about).toBe(true);
    expect(await getProfile(ta)).toMatchObject({ niche: 'Alimentação', offering: 'Bolos sob encomenda.', region: 'Marília, SP', siteUrl: 'https://doceponto.com.br' });
  });

  it('jeito de falar: troca as escalas escolhidas, junta as listas sem repetir e respeita o teto de 5', async () => {
    const res = await apply({ voice: { formal: 2, technical: 1 }, differentiators: ['Sem conservantes', 'sem conservantes', 'Entrega no dia'], pains: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] });
    expect(res.applied).toMatchObject({ voice: true, differentiators: 2, pains: 5 });
    expect(res.skipped.join(' ')).toMatch(/aceita até 5 itens: 2 ficaram de fora/);
    expect(await getProfile(ta)).toMatchObject({ voiceFormal: 2, voiceTechnical: 1, voiceSerious: null, differentiators: ['Sem conservantes', 'Entrega no dia'], pains: ['a', 'b', 'c', 'd', 'e'] });
    const second = await apply({ differentiators: ['Entrega no dia', 'Feito à mão'] });
    expect((await getProfile(ta)).differentiators).toEqual(['Sem conservantes', 'Entrega no dia', 'Feito à mão']);
    expect(second.applied.differentiators).toBe(1); // "Entrega no dia" já estava na lista
  });

  it('fato entra PENDENTE e de agente, com a página de origem; aplicar de novo não duplica', async () => {
    const first = await apply({ facts: [FACT, { text: 'Entrega no mesmo dia em Marília', category: 'prazo_horario', source_note: 'https://doceponto.com.br/' }] });
    expect(first.applied.facts).toBe(2);
    const row = await one("select status, proposed_by, source, source_note, category, approved_by, valid_until is not null as has_expiry from company_facts where tenant_id = $1 and text = $2", [A, FACT.text]);
    expect(row).toMatchObject({ status: 'pending', proposed_by: 'agent', source: 'site', source_note: 'https://doceponto.com.br/', category: 'oferta_preco', approved_by: null, has_expiry: true });
    const again = await apply({ facts: [FACT] });
    expect(again.applied.facts).toBe(0);
    expect((await one('select count(*)::int as n from company_facts where tenant_id = $1', [A])).n).toBe(2);
  });

  it('fato com fonte que não é https ou categoria fora da lista é recusado sem derrubar o resto', async () => {
    const res = await apply({ facts: [{ text: 'Fato com fonte ruim', category: 'outro', source_note: 'http://doceponto.com.br/' }, { text: 'Fato bom', category: 'outro', source_note: 'https://doceponto.com.br/x' }] });
    expect(res.applied.facts).toBe(1);
    expect(res.skipped.join(' ')).toMatch(/https/);
  });

  it('logo do site: baixa pela leitura segura, confere pelos bytes e guarda como principal; com logo já cadastrada, não troca', async () => {
    const res = await apply({ logo_url: 'https://doceponto.com.br/logo.png' });
    expect(res.applied.logo).toBe(true);
    const asset = await one("select content_type, variant, storage_path from brand_assets where tenant_id = $1 and variant = 'main'", [A]);
    expect(asset).toMatchObject({ content_type: 'image/png', variant: 'main' });
    expect((await getProfile(ta)).logoAssetId).toBeTruthy();
    const before = (await getProfile(ta)).logoAssetId;
    const again = await apply({ logo_url: 'https://doceponto.com.br/logo.png' });
    expect(again.applied.logo).toBe(false);
    expect(again.skipped.join(' ')).toMatch(/já tem uma logo principal/);
    expect((await getProfile(ta)).logoAssetId).toBe(before);
  });

  it('endereço de logo interno, http ou que não é imagem não entra e não derruba o resto', async () => {
    await admin.query('update company_profiles set logo_asset_id = null where tenant_id = $1', [A]);
    await admin.query('delete from brand_assets where tenant_id = $1', [A]);
    served.length = 0;
    for (const bad of ['https://169.254.169.254/logo.png', 'http://doceponto.com.br/logo.png', 'https://localhost/logo.png']) {
      const res = await apply({ logo_url: bad, differentiators: ['Mais um'] });
      expect(res.applied.logo, bad).toBe(false);
      expect(res.skipped.join(' '), bad).toMatch(/logo:/);
    }
    expect(served).toEqual([]);
    const notImage = await apply({ logo_url: 'https://doceponto.com.br/nao-existe.png' });
    expect(notImage.skipped.join(' ')).toMatch(/logo: o site não entregou o arquivo/);
  });

  it('corpo sem nada escolhido é recusado', async () => {
    await expect(apply({})).rejects.toBeInstanceOf(UserError);
  });
});
