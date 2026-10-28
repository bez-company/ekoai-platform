// Aprovar todas as redes de uma ideia de uma vez (SPEC 028, BEZ-436), contra o Postgres: cada rede ligada vira um post agendado
// com o mesmo brief_id, rede desligada sai da fila e registra a preferência, e repetir a chamada aprova só o que sobrou.
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import pg from 'pg';
import { resetTenantData } from './helpers.js';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL ausente');
process.env.DATABASE_URL = url;

const admin = new pg.Pool({ connectionString: url, max: 2 });
const { tenantDb } = await import('../../platform/src/lib/tenant-db.ts');
const { approveAll } = await import('../../platform/src/lib/ideas.ts');
const { addSlot } = await import('../../platform/src/lib/slots.ts');

const A = 'it-approve-all';
const t = tenantDb(A);
const BRIEF = '00000000-0000-4000-8000-0000000a11a1';

async function pending(id, channel, over = {}) {
  const variation = channel === 'linkedin' ? { id: 1, hook: 'Gancho', body: 'Texto do LinkedIn', format: 'text' } : { id: 1, hook: 'Título', body: 'Corpo' };
  await admin.query(
    `insert into pending_approvals (tenant_id, pending_id, channel, generation, images, post_kind, brief_id, seed)
     values ($1, $2, $3, $4, $5, 'informativo', $6, $7)`,
    [A, id, channel, JSON.stringify({ variations: [variation] }), JSON.stringify(channel === 'linkedin' ? [] : [{ id: 1, url: 'https://app.test/img.png' }]), over.brief ?? BRIEF, JSON.stringify({ brief_id: over.brief ?? BRIEF })],
  );
}

const posts = async () => (await admin.query('select channel, status, brief_id, caption_final, media_kind from scheduled_posts where tenant_id = $1 order by channel', [A])).rows;
const left = async () => (await admin.query('select pending_id from pending_approvals where tenant_id = $1 order by pending_id', [A])).rows.map((r) => r.pending_id);
const decisions = async () => (await admin.query("select payload from post_events where type = 'idea_decision' order by id")).rows.map((r) => r.payload);

beforeAll(async () => {
  await resetTenantData(admin, [A]);
  await admin.query('insert into tenants (id, name) values ($1, $1)', [A]);
});

beforeEach(async () => {
  for (const table of ['scheduled_posts', 'pending_approvals', 'publish_slots', 'post_events', 'briefs']) await admin.query(`delete from ${table} where tenant_id = $1`, [A]);
  await admin.query("insert into briefs (id, tenant_id, idea, status) values ($1, $2, 'sinais de laje', 'ready')", [BRIEF, A]);
  await addSlot(t, { channel: 'instagram', weekday: 5, hour: 15, minute: 0 });
  await addSlot(t, { channel: 'linkedin', weekday: 4, hour: 8, minute: 0 });
});

afterAll(async () => {
  await resetTenantData(admin, [A]);
  await admin.end();
});

describe('aprovar as redes de uma ideia de uma vez', () => {
  it('duas redes ligadas agendam dois posts com o mesmo brief_id e esvaziam a fila', async () => {
    await pending('p-ig', 'instagram');
    await pending('p-li', 'linkedin');
    const r = await approveAll(t, BRIEF, [{ pendingId: 'p-ig', enabled: true }, { pendingId: 'p-li', enabled: true }]);

    expect(r.scheduled.map((s) => s.channel).sort()).toEqual(['instagram', 'linkedin']);
    expect(r.skipped).toBe(0);
    const rows = await posts();
    expect(rows.map((p) => [p.channel, p.status, p.brief_id])).toEqual([['instagram', 'scheduled', BRIEF], ['linkedin', 'scheduled', BRIEF]]);
    // o LinkedIn sem imagem sai como texto
    expect(rows.find((p) => p.channel === 'linkedin').media_kind).toBe('text');
    expect(await left()).toEqual([]);
    expect((await admin.query('select status from briefs where id = $1', [BRIEF])).rows[0].status).toBe('approved');
  });

  it('o texto editado de uma rede vale e só ela fica como editada', async () => {
    await pending('p-ig', 'instagram');
    await pending('p-li', 'linkedin');
    await approveAll(t, BRIEF, [{ pendingId: 'p-ig', enabled: true }, { pendingId: 'p-li', enabled: true, captionText: 'Texto do LinkedIn editado' }]);

    expect((await posts()).find((p) => p.channel === 'linkedin').caption_final).toBe('Texto do LinkedIn editado');
    const byChannel = Object.fromEntries((await decisions()).map((d) => [d.channel, d]));
    expect(byChannel.linkedin).toMatchObject({ enabled: true, edited: true });
    expect(byChannel.instagram).toMatchObject({ enabled: true, edited: false });
  });

  it('rede desligada sai da fila sem agendar e registra a preferência', async () => {
    await pending('p-ig', 'instagram');
    await pending('p-li', 'linkedin');
    const r = await approveAll(t, BRIEF, [{ pendingId: 'p-ig', enabled: true }, { pendingId: 'p-li', enabled: false }]);

    expect(r.skipped).toBe(1);
    expect((await posts()).map((p) => p.channel)).toEqual(['instagram']);
    expect(await left()).toEqual([]);
    expect((await decisions()).find((d) => d.channel === 'linkedin')).toMatchObject({ enabled: false });
  });

  it('repetir a chamada depois de aprovar não agenda de novo e avisa que já foi resolvido', async () => {
    await pending('p-ig', 'instagram');
    await pending('p-li', 'linkedin');
    const items = [{ pendingId: 'p-ig', enabled: true }, { pendingId: 'p-li', enabled: true }];
    await approveAll(t, BRIEF, items);
    await expect(approveAll(t, BRIEF, items)).rejects.toThrow(/já foi aprovado ou recusado/);
    expect(await posts()).toHaveLength(2);
  });

  it('se uma rede já saiu em outra aba, aprova só a que sobrou', async () => {
    await pending('p-ig', 'instagram');
    await pending('p-li', 'linkedin');
    await approveAll(t, BRIEF, [{ pendingId: 'p-ig', enabled: true }, { pendingId: 'p-li', enabled: false }]);
    await pending('p-li2', 'linkedin');
    const r = await approveAll(t, BRIEF, [{ pendingId: 'p-ig', enabled: true }, { pendingId: 'p-li2', enabled: true }]);
    expect(r.scheduled.map((s) => s.channel)).toEqual(['linkedin']);
  });
});
