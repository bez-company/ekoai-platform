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
const { addSlot, updateSlot, getActiveSlots, replaceSlots } = await import('../../platform/src/lib/slots.ts');
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

describe('agenda: publicado tirado da lista', () => {
  it('o publicado que saiu da lista (ou foi apagado no Instagram) some da agenda', async () => {
    const C = 'it-agenda-c';
    await resetTenantData(admin, [C]);
    await admin.query('insert into tenants (id, name) values ($1, $1)', [C]);
    const tc = tenantDb(C);
    const post = async (removed) =>
      (await admin.query(`insert into posts (tenant_id, pillar, channel, is_dry_run, published_at, removed_at) values ($1, 'post', 'instagram', false, '2026-10-22T21:00:00Z', $2) returning id`, [C, removed])).rows[0].id;
    const keep = await post(null);
    const gone = await post('2026-10-23T10:00:00Z');
    for (const [id, postId, at] of [['aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', keep, '2026-10-22T21:00:00Z'], ['bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb', gone, '2026-10-22T22:00:00Z']]) {
      await admin.query(
        `insert into scheduled_posts (id, tenant_id, channel, variation, caption_final, status, scheduled_for, post_id) values ($1, $2, 'instagram', '{}'::jsonb, 'x', 'published', $3, $4)`,
        [id, C, at, postId],
      );
    }
    const agenda = await getAgenda(tc, { view: 'week', date: '2026-10-22' }, { nowMs: Date.parse('2026-10-24T15:00:00Z') });
    expect(agenda.days.flatMap((d) => d.cells).map((c) => c.post?.id).filter(Boolean)).toEqual(['aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa']);
    await resetTenantData(admin, [C]);
  });
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

  it('o horário vazio traz a sugestão aberta do coordenador da própria conta', async () => {
    await addSlot(t, { channel: 'instagram', weekday: 6, hour: 10, minute: 0 });
    const ins = `insert into content_suggestions (tenant_id, slot_at, goal, idea, reason, status) values ($1, '2026-10-24T13:00:00Z', 'bastidores', $2, 'Os dois últimos foram dicas.', $3)`;
    await admin.query(ins, [A, 'Como a massa é feita', 'suggested']);
    await admin.query(ins, [B, 'Sugestão de outra conta', 'suggested']);
    const agenda = await getAgenda(t, { view: 'week', date: '2026-10-22' }, { nowMs: Date.parse('2026-10-22T15:00:00Z') });
    const sabado = agenda.days.find((d) => d.date === '2026-10-24');
    expect(sabado.cells).toHaveLength(1);
    expect(sabado.cells[0]).toMatchObject({ time: '10:00', post: null, suggestion: { idea: 'Como a massa é feita', goal: 'bastidores', goalLabel: 'Bastidores' } });
    const linkedinOnly = await getAgenda(t, { view: 'week', date: '2026-10-22' }, { nowMs: Date.parse('2026-10-22T15:00:00Z'), channel: 'linkedin' });
    expect(linkedinOnly.days.flatMap((d) => d.cells)).toEqual([]);
  });

  it('salvar a grade inteira apaga o que saiu, cria o que entrou e leva a fila para os horários novos', async () => {
    await admin.query('delete from publish_slots where tenant_id = $1', [A]);
    await scheduled(A, '55555555-5555-4555-8555-555555555555', null, 'queued');
    await addSlot(t, { channel: 'instagram', weekday: 1, hour: 9, minute: 0 });
    await addSlot(t, { channel: 'linkedin', weekday: 1, hour: 9, minute: 0 });
    const out = await replaceSlots(t, 'instagram', [{ weekday: 2, hour: 18, minute: 0 }, { weekday: 4, hour: 18, minute: 0 }]);
    expect(out).toEqual({ added: 2, removed: 1 });
    expect((await getActiveSlots(t, 'instagram')).map((s) => [s.weekday, s.hour])).toEqual([[2, 18], [4, 18]]);
    expect(await getActiveSlots(t, 'linkedin')).toHaveLength(1); // outra rede fica como está
    expect(await replaceSlots(t, 'instagram', [{ weekday: 2, hour: 18, minute: 0 }, { weekday: 4, hour: 18, minute: 0 }])).toEqual({ added: 0, removed: 0 });
    expect(await scheduleQueued(t, 'instagram')).toBe(1);
    expect((await admin.query("select status from scheduled_posts where id = '55555555-5555-4555-8555-555555555555'")).rows[0].status).toBe('scheduled');
  });
});

describe('agenda de todas as redes (BEZ-454)', () => {
  const D = 'it-agenda-d';
  const week = { view: 'week', date: '2026-10-22' };
  const nowMs = Date.parse('2026-10-22T15:00:00Z');

  it('o post do LinkedIn aparece fora de horário e a grade segue sendo a do Instagram', async () => {
    await admin.query('insert into tenants (id, name) values ($1, $1)', [D]);
    const td = tenantDb(D);
    await addSlot(td, { channel: 'instagram', weekday: 4, hour: 18, minute: 0 });
    await admin.query(
      `insert into scheduled_posts (id, tenant_id, channel, variation, caption_final, image_url, status, scheduled_for)
       values ('66666666-6666-4666-8666-666666666666', $1, 'linkedin', '{}'::jsonb, 'post do linkedin', null, 'scheduled', '2026-10-22T21:30:00Z')`,
      [D],
    );
    const all = await getAgenda(td, week, { nowMs, slotChannel: 'instagram' });
    const quinta = all.days.find((d) => d.date === '2026-10-22');
    expect(quinta.cells.map((c) => [c.kind, c.time, c.channel, c.post?.id ?? null])).toEqual([
      ['slot', '18:00', 'instagram', null],
      ['extra', '18:30', 'linkedin', '66666666-6666-4666-8666-666666666666'],
    ]);
    expect(all.slots).toBe(1); // só o horário do Instagram conta

    // quem pede uma rede só continua vendo só ela
    const instagramOnly = await getAgenda(td, week, { nowMs, channel: 'instagram' });
    expect(instagramOnly.days.find((d) => d.date === '2026-10-22').cells.map((c) => c.kind)).toEqual(['slot']);
    await resetTenantData(admin, [D]);
  });
});
