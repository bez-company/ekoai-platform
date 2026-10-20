// Perfil da empresa contra o Postgres (SPEC 011 R3): criar pela seção Sobre, atualizar as outras,
// isolamento entre contas, limites do banco e a auditoria sem conteúdo.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { resetTenantData } from './helpers.js';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL ausente');
process.env.DATABASE_URL = url;

const admin = new pg.Pool({ connectionString: url, max: 2 });
const { tenantDb } = await import('../../platform/src/lib/tenant-db.ts');
const profile = await import('../../platform/src/lib/company-profile.ts');
const model = await import('../../platform/src/lib/company-profile-model.ts');
const { UserError } = await import('../../platform/src/lib/errors.ts');

const A = 'it-prof-a';
const B = 'it-prof-b';
const ANA = { id: '00000000-0000-4000-8000-000000000301', name: 'Ana', sessionVersion: 1, lastTenantId: null };
const ta = tenantDb(A);
const tb = tenantDb(B);
const one = async (sql, params) => (await admin.query(sql, params)).rows[0];
const parse = (body) => {
  const r = model.parseProfileSection(body);
  expect(r.ok, JSON.stringify(r)).toBe(true);
  return r;
};
const ABOUT = { section: 'about', niche: 'Alimentação', offering: 'Bolos sob encomenda.', audience: 'Famílias de Marília.', region: 'Marília, SP', site_url: 'doceponto.com.br', instagram_handle: '@doceponto' };

async function cleanup() {
  await resetTenantData(admin, [A, B]);
}

beforeAll(async () => {
  await cleanup();
  await admin.query('insert into users (id, email, name) values ($1, $2, $3)', [ANA.id, 'it-ana-prof@example.test', 'Ana']);
  await admin.query('insert into tenants (id, name) values ($1, $2), ($3, $4)', [A, 'It Prof A', B, 'It Prof B']);
});
afterAll(async () => {
  await cleanup();
  await admin.end();
});

describe('perfil da empresa', () => {
  it('sem perfil ainda: null; seção opcional antes da Sobre pede a Sobre primeiro', async () => {
    expect(await profile.getProfile(ta)).toBeNull();
    const err = await profile.saveSection(ta, ANA, parse({ section: 'voice', voice_formal: 4 })).then(() => null, (e) => e);
    expect(err).toBeInstanceOf(UserError);
    expect(err.message).toMatch(/Sobre o negócio/);
    expect(await profile.getProfile(ta)).toBeNull();
  });

  it('Sobre o negócio cria o perfil, normalizado, com quem gravou', async () => {
    await profile.saveSection(ta, ANA, parse(ABOUT));
    expect(await profile.getProfile(ta)).toMatchObject({
      niche: 'Alimentação', offering: 'Bolos sob encomenda.', region: 'Marília, SP',
      siteUrl: 'https://doceponto.com.br', instagramHandle: 'doceponto', differentiators: [], bannedWords: [],
    });
    expect((await one('select updated_by from company_profiles where tenant_id = $1', [A])).updated_by).toBe(ANA.id);
  });

  it('gravar a Sobre de novo atualiza a mesma linha, sem duplicar', async () => {
    await profile.saveSection(ta, ANA, parse({ ...ABOUT, region: 'Bauru, SP' }));
    expect((await profile.getProfile(ta)).region).toBe('Bauru, SP');
    expect((await one('select count(*)::int as n from company_profiles where tenant_id = $1', [A])).n).toBe(1);
  });

  it('Jeito de falar e Visual atualizam só os campos da seção', async () => {
    await profile.saveSection(ta, ANA, parse({ section: 'voice', voice_formal: 4, voice_technical: 4, voice_serious: 3, banned_words: ['Imperdível'], differentiators: ['Sem conservantes'], pains: ['Esquece de encomendar'] }));
    await profile.saveSection(ta, ANA, parse({ section: 'visual', color_primary: '#b83262', font_heading: 'Playfair Display', cta_default: 'whatsapp', posts_per_week: 3 }));
    expect(await profile.getProfile(ta)).toMatchObject({
      niche: 'Alimentação', region: 'Bauru, SP',
      voiceFormal: 4, voiceSerious: 3, bannedWords: ['imperdível'], differentiators: ['Sem conservantes'], pains: ['Esquece de encomendar'],
      colorPrimary: '#B83262', fontHeading: 'Playfair Display', ctaDefault: 'whatsapp', postsPerWeek: 3, colorAccent: null,
    });
  });

  it('a seção troca os campos dela por inteiro: o que foi tirado da tela some', async () => {
    await profile.saveSection(ta, ANA, parse({ section: 'voice', voice_formal: 2 }));
    expect(await profile.getProfile(ta)).toMatchObject({ voiceFormal: 2, voiceTechnical: null, bannedWords: [], differentiators: [], pains: [] });
    expect((await profile.getProfile(ta)).colorPrimary).toBe('#B83262');
  });

  it('cada conta vê só o seu perfil', async () => {
    expect(await profile.getProfile(tb)).toBeNull();
    await profile.saveSection(tb, ANA, parse({ ...ABOUT, niche: 'Moda', offering: 'Roupas' }));
    expect((await profile.getProfile(tb)).niche).toBe('Moda');
    expect((await profile.getProfile(ta)).niche).toBe('Alimentação');
    await profile.saveSection(tb, ANA, parse({ section: 'visual', cta_default: 'dm' }));
    expect((await profile.getProfile(ta)).ctaDefault).toBe('whatsapp');
  });

  it('a auditoria diz qual seção mudou, sem o conteúdo', async () => {
    const rows = (await admin.query("select metadata, target_type, actor_user_id from audit_events where tenant_id = $1 and action = 'profile.updated' order by created_at", [A])).rows;
    expect(rows.map((r) => r.metadata.section)).toEqual(['about', 'about', 'voice', 'visual', 'voice']);
    expect(rows[0]).toMatchObject({ target_type: 'company_profile', actor_user_id: ANA.id });
    expect(JSON.stringify(rows)).not.toContain('Bolos');
  });

  it('o banco também recusa o que o parser deixaria passar (última barreira)', async () => {
    const bad = (values) => ta.update('company_profiles', values).select('tenant_id').maybeSingle();
    expect((await bad({ color_primary: 'azul' })).error).toBeTruthy();
    expect((await bad({ voice_formal: 9 })).error).toBeTruthy();
    expect((await bad({ cta_default: 'email' })).error).toBeTruthy();
    expect((await bad({ differentiators: ['a', 'b', 'c', 'd', 'e', 'f'] })).error).toBeTruthy();
  });
});
