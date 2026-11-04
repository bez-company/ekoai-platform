// Regras com escopo e versão contra o Postgres (SPEC 037, BEZ-547): toda mudança guarda uma versão, restaurar volta o texto
// e o escopo sem apagar nada, e a geração só recebe a regra de campanha enquanto ela está em vigor.
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import pg from 'pg';
import { resetTenantData } from './helpers.js';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL ausente');
process.env.DATABASE_URL = url;

const admin = new pg.Pool({ connectionString: url, max: 2 });
const { tenantDb } = await import('../../platform/src/lib/tenant-db.ts');
const fb = await import('../../platform/src/lib/feedback.ts');

const A = 'it-rules-a';
const B = 'it-rules-b';
const t = tenantDb(A);
const ANA = '0b5a6c1e-2b4a-4c5d-8e9f-0a1b2c3d4e02';
const input = (rule, campaign_id = null) => ({ rule, aspect: 'tom', channel: null, campaign_id });

async function campaign(tenant, status = 'active', endDate = null) {
  const { rows } = await admin.query("insert into campaigns (tenant_id, slug, name, status, confirmed_at, end_date) values ($1, $2, 'Fim de ano', $3, now(), $4) returning id", [tenant, `c-${Math.random().toString(36).slice(2, 8)}`, status, endDate]);
  return rows[0].id;
}
const versions = async (id) => (await admin.query('select version, rule, campaign_id, active, change, changed_by from style_rule_versions where rule_id = $1 order by version', [id])).rows;

beforeAll(async () => {
  await resetTenantData(admin, [A, B]);
  await admin.query('insert into tenants (id, name) values ($1, $1), ($2, $2)', [A, B]);
  await admin.query("insert into users (id, email, name) values ($1, 'it-rules-ana@example.test', 'Ana Ribeiro') on conflict (id) do nothing", [ANA]);
});
beforeEach(async () => {
  for (const tb of ['style_rule_versions', 'style_rules', 'campaigns']) await admin.query(`delete from ${tb} where tenant_id = any($1)`, [[A, B]]);
});
afterAll(async () => {
  await resetTenantData(admin, [A, B]);
  await admin.query('delete from users where id = $1', [ANA]);
  await admin.end();
});

describe('versões', () => {
  it('criar, editar, desligar e restaurar guardam uma versão cada; restaurar volta o texto e o escopo', async () => {
    const c = await campaign(A);
    const id = await fb.createRule(t, input('Chamar pelo direct'), ANA);
    await fb.updateRule(t, id, { input: input('Fechar com CTA para o WhatsApp', c) }, ANA);
    await fb.updateRule(t, id, { active: false }, ANA);
    await fb.restoreRuleVersion(t, id, 1, ANA);
    expect(await versions(id)).toEqual([
      { version: 1, rule: 'Chamar pelo direct', campaign_id: null, active: true, change: 'created', changed_by: ANA },
      { version: 2, rule: 'Fechar com CTA para o WhatsApp', campaign_id: c, active: true, change: 'edited', changed_by: ANA },
      { version: 3, rule: 'Fechar com CTA para o WhatsApp', campaign_id: c, active: false, change: 'off', changed_by: ANA },
      { version: 4, rule: 'Chamar pelo direct', campaign_id: null, active: false, change: 'restored', changed_by: ANA },
    ]);
    // Restaurar não mexe em ligada ou desligada.
    expect((await admin.query('select rule, campaign_id, active from style_rules where id = $1', [id])).rows[0]).toEqual({ rule: 'Chamar pelo direct', campaign_id: null, active: false });
  });

  it('o histórico vem da versão mais nova, com o nome de quem mudou', async () => {
    const id = await fb.createRule(t, input('Sem emoji'), ANA);
    await fb.updateRule(t, id, { input: input('Sem emoji no gancho') }, null);
    const list = await fb.listRuleVersions(t, id);
    expect(list.map((v) => [v.version, v.change, v.changedBy])).toEqual([[2, 'edited', null], [1, 'created', 'Ana Ribeiro']]);
  });

  it('a conta B não lê nem restaura a regra da conta A', async () => {
    const id = await fb.createRule(t, input('Sem emoji'), ANA);
    await expect(fb.listRuleVersions(tenantDb(B), id)).rejects.toThrow(/não encontrada/);
    await expect(fb.restoreRuleVersion(tenantDb(B), id, 1)).rejects.toThrow(/não encontrada/);
  });

  it('campanha de outra conta não vira escopo', async () => {
    const other = await campaign(B);
    await expect(fb.createRule(t, input('Tom festivo', other), ANA)).rejects.toThrow(/Campanha não encontrada/);
  });

  it('passou de 50 versões: as mais antigas saem', async () => {
    const id = await fb.createRule(t, input('Regra'), ANA);
    for (let i = 0; i < 52; i += 1) await fb.updateRule(t, id, { active: i % 2 === 0 ? false : true }, ANA);
    const rows = await versions(id);
    expect(rows).toHaveLength(50);
    expect(rows[0].version).toBe(4);
    expect(rows.at(-1).version).toBe(53);
  });
});

describe('o que entra no post', () => {
  it('campanha em vigor: marca e campanha; encerrada ou sem campanha: só a marca', async () => {
    const live = await campaign(A);
    const ended = await campaign(A, 'ended');
    await fb.createRule(t, input('Fechar com CTA para o WhatsApp'), ANA);
    await fb.createRule(t, input('Tom festivo', live), ANA);
    await fb.createRule(t, input('Presente de Dia das Mães', ended), ANA);
    expect((await fb.rulesForCampaign(t, live)).sort()).toEqual(['Fechar com CTA para o WhatsApp', 'Tom festivo']);
    expect(await fb.rulesForCampaign(t, ended)).toEqual(['Fechar com CTA para o WhatsApp']);
    expect(await fb.rulesForCampaign(t, null)).toEqual(['Fechar com CTA para o WhatsApp']);
  });

  it('apagar a campanha apaga as regras dela, não as da marca', async () => {
    const c = await campaign(A);
    await fb.createRule(t, input('Da marca'), ANA);
    await fb.createRule(t, input('Da campanha', c), ANA);
    await admin.query('delete from campaigns where id = $1', [c]);
    expect((await fb.getRules(t)).map((r) => r.rule)).toEqual(['Da marca']);
  });
});
