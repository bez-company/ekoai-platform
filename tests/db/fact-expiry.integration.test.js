// Aviso de vencimento dos fatos contra o Postgres (SPEC 018, BEZ-263): uma vez em 7 dias e uma vez no
// vencimento, só para o administrador, sem o texto do fato; rodar o job duas vezes (ou ao mesmo tempo)
// não repete; fato pendente, recusado ou sem prazo não avisa.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { resetTenantData } from './helpers.js';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL ausente');
process.env.DATABASE_URL = url;

const admin = new pg.Pool({ connectionString: url, max: 6 });
const { runFactExpiryNotices } = await import('../../platform/src/lib/fact-expiry.ts');
const { addDays } = await import('../../platform/src/lib/company-facts-model.ts');

const A = 'it-fe-a';
const B = 'it-fe-b';
const C = 'it-fe-c';
const NOW = new Date('2026-10-22T15:00:00Z'); // dia local 2026-10-22
const TODAY = '2026-10-22';
const SECRET = 'Texto-do-fato-que-nao-vai-no-aviso';

async function fact(tenant, text, { status = 'confirmed', validUntil = null, category = 'oferta_preco', active = true } = {}) {
  await admin.query(
    `insert into company_facts (tenant_id, kind, text, status, verified_at, valid_until, category, active)
     values ($1, 'fact', $2, $3, case when $3 = 'confirmed' then now() end, $4, $5, $6)`,
    [tenant, text, status, validUntil, category, active],
  );
}
const notices = async (tenant) => (await admin.query('select kind, audience, title, body, link from notifications where tenant_id = $1 order by kind', [tenant])).rows;
const noticeOf = async (tenant, text) => (await admin.query('select expiry_notice from company_facts where tenant_id = $1 and text = $2', [tenant, text])).rows[0].expiry_notice;

beforeAll(async () => {
  await resetTenantData(admin, [A, B, C]);
  await admin.query("insert into tenants (id, name, kind, plan_id) values ($1, $1, 'empresa', 'inicial'), ($2, $2, 'empresa', 'inicial'), ($3, $3, 'empresa', 'inicial')", [A, B, C]);
  await fact(A, `${SECRET} 1`, { validUntil: addDays(TODAY, 5) });
  await fact(A, `${SECRET} 2`, { validUntil: addDays(TODAY, 7), category: 'prazo_horario' });
  await fact(A, `${SECRET} vencido`, { validUntil: addDays(TODAY, -2) });
  await fact(A, `${SECRET} longe`, { validUntil: addDays(TODAY, 30) });
  await fact(A, `${SECRET} sem prazo`);
  await fact(A, `${SECRET} pendente`, { status: 'pending', validUntil: addDays(TODAY, 3) });
  await fact(A, `${SECRET} recusado`, { status: 'rejected', validUntil: addDays(TODAY, 3) });
  await fact(A, `${SECRET} desligado`, { validUntil: addDays(TODAY, 3), active: false });
  await fact(B, `${SECRET} B`, { validUntil: addDays(TODAY, 1), category: 'numero_resultado' });
});

afterAll(async () => {
  await resetTenantData(admin, [A, B, C]);
  await admin.end();
});

describe('aviso de vencimento dos fatos', () => {
  it('avisa o administrador uma vez por etapa, por conta, só com a categoria', async () => {
    const summary = await runFactExpiryNotices({ now: NOW });
    expect(summary).toEqual({ accounts: 2, soon: 3, expired: 1, failed: 0 });
    const a = await notices(A);
    expect(a.map((n) => [n.kind, n.audience, n.title])).toEqual([
      ['facts.expired', 'admin', '1 fato da empresa venceu'],
      ['facts.soon', 'admin', '2 fatos da empresa vencem em 7 dias'],
    ]);
    expect(a[1].body).toBe('Oferta e preço, Prazo e horário. Atualize a validade para os posts continuarem usando.');
    expect(a.every((n) => n.link === '/configuracoes/fatos')).toBe(true);
    expect(JSON.stringify(a)).not.toContain(SECRET);
    expect((await notices(B)).map((n) => n.kind)).toEqual(['facts.soon']);
    expect(await noticeOf(A, `${SECRET} 1`)).toBe('soon');
    expect(await noticeOf(A, `${SECRET} vencido`)).toBe('expired');
    expect(await noticeOf(A, `${SECRET} longe`)).toBeNull();
    expect(await noticeOf(A, `${SECRET} pendente`)).toBeNull();
    expect(await noticeOf(A, `${SECRET} recusado`)).toBeNull();
    expect(await noticeOf(A, `${SECRET} desligado`)).toBeNull();
  });

  it('rodar de novo no mesmo dia não repete o aviso', async () => {
    expect(await runFactExpiryNotices({ now: NOW })).toEqual({ accounts: 0, soon: 0, expired: 0, failed: 0 });
    expect((await notices(A)).length).toBe(2);
  });

  it('quem foi avisado em 7 dias é avisado de novo quando vence; depois disso, nunca mais', async () => {
    const later = new Date('2026-11-01T15:00:00Z'); // os dois fatos "soon" já venceram
    const out = await runFactExpiryNotices({ now: later });
    expect(out).toMatchObject({ expired: 3, soon: 0, failed: 0 });
    expect(await noticeOf(A, `${SECRET} 1`)).toBe('expired');
    expect((await notices(A)).filter((n) => n.kind === 'facts.expired').length).toBe(2);
    expect(await runFactExpiryNotices({ now: later })).toMatchObject({ expired: 0, soon: 0 });
  });

  it('dois jobs ao mesmo tempo avisam uma vez só', async () => {
    await fact(C, `${SECRET} C`, { validUntil: addDays(TODAY, 2) });
    const [one, two] = await Promise.all([runFactExpiryNotices({ now: NOW }), runFactExpiryNotices({ now: NOW })]);
    expect(one.soon + two.soon).toBe(1);
    expect((await notices(C)).length).toBe(1);
  });
});
