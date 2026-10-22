// Posts esquecidos em Aprovar contra o Postgres (SPEC 017, decisão 12; BEZ-242; migration 0031): aviso
// com 3 dias e pergunta com 14, uma vez por post e um aviso por conta; arquivar some de Aprovar e do
// contador e dá para desfazer.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { resetTenantData } from './helpers.js';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL ausente');
process.env.DATABASE_URL = url;

const admin = new pg.Pool({ connectionString: url, max: 2 });
const { tenantDb } = await import('../../platform/src/lib/tenant-db.ts');
const { runStaleApprovals, setPendingArchived } = await import('../../platform/src/lib/stale-approvals.ts');
const { getPendings, getArchivedPendings, countByStatus } = await import('../../platform/src/lib/queries.ts');

const D = 86_400_000;
const NOW = Date.parse('2026-10-22T12:00:00Z');
const A = 'it-stale-a';
const B = 'it-stale-b';

async function pending(tenant, pendingId, daysAgo) {
  await admin.query(
    `insert into pending_approvals (tenant_id, pending_id, channel, generation, saved_at) values ($1, $2, 'instagram', '{}'::jsonb, $3)`,
    [tenant, pendingId, new Date(NOW - daysAgo * D).toISOString()],
  );
}
const notices = async (tenant) => (await admin.query('select kind, title, audience from notifications where tenant_id = $1 order by id', [tenant])).rows;

beforeAll(async () => {
  await resetTenantData(admin, [A, B]);
  await admin.query('insert into tenants (id, name) values ($1, $1), ($2, $2)', [A, B]);
  await pending(A, 'a-new', 1);
  await pending(A, 'a-4d', 4);
  await pending(A, 'a-5d', 5);
  await pending(A, 'a-20d', 20);
  await pending(B, 'b-4d', 4);
});
afterAll(async () => {
  await resetTenantData(admin, [A, B]);
  await admin.end();
});

describe('avisos', () => {
  it('primeiro ciclo: um aviso por conta para os de mais de 3 dias e uma pergunta para o de 20', async () => {
    expect(await runStaleApprovals(NOW)).toEqual({ tenants: 2, warned: 3, asked: 1 });
    expect(await notices(A)).toEqual([
      { kind: 'pending.stale', title: '2 posts esperam aprovação há mais de 3 dias', audience: 'team' },
      { kind: 'pending.archive_suggested', title: '1 post em Aprovar há mais de 14 dias', audience: 'team' },
    ]);
    expect(await notices(B)).toEqual([{ kind: 'pending.stale', title: '1 post espera aprovação há mais de 3 dias', audience: 'team' }]);
  });

  it('o ciclo seguinte não repete nada', async () => {
    expect(await runStaleApprovals(NOW + 600_000)).toEqual({ tenants: 0, warned: 0, asked: 0 });
    expect(await notices(A)).toHaveLength(2);
  });

  it('o de 4 dias, ao passar dos 14, recebe a pergunta uma vez', async () => {
    expect(await runStaleApprovals(NOW + 11 * D)).toEqual({ tenants: 2, warned: 1, asked: 3 });
    expect((await notices(A)).map((n) => n.title).at(-1)).toBe('2 posts em Aprovar há mais de 14 dias');
  });
});

describe('arquivar', () => {
  it('some de Aprovar e do contador, aparece nos arquivados e dá para desfazer', async () => {
    const t = tenantDb(A);
    expect((await countByStatus(t)).pendings).toBe(4);
    await setPendingArchived(t, 'a-20d', true);
    expect((await getPendings(t)).map((p) => p.pending_id)).not.toContain('a-20d');
    expect((await countByStatus(t)).pendings).toBe(3);
    expect((await getArchivedPendings(t)).map((p) => p.pending_id)).toEqual(['a-20d']);
    await setPendingArchived(t, 'a-20d', false);
    expect((await countByStatus(t)).pendings).toBe(4);
    expect(await getArchivedPendings(t)).toEqual([]);
  });

  it('outra conta não arquiva o post de A', async () => {
    await expect(setPendingArchived(tenantDb(B), 'a-new', true)).rejects.toThrow(/não encontrado/);
  });
});
