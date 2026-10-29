// A taxa de câmbio por mês contra o Postgres (BEZ-475): gravar e trocar, a regra de qual taxa vale, o custo em reais do mês usando a taxa dele,
// a auditoria sem valores e a tabela fechada para o cliente.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { resetTenantData } from './helpers.js';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL ausente');
process.env.DATABASE_URL = url;

const admin = new pg.Pool({ connectionString: url, max: 2 });
const { financeAccounts } = await import('../../platform/src/lib/console-finance.ts');
const { fxForMonth, listFxRates, saveFxRate } = await import('../../platform/src/lib/fx-rates.ts');
const { postPriceBrl } = await import('../../platform/src/lib/price-model.ts');
const { toBrl, FX_USD_BRL } = await import('../../platform/src/lib/pricing.ts');

const T = 'it-fx-a';
const ADMIN = '00000000-0000-4000-8000-000000000763';
const POLICY = { markupPercent: 300, minimumPerPostBrl: 1, roundUpToBrl: 0.05, targetMarginPercent: 70 };

beforeAll(async () => {
  await resetTenantData(admin, [T]);
  await admin.query('delete from platform_fx_rates');
  await admin.query("insert into tenants (id, name) values ($1, 'Conta FX')", [T]);
  await admin.query("insert into users (id, email, name) values ($1, 'it-fx-admin@example.test', 'Admin') on conflict (id) do nothing", [ADMIN]);
  const id = (await admin.query("insert into briefs (tenant_id, pillar, idea, status, source, post_kind, created_at) values ($1, 'dica', 'Post', 'approved', 'platform', 'informativo', '2026-10-10T12:00:00Z') returning id", [T])).rows[0].id;
  await admin.query("insert into generation_runs (tenant_id, brief_id, step, input_hash, status, channel, cost_usd, input_tokens, output_tokens, model, created_at) values ($1, $2, 'writer', $3, 'done', 'instagram', 1, 100, 50, 'gemini-teste', '2026-10-10T12:01:00Z')", [T, id, '1'.padStart(64, '0')]);
});

afterAll(async () => {
  await admin.query('delete from platform_fx_rates');
  await resetTenantData(admin, [T]);
  await admin.end();
});

describe('taxa de câmbio por mês', () => {
  it('sem nenhuma taxa cadastrada, vale a reserva do arquivo', async () => {
    expect(await fxForMonth('2026-10')).toEqual({ usdBrl: FX_USD_BRL, month: null, kind: 'file' });
  });

  it('grava, troca a do mesmo mês e lista da mais nova para a mais antiga', async () => {
    await saveFxRate({ month: '2026-09', usdBrl: 5.6 }, ADMIN);
    await saveFxRate({ month: '2026-10', usdBrl: 5.9 }, ADMIN);
    await saveFxRate({ month: '2026-10', usdBrl: 5.9309 }, ADMIN);
    expect(await listFxRates()).toEqual([{ month: '2026-10', usdBrl: 5.9309 }, { month: '2026-09', usdBrl: 5.6 }]);
  });

  it('o mês sem taxa usa a do mais recente anterior', async () => {
    expect(await fxForMonth('2026-11')).toEqual({ usdBrl: 5.9309, month: '2026-10', kind: 'carried' });
    expect(await fxForMonth('2026-09')).toEqual({ usdBrl: 5.6, month: '2026-09', kind: 'month' });
  });

  it('o custo em reais e a cobrança prevista do mês usam a taxa dele', async () => {
    const a = (await financeAccounts('2026-10', POLICY)).find((r) => r.id === T);
    expect(a.priceBrl).toBeCloseTo(postPriceBrl(toBrl(1, 5.9309), POLICY), 6);
    await saveFxRate({ month: '2026-10', usdBrl: 6.5 }, ADMIN);
    const b = (await financeAccounts('2026-10', POLICY)).find((r) => r.id === T);
    expect(b.priceBrl).toBeCloseTo(postPriceBrl(toBrl(1, 6.5), POLICY), 6);
    expect(b.priceBrl).toBeGreaterThan(a.priceBrl);
  });

  it('recusa taxa fora da faixa no banco e mês em formato errado', async () => {
    await expect(admin.query("insert into platform_fx_rates (month, usd_brl) values ('2026-12', 0)")).rejects.toThrow();
    await expect(admin.query("insert into platform_fx_rates (month, usd_brl) values ('dezembro', 5.5)")).rejects.toThrow();
  });

  it('a auditoria guarda que mudou, sem tenant e sem a taxa', async () => {
    const rows = (await admin.query("select tenant_id, actor_kind, target_id, metadata from audit_events where action = 'console.fx_rate_set' and actor_user_id = $1", [ADMIN])).rows;
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.tenant_id).toBeNull();
      expect(r.actor_kind).toBe('platform_admin');
      expect(r.metadata).toEqual({});
    }
  });

  it('a tabela tem RLS e nenhuma política: só o servidor lê e grava', async () => {
    expect((await admin.query("select relrowsecurity from pg_class where relname = 'platform_fx_rates'")).rows[0].relrowsecurity).toBe(true);
    expect((await admin.query("select count(*)::int as n from pg_policies where tablename = 'platform_fx_rates'")).rows[0].n).toBe(0);
  });
});
