// O desconto de preço por conta contra o Postgres (SPEC 032): período por dia, substituição, encerramento, preço dos posts de períodos
// anteriores intacto, auditoria sem valores nem tenant e a tabela fora da exportação de dados do cliente.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { resetTenantData } from './helpers.js';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL ausente');
process.env.DATABASE_URL = url;

const admin = new pg.Pool({ connectionString: url, max: 2 });
const { financeAccounts } = await import('../../platform/src/lib/console-finance.ts');
const { setAccountDiscount, endAccountDiscount, listDiscounts } = await import('../../platform/src/lib/console-discounts.ts');
const { postPriceWithDiscountBrl } = await import('../../platform/src/lib/price-model.ts');
const { toBrl } = await import('../../platform/src/lib/pricing.ts');
const { TENANT_TABLES } = await import('../../platform/src/lib/tenant-tables.ts');

const X = 'it-dsc-x';
const Y = 'it-dsc-y';
const ADMIN = '00000000-0000-4000-8000-000000000762';
const POLICY = { markupPercent: 300, minimumPerPostBrl: 1, roundUpToBrl: 0.05, targetMarginPercent: 70 };
const COST = 0.1; // US$ por post
const at = (day) => new Date(`${day}T12:00:00Z`);
const list = (off = 0) => postPriceWithDiscountBrl(toBrl(COST), POLICY, off);

let n = 0;
const hash = () => String(++n).padStart(64, '0');
const post = async (tenant, day) => {
  const id = (await admin.query("insert into briefs (tenant_id, pillar, idea, status, source, post_kind, created_at) values ($1, 'dica', 'Post', 'approved', 'platform', 'informativo', $2) returning id", [tenant, `${day}T12:00:00Z`])).rows[0].id;
  await admin.query("insert into generation_runs (tenant_id, brief_id, step, input_hash, status, channel, cost_usd, input_tokens, output_tokens, model, created_at) values ($1, $2, 'writer', $3, 'done', 'instagram', $4, 100, 50, 'gemini-teste', $5)", [tenant, id, hash(), COST, `${day}T12:01:00Z`]);
};
const priceOf = async (tenant) => (await financeAccounts('2026-10', POLICY)).find((a) => a.id === tenant)?.priceBrl;

beforeAll(async () => {
  await resetTenantData(admin, [X, Y, 'it-dsc-z']);
  await admin.query("insert into tenants (id, name) values ($1, 'Conta X'), ($2, 'Conta Y')", [X, Y]);
  await admin.query("insert into users (id, email, name) values ($1, 'it-dsc-admin@example.test', 'Admin') on conflict (id) do nothing", [ADMIN]);
  await post(X, '2026-10-10');
  await post(X, '2026-10-20');
  await post(Y, '2026-10-20');
});

afterAll(async () => {
  await resetTenantData(admin, [X, Y, 'it-dsc-z']);
  await admin.end();
});

describe('desconto por conta', () => {
  it('sem desconto, a conta paga o preço de lista', async () => {
    expect(await priceOf(X)).toBeCloseTo(list() * 2, 6);
    const a = (await financeAccounts('2026-10', POLICY)).find((r) => r.id === X);
    expect(a.discountPercent).toBeNull();
  });

  it('o desconto vale a partir do dia em que é aplicado: o post anterior mantém o preço de lista e só a conta com desconto muda', async () => {
    await setAccountDiscount(X, { discountPercent: 10, reason: 'Piloto', endsOn: null }, ADMIN, at('2026-10-15'));
    expect(await priceOf(X)).toBeCloseTo(list() + list(10), 6);
    expect(await priceOf(Y)).toBeCloseTo(list(), 6);
    expect(await listDiscounts(X)).toEqual([expect.objectContaining({ discountPercent: 10, reason: 'Piloto', startsOn: '2026-10-15', endsOn: null })]);
  });

  it('um novo desconto encerra o anterior no dia anterior e o post do período antigo mantém o desconto dele', async () => {
    await setAccountDiscount(X, { discountPercent: 20, reason: 'Contrato anual', endsOn: '2026-12-31' }, ADMIN, at('2026-10-25'));
    const all = await listDiscounts(X);
    expect(all.map((d) => [d.discountPercent, d.startsOn, d.endsOn])).toEqual([[20, '2026-10-25', '2026-12-31'], [10, '2026-10-15', '2026-10-24']]);
    expect(await priceOf(X)).toBeCloseTo(list() + list(10), 6); // o post de 20/10 ainda tem o desconto de 10%
  });

  it('trocar de novo no mesmo dia substitui a linha de hoje em vez de empilhar', async () => {
    await setAccountDiscount(X, { discountPercent: 30, reason: 'Ajuste', endsOn: null }, ADMIN, at('2026-10-25'));
    const all = await listDiscounts(X);
    expect(all.map((d) => [d.discountPercent, d.startsOn, d.endsOn])).toEqual([[30, '2026-10-25', null], [10, '2026-10-15', '2026-10-24']]);
  });

  it('encerrar termina o desconto ontem: posts novos voltam à lista e os do período mantêm o preço', async () => {
    await endAccountDiscount(X, ADMIN, at('2026-10-27'));
    const all = await listDiscounts(X);
    expect(all.map((d) => [d.discountPercent, d.endsOn])).toEqual([[30, '2026-10-26'], [10, '2026-10-24']]);
    await post(X, '2026-10-28');
    expect(await priceOf(X)).toBeCloseTo(list() + list(10) + list(), 6);
  });

  it('o que começou hoje e é encerrado hoje não deixa linha, porque nenhum período passado foi precificado por ele', async () => {
    await setAccountDiscount(Y, { discountPercent: 5, reason: 'Teste', endsOn: null }, ADMIN, at('2026-10-29'));
    await endAccountDiscount(Y, ADMIN, at('2026-10-29'));
    expect(await listDiscounts(Y)).toEqual([]);
  });

  it('conta que não existe dá "não encontrada" e não grava nada', async () => {
    await expect(setAccountDiscount('it-dsc-nao-existe', { discountPercent: 10, reason: 'Piloto', endsOn: null }, ADMIN)).rejects.toThrow(/não existe/);
    await expect(endAccountDiscount('it-dsc-nao-existe', ADMIN)).rejects.toThrow(/não existe/);
    expect((await admin.query("select count(*)::int as n from account_price_discounts where account_id = 'it-dsc-nao-existe'")).rows[0].n).toBe(0);
  });
});

describe('o desconto não chega ao cliente', () => {
  it('a auditoria guarda que mudou, sem tenant (o registro de atividade da conta é do cliente) e sem os valores', async () => {
    const rows = (await admin.query("select tenant_id, actor_kind, action, target_id, metadata from audit_events where action like 'console.account_discount_%' and actor_user_id = $1", [ADMIN])).rows;
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.tenant_id).toBeNull();
      expect(r.actor_kind).toBe('platform_admin');
      expect([X, Y]).toContain(r.target_id);
      expect(r.metadata).toEqual({});
    }
    expect(new Set(rows.map((r) => r.action))).toEqual(new Set(['console.account_discount_set', 'console.account_discount_ended']));
  });

  it('a tabela tem RLS e nenhuma política, e não tem tenant_id: fica fora de TENANT_TABLES e da exportação de dados', async () => {
    const rls = (await admin.query("select relrowsecurity from pg_class where relname = 'account_price_discounts'")).rows[0];
    expect(rls.relrowsecurity).toBe(true);
    expect((await admin.query("select count(*)::int as n from pg_policies where tablename = 'account_price_discounts'")).rows[0].n).toBe(0);
    const cols = (await admin.query("select column_name from information_schema.columns where table_name = 'account_price_discounts'")).rows.map((r) => r.column_name);
    expect(cols).not.toContain('tenant_id');
    expect(TENANT_TABLES).not.toContain('account_price_discounts');
  });

  it('apagar a conta apaga os descontos dela', async () => {
    await admin.query("insert into tenants (id, name) values ('it-dsc-z', 'Conta Z')");
    await setAccountDiscount('it-dsc-z', { discountPercent: 15, reason: 'Teste', endsOn: null }, ADMIN, at('2026-10-20'));
    expect(await listDiscounts('it-dsc-z')).toHaveLength(1);
    await resetTenantData(admin, ['it-dsc-z']); // apaga os dados da conta e a conta: o desconto sai junto, por cascata
    expect(await listDiscounts('it-dsc-z')).toEqual([]);
  });
});
