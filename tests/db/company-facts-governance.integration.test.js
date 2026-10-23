// Fatos da empresa com fonte, validade e aprovação contra o Postgres (SPEC 018, BEZ-263; ADR 0019):
// quem escreve o fato o confirma, o agente só propõe, confirmar muda só o que está pendente (dois cliques
// ao mesmo tempo, um passa), a conta vizinha não confirma nem lê, editar o texto devolve a revisão e a
// auditoria não guarda o texto.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { resetTenantData } from './helpers.js';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL ausente');
process.env.DATABASE_URL = url;

const admin = new pg.Pool({ connectionString: url, max: 4 });
const { tenantDb } = await import('../../platform/src/lib/tenant-db.ts');
const facts = await import('../../platform/src/lib/company-facts.ts');
const model = await import('../../platform/src/lib/company-facts-model.ts');

const A = 'it-fg-a';
const B = 'it-fg-b';
const C = 'it-fg-c';
const ANA = { id: '00000000-0000-4000-8000-000000000731', name: 'Ana', sessionVersion: 1, lastTenantId: null };
const TODAY = '2026-10-22';
const base = (text, extra = {}) => ({ kind: 'fact', text, source: 'owner', source_note: null, category: 'outro', valid_until: null, ...extra });
const row = async (id) => (await admin.query('select * from company_facts where id = $1', [id])).rows[0];

beforeAll(async () => {
  await resetTenantData(admin, [A, B, C]);
  await admin.query("insert into users (id, email, name) values ($1, 'it-fg-ana@example.test', 'Ana') on conflict (id) do nothing", [ANA.id]);
  await admin.query("insert into tenants (id, name, kind, plan_id) values ($1, $1, 'empresa', 'inicial'), ($2, $2, 'empresa', 'inicial'), ($3, $3, 'empresa', 'inicial')", [A, B, C]);
});

afterAll(async () => {
  await resetTenantData(admin, [A, B, C]);
  await admin.end();
});

describe('quem escreve confirma; o agente só propõe', () => {
  it('fato digitado nasce confirmado, com quem e quando; a data sai como AAAA-MM-DD', async () => {
    const t = tenantDb(A);
    const fact = await facts.createFact(t, ANA, base('Frete grátis até 29/10', { category: 'oferta_preco', valid_until: '2026-10-29' }));
    expect(fact).toMatchObject({ status: 'confirmed', proposedBy: 'person', approvedBy: ANA.id, validUntil: '2026-10-29', category: 'oferta_preco' });
    expect(fact.verifiedAt).toMatch(/^2026|^20\d\d/);
    expect(model.factStanding(fact, TODAY)).toEqual({ state: 'soon', daysLeft: 7 });
  });

  it('fato de agente nasce pendente, sem aprovador, e o banco recusa confirmado sem verified_at', async () => {
    const t = tenantDb(A);
    const fact = await facts.createAgentFact(t, { kind: 'fact', text: 'Mais de 2 mil bolos entregues', source: 'site', source_note: 'https://doceponto.example/sobre', category: 'numero_resultado', valid_until: '2027-04-20' });
    expect(fact).toMatchObject({ status: 'pending', proposedBy: 'agent', verifiedAt: null, approvedBy: null });
    await expect(admin.query("update company_facts set status = 'confirmed' where id = $1", [fact.id])).rejects.toThrow(/company_facts_confirmed_verified/);
    expect(model.factsForPrompt(await facts.listFacts(t), TODAY).facts).not.toContain('Mais de 2 mil bolos entregues');
  });

  it('o default do banco é pendente: insert sem status não vale', async () => {
    const { rows } = await admin.query("insert into company_facts (tenant_id, kind, text) values ($1, 'fact', 'sem decisão') returning status, proposed_by, category", [A]);
    expect(rows[0]).toEqual({ status: 'pending', proposed_by: 'person', category: 'outro' });
  });
});

describe('confirmar, recusar e desfazer', () => {
  it('confirmar muda só o pendente, grava quem e quando, e a segunda vez avisa', async () => {
    const t = tenantDb(A);
    const fact = await facts.createAgentFact(t, { kind: 'fact', text: 'Aceitamos encomendas para até 80 pessoas', source: 'site', source_note: null, category: 'sobre_a_empresa', valid_until: null });
    expect(await facts.confirmFact(t, ANA, fact.id)).toBe(1);
    expect(await row(fact.id)).toMatchObject({ status: 'confirmed', approved_by: ANA.id });
    expect((await row(fact.id)).verified_at).toBeInstanceOf(Date);
    await expect(facts.confirmFact(t, ANA, fact.id)).rejects.toThrow(/esperando confirmação/);
  });

  it('dois cliques ao mesmo tempo: um confirma, o outro recebe o aviso', async () => {
    const t = tenantDb(A);
    const fact = await facts.createAgentFact(t, { kind: 'fact', text: 'Certificado de boas práticas', source: 'site', source_note: null, category: 'certificacao_regra', valid_until: null });
    const results = await Promise.allSettled([facts.confirmFact(t, ANA, fact.id), facts.confirmFact(t, ANA, fact.id)]);
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
  });

  it('a conta vizinha não confirma, não recusa e não vê o fato', async () => {
    const t = tenantDb(A);
    const mine = await facts.createAgentFact(t, { kind: 'fact', text: 'Fato só da conta A', source: 'site', source_note: null, category: 'outro', valid_until: null });
    const other = tenantDb(B);
    await expect(facts.confirmFacts(other, ANA, [mine.id])).rejects.toThrow(/Nenhum destes fatos/);
    await expect(facts.rejectFact(other, ANA, mine.id)).rejects.toThrow(/não está esperando/);
    expect(await facts.listFacts(other)).toEqual([]);
    expect(await row(mine.id)).toMatchObject({ status: 'pending', approved_by: null });
  });

  it('confirmar vários de uma vez, com prazo novo, e só os pendentes', async () => {
    const t = tenantDb(A);
    const one = await facts.createAgentFact(t, { kind: 'fact', text: 'Lote 1', source: 'site', source_note: null, category: 'outro', valid_until: null });
    const two = await facts.createAgentFact(t, { kind: 'fact', text: 'Lote 2', source: 'site', source_note: null, category: 'outro', valid_until: null });
    const rejected = await facts.createAgentFact(t, { kind: 'fact', text: 'Lote 3', source: 'site', source_note: null, category: 'outro', valid_until: null });
    await facts.rejectFact(t, ANA, rejected.id);
    expect(await facts.confirmFacts(t, ANA, [one.id, two.id, rejected.id], '2027-01-31')).toBe(2);
    expect(await row(one.id)).toMatchObject({ status: 'confirmed' });
    expect(String((await row(one.id)).valid_until)).toContain('2027');
    expect(await row(rejected.id)).toMatchObject({ status: 'rejected' });
  });

  it('recusar vale só para pendente; desfazer devolve a pendente; confirmado não é recusado por aqui', async () => {
    const t = tenantDb(A);
    const fact = await facts.createAgentFact(t, { kind: 'fact', text: 'Entregamos em toda a região', source: 'site', source_note: null, category: 'prazo_horario', valid_until: null });
    await facts.rejectFact(t, ANA, fact.id);
    expect(await row(fact.id)).toMatchObject({ status: 'rejected', approved_by: null, verified_at: null });
    expect(model.factStanding((await facts.listFacts(t)).find((f) => f.id === fact.id), TODAY).state).toBe('rejected');
    await facts.restoreFact(t, ANA, fact.id);
    expect(await row(fact.id)).toMatchObject({ status: 'pending' });
    await facts.confirmFact(t, ANA, fact.id);
    await expect(facts.rejectFact(t, ANA, fact.id)).rejects.toThrow(/não está esperando/);
    await expect(facts.restoreFact(t, ANA, fact.id)).rejects.toThrow(/não está recusado/);
  });
});

describe('editar um fato confirmado', () => {
  it('mudar o texto devolve para revisão; o mesmo texto ou só o prazo mantêm a confirmação', async () => {
    const t = tenantDb(A);
    const fact = await facts.createFact(t, ANA, base('Bolo de pote por R$ 18', { category: 'oferta_preco', valid_until: '2026-10-15' }));
    await facts.updateFact(t, ANA, { id: fact.id, text: 'Bolo de pote por R$ 18' });
    expect(await row(fact.id)).toMatchObject({ status: 'confirmed' });
    await facts.updateFact(t, ANA, { id: fact.id, valid_until: '2026-11-21' });
    expect(await row(fact.id)).toMatchObject({ status: 'confirmed' });
    await facts.updateFact(t, ANA, { id: fact.id, text: 'Bolo de pote por R$ 20' });
    expect(await row(fact.id)).toMatchObject({ text: 'Bolo de pote por R$ 20', status: 'pending', verified_at: null, approved_by: null });
    await facts.confirmFact(t, ANA, fact.id);
    expect(await row(fact.id)).toMatchObject({ status: 'confirmed', approved_by: ANA.id });
  });

  it('prazo novo limpa o aviso de vencimento para ele poder sair de novo', async () => {
    const t = tenantDb(A);
    const fact = await facts.createFact(t, ANA, base('Frete grátis em outubro', { category: 'oferta_preco', valid_until: '2026-10-31' }));
    await admin.query("update company_facts set expiry_notice = 'soon' where id = $1", [fact.id]);
    await facts.updateFact(t, ANA, { id: fact.id, valid_until: '2026-11-30' });
    expect((await row(fact.id)).expiry_notice).toBeNull();
  });

  it('"nunca afirmar" editado continua valendo: não volta para revisão', async () => {
    const t = tenantDb(A);
    const never = await facts.createFact(t, ANA, { kind: 'never', text: 'cura garantida', source: 'owner', source_note: null, category: 'outro', valid_until: null });
    await facts.updateFact(t, ANA, { id: never.id, text: 'cura em 7 dias' });
    expect(await row(never.id)).toMatchObject({ status: 'confirmed', text: 'cura em 7 dias' });
  });
});

describe('o que o agente de texto e o revisor recebem', () => {
  it('só o que vale hoje vai ao prompt; o que não vale vai ao revisor com o motivo', async () => {
    const t = tenantDb(C);
    await facts.createFact(t, ANA, base('Entregamos no mesmo dia', { category: 'sobre_a_empresa' }));
    await facts.createFact(t, ANA, base('Bolo de pote por R$ 18', { category: 'oferta_preco', valid_until: '2026-10-15' }));
    await facts.createFact(t, ANA, { kind: 'never', text: 'sem açúcar', source: 'owner', source_note: null, category: 'outro', valid_until: null });
    await facts.createAgentFact(t, { kind: 'fact', text: 'Mais de 2 mil bolos entregues', source: 'site', source_note: null, category: 'numero_resultado', valid_until: null });
    const out = model.factsForPrompt(await facts.listFacts(t), TODAY);
    expect(out.facts).toEqual(['Entregamos no mesmo dia']);
    expect(out.never).toEqual(['sem açúcar']);
    expect(out.inactive.map((f) => [f.text, f.reason])).toEqual([['Bolo de pote por R$ 18', 'expired'], ['Mais de 2 mil bolos entregues', 'pending']]);
  });
});

describe('auditoria', () => {
  it('confirmar, recusar e propor ficam registrados sem o texto do fato', async () => {
    const t = tenantDb(A);
    const secret = 'Texto-que-nao-pode-vazar-na-auditoria-731';
    const fact = await facts.createAgentFact(t, { kind: 'fact', text: secret, source: 'site', source_note: null, category: 'outro', valid_until: null });
    await facts.confirmFact(t, ANA, fact.id);
    const { rows } = await admin.query("select action, actor_kind, metadata::text as meta from audit_events where tenant_id = $1 and target_id = $2", [A, fact.id]);
    expect(rows.map((r) => [r.action, r.actor_kind]).sort()).toEqual([['facts.confirmed', 'user'], ['facts.proposed', 'system']]);
    expect(rows.map((r) => r.meta).join(' ')).not.toContain(secret);
  });
});
