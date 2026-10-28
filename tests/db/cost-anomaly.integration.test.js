// Alerta de custo por post aprovado contra o Postgres (BEZ-410): a consulta soma as chamadas de cada pedido,
// só conta pedido com post agendado e o post recente caro vira uma linha de log `cost-anomaly`.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import pg from 'pg';
import { resetTenantData } from './helpers.js';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL ausente');
process.env.DATABASE_URL = url;

const admin = new pg.Pool({ connectionString: url, max: 4 });
const { runCostAnomalyCheck } = await import('../../platform/src/lib/cost-anomaly.ts');

const PLAN = 'it-cost';
const A = 'it-cost-a';

// Um pedido com `cost` dividido em duas chamadas e, se `approvedHoursAgo` vier, um post agendado nessa hora.
async function brief(cost, approvedHoursAgo) {
  const { rows: [b] } = await admin.query("insert into briefs (tenant_id, pillar, idea, status, goal, source) values ($1, 'ensinar', 'x', 'ready', 'ensinar', 'platform') returning id", [A]);
  for (const [i, step] of ['writer', 'visual'].entries()) {
    await admin.query("insert into generation_runs (tenant_id, brief_id, step, input_hash, status, cost_usd) values ($1, $2, $3, $4, 'done', $5)", [A, b.id, step, String(i).repeat(64), cost / 2]);
  }
  if (approvedHoursAgo !== undefined) {
    await admin.query("insert into scheduled_posts (tenant_id, channel, variation, caption_final, scheduled_for, status, brief_id, created_at) values ($1, 'instagram', '{}', 'x', now() + interval '1 day', 'scheduled', $2, now() - make_interval(hours => $3))", [A, b.id, approvedHoursAgo]);
  }
  return b.id;
}

beforeAll(async () => {
  await resetTenantData(admin, [A]);
  await admin.query("insert into plans (id, name, kind, max_seats, max_instagram_accounts) values ($1, 'It Cost', 'empresa', 5, 1) on conflict (id) do nothing", [PLAN]);
  await admin.query("insert into tenants (id, name, kind, plan_id) values ($1, $1, 'empresa', $2)", [A, PLAN]);
});
afterAll(async () => {
  await resetTenantData(admin, [A]);
  await admin.query('delete from plans where id = $1', [PLAN]);
  await admin.end();
});

describe('alerta de anomalia de custo', () => {
  it('post recente acima de 2x a mediana gera uma linha de log; pedido sem post agendado não conta', async () => {
    for (let i = 0; i < 10; i++) await brief(0.1, 12 + i);
    await brief(50, undefined); // pedido caro que nunca foi aprovado: fora da conta
    const caro = await brief(0.5, 1);
    await brief(0.1, 2);

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await runCostAnomalyCheck();
    const lines = warn.mock.calls.map((c) => JSON.parse(c[0])).filter((l) => l.scope === 'cost-anomaly');
    warn.mockRestore();

    expect(result).toEqual({ checked: 2, anomalies: 1 });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ severity: 'WARNING', brief_id: caro, tenant_id: A, cost_usd: 0.5, median_usd: 0.1, factor: 5 });
  });
});
