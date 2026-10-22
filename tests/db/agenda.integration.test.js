// A Agenda contra o Postgres (SPEC 017 decisão 13, BEZ-233): o recorte da semana lê só os posts do
// período e a fila; mudar um horário na própria agenda leva a fila para o horário novo.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { resetTenantData } from './helpers.js';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL ausente');
process.env.DATABASE_URL = url;
process.env.PUBLISH_TZ_OFFSET = '-3';

const admin = new pg.Pool({ connectionString: url, max: 2 });
const { tenantDb } = await import('../../platform/src/lib/tenant-db.ts');
const { getAgenda } = await import('../../platform/src/lib/agenda.ts');
const { addSlot, updateSlot, getActiveSlots } = await import('../../platform/src/lib/slots.ts');
const { scheduleQueued } = await import('../../platform/src/lib/scheduling.ts');

const A = 'it-agenda-a';
const B = 'it-agenda-b';
const t = tenantDb(A);

async function scheduled(tenant, id, scheduledFor, status = 'scheduled') {
  await admin.query(
    `insert into scheduled_posts (id, tenant_id, channel, variation, caption_final, image_url, status, scheduled_for)
     values ($1, $2, 'instagram', '{}'::jsonb, $3, 'https://app.test/i.png', $4, $5)`,
    [id, tenant, `post ${id.slice(0, 4)}`, status, scheduledFor],
  );
}

beforeAll(async () => {
  await resetTenantData(admin, [A, B]);
  await admin.query('insert into tenants (id, name) values ($1, $1), ($2, $2)', [A, B]);
});

afterAll(async () => {
  await resetTenantData(admin, [A, B]);
  await admin.end();
});

describe('agenda por período', () => {
  it('a semana traz os horários, o post do horário, a fila, e nada de outra semana ou de outra conta', async () => {
    await addSlot(t, { channel: 'instagram', weekday: 4, hour: 18, minute: 0 });
    await scheduled(A, '11111111-1111-4111-8111-111111111111', '2026-10-22T21:00:00Z');
    await scheduled(A, '22222222-2222-4222-8222-222222222222', '2026-10-29T21:00:00Z'); // semana seguinte
    await scheduled(A, '33333333-3333-4333-8333-333333333333', null, 'queued');
    await scheduled(B, '44444444-4444-4444-8444-444444444444', '2026-10-22T21:00:00Z');
    const agenda = await getAgenda(t, { view: 'week', date: '2026-10-22' }, { nowMs: Date.parse('2026-10-22T15:00:00Z') });
    const quinta = agenda.days.find((d) => d.date === '2026-10-22');
    expect(quinta.cells).toHaveLength(1);
    expect(quinta.cells[0]).toMatchObject({ kind: 'slot', time: '18:00', post: { id: '11111111-1111-4111-8111-111111111111' } });
    expect(agenda.days.flatMap((d) => d.cells).map((c) => c.post?.id).filter(Boolean)).toEqual(['11111111-1111-4111-8111-111111111111']);
    expect(agenda.queue.map((p) => p.id)).toEqual(['33333333-3333-4333-8333-333333333333']);
  });

  it('mudar o horário na agenda leva a fila para o horário novo', async () => {
    const [s] = await getActiveSlots(t, 'instagram');
    await updateSlot(t, s.id, { channel: 'instagram', weekday: 5, hour: 9, minute: 30 });
    expect((await getActiveSlots(t, 'instagram'))[0]).toMatchObject({ weekday: 5, hour: 9, minute: 30 });
    expect(await scheduleQueued(t, 'instagram')).toBe(1);
    const q = (await admin.query("select status, scheduled_for from scheduled_posts where id = '33333333-3333-4333-8333-333333333333'")).rows[0];
    expect(q.status).toBe('scheduled');
    const local = new Date(q.scheduled_for.getTime() - 3 * 3600_000);
    expect([local.getUTCDay(), local.getUTCHours(), local.getUTCMinutes()]).toEqual([5, 9, 30]);
    await expect(updateSlot(tenantDb(B), s.id, { channel: 'instagram', weekday: 1, hour: 8, minute: 0 })).rejects.toThrow(/não encontrado/);
  });
});
