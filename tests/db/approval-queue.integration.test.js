// Aprovar sem horário na agenda e publicar agora, contra o Postgres: o post aprovado sem horário
// livre fica na fila (queued, sem scheduled_for) e ganha horário quando a conta cria um; publicar
// agora respeita a pausa e, se a rede recusar, deixa o post como falhou na hora, sem nova tentativa.
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import pg from 'pg';
import { resetTenantData } from './helpers.js';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL ausente');
process.env.DATABASE_URL = url;

const admin = new pg.Pool({ connectionString: url, max: 2 });
const { tenantDb } = await import('../../platform/src/lib/tenant-db.ts');
const { approvePending, scheduleQueued } = await import('../../platform/src/lib/scheduling.ts');
const { publishNow, runPublishDue } = await import('../../platform/src/lib/publish.ts');
const { addSlot } = await import('../../platform/src/lib/slots.ts');
const { setPause } = await import('../../platform/src/lib/pause.ts');

const A = 'it-approval-queue';
const t = tenantDb(A);

async function pending(id) {
  await admin.query(
    `insert into pending_approvals (tenant_id, pending_id, channel, generation, images, post_kind)
     values ($1, $2, 'instagram', $3, $4, 'informativo')`,
    [A, id, JSON.stringify({ variations: [{ id: 1, hook: 'Título', body: 'Corpo' }] }), JSON.stringify([{ id: 1, url: 'https://app.test/img.png' }])],
  );
}

const row = async (id) => (await admin.query('select status, scheduled_for, last_error, attempts from scheduled_posts where id = $1', [id])).rows[0];

beforeAll(async () => {
  await resetTenantData(admin, [A]);
  await admin.query('insert into tenants (id, name) values ($1, $1)', [A]);
});

beforeEach(async () => {
  await admin.query('delete from scheduled_posts where tenant_id = $1', [A]);
  await admin.query('delete from pending_approvals where tenant_id = $1', [A]);
  await admin.query('delete from publish_slots where tenant_id = $1', [A]);
  await admin.query('delete from publishing_controls where tenant_id = $1', [A]);
});

afterAll(async () => {
  await resetTenantData(admin, [A]);
  await admin.end();
});

describe('aprovar sem horário na agenda', () => {
  it('fica na fila sem horário, sai de Aprovar e o cron não publica', async () => {
    await pending('p-fila');
    const { id, scheduledFor } = await approvePending(t, { pendingId: 'p-fila', captionId: 1, artId: 1 });
    expect(scheduledFor).toBeNull();
    expect(await row(id)).toMatchObject({ status: 'queued', scheduled_for: null });
    expect((await admin.query('select 1 from pending_approvals where pending_id = $1', ['p-fila'])).rowCount).toBe(0);

    const summary = await runPublishDue();
    expect(summary.picked).toBe(0);
    expect((await row(id)).status).toBe('queued');
  });

  it('horário novo na agenda leva a fila para os horários livres, na ordem de aprovação', async () => {
    await pending('p-1');
    const first = await approvePending(t, { pendingId: 'p-1', captionId: 1, artId: 1 });
    await pending('p-2');
    const second = await approvePending(t, { pendingId: 'p-2', captionId: 1, artId: 1 });

    await addSlot(t, { channel: 'instagram', weekday: 2, hour: 18, minute: 0 });
    expect(await scheduleQueued(t, 'instagram')).toBe(2);

    const a = await row(first.id);
    const b = await row(second.id);
    expect(a.status).toBe('scheduled');
    expect(b.status).toBe('scheduled');
    // um por horário: o segundo cai na semana seguinte
    expect(new Date(b.scheduled_for).getTime() - new Date(a.scheduled_for).getTime()).toBe(7 * 86400000);
  });

  it('com horário livre, agenda direto', async () => {
    await addSlot(t, { channel: 'instagram', weekday: 3, hour: 9, minute: 30 });
    await pending('p-slot');
    const { id, scheduledFor } = await approvePending(t, { pendingId: 'p-slot', captionId: 1, artId: 1 });
    expect(scheduledFor).not.toBeNull();
    expect((await row(id)).status).toBe('scheduled');
  });
});

describe('publicar agora', () => {
  it('conta pausada não publica', async () => {
    await pending('p-pausa');
    const { id } = await approvePending(t, { pendingId: 'p-pausa', captionId: 1, artId: 1 });
    await setPause(t, true, 'teste');
    await expect(publishNow(t, id)).rejects.toThrow(/pausada/);
    expect((await row(id)).status).toBe('queued');
  });

  it('falha da rede deixa o post como falhou na hora, com o motivo', async () => {
    await pending('p-agora');
    const { id } = await approvePending(t, { pendingId: 'p-agora', captionId: 1, artId: 1, publishNow: true });
    // sem Instagram conectado: a publicação falha com o próximo passo
    const result = await publishNow(t, id);
    expect(result.ok).toBe(false);
    const r = await row(id);
    expect(r).toMatchObject({ status: 'failed', attempts: 1 });
    expect(r.last_error).toMatch(/Instagram/);
    await expect(publishNow(t, '00000000-0000-4000-8000-000000000999')).rejects.toThrow(/mudou de estado/);
  });
});
