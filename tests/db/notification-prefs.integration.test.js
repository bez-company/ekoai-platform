// Preferências de aviso contra o Postgres (BEZ-366): gravar por pessoa e categoria, manter o outro canal e esconder do
// sino o que a pessoa desligou, sem mexer no que outra pessoa da mesma conta vê.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { resetTenantData } from './helpers.js';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL ausente');
process.env.DATABASE_URL = url;

const admin = new pg.Pool({ connectionString: url, max: 2 });
const { tenantDb } = await import('../../platform/src/lib/tenant-db.ts');
const n = await import('../../platform/src/lib/notifications.ts');
const prefs = await import('../../platform/src/lib/notification-prefs.ts');

const T = 'it-prefs-a';
const ANA = '00000000-0000-4000-8000-000000000701';
const BIA = '00000000-0000-4000-8000-000000000702';
const t = tenantDb(T);

beforeAll(async () => {
  await resetTenantData(admin, [T]);
  await admin.query('delete from users where id in ($1, $2)', [ANA, BIA]);
  for (const [id, mail] of [[ANA, 'it-prefs-ana@example.test'], [BIA, 'it-prefs-bia@example.test']]) await admin.query('insert into users (id, email, name) values ($1, $2, $3)', [id, mail, mail]);
  await admin.query('insert into tenants (id, name) values ($1, $1)', [T]);
  await admin.query("insert into tenant_members (tenant_id, user_id, role, notices_seen_at) values ($1, $2, 'admin', now() - interval '1 day'), ($1, $3, 'admin', now() - interval '1 day')", [T, ANA, BIA]);
  await admin.query("insert into notifications (tenant_id, kind, title, audience) values ($1, 'post.ready', 'Foto esperando', 'all'), ($1, 'publish.ok', 'Publicado', 'all'), ($1, 'algo.novo', 'Sem categoria', 'all')", [T]);
});

afterAll(async () => {
  await resetTenantData(admin, [T]);
  await admin.query('delete from users where id in ($1, $2)', [ANA, BIA]);
  await admin.end();
});

describe('preferências de aviso', () => {
  it('sem nada guardado, tudo ligado', async () => {
    const all = await prefs.getPrefs(ANA);
    expect(all).toHaveLength(5);
    expect(all.every((p) => p.inApp && p.email)).toBe(true);
    expect((await n.listNotices(t, 'admin', ANA)).map((r) => r.title).sort()).toEqual(['Foto esperando', 'Publicado', 'Sem categoria']);
    expect(await n.unreadCount(t, 'admin', ANA)).toBe(3);
  });

  it('desligar no app mantém o e-mail; a lista e o contador da pessoa deixam a categoria de fora', async () => {
    const after = await prefs.setPref(ANA, { category: 'approval', inApp: false });
    expect(after.find((p) => p.category === 'approval')).toEqual({ category: 'approval', inApp: false, email: true });
    expect((await n.listNotices(t, 'admin', ANA)).map((r) => r.title).sort()).toEqual(['Publicado', 'Sem categoria']);
    expect(await n.unreadCount(t, 'admin', ANA)).toBe(2);
  });

  it('é por pessoa: a outra pessoa da conta continua vendo tudo', async () => {
    expect((await n.listNotices(t, 'admin', BIA)).map((r) => r.title).sort()).toEqual(['Foto esperando', 'Publicado', 'Sem categoria']);
    expect(await n.unreadCount(t, 'admin', BIA)).toBe(3);
  });

  it('desligar o e-mail depois não religa o app, e religar o app volta a mostrar', async () => {
    const after = await prefs.setPref(ANA, { category: 'approval', email: false });
    expect(after.find((p) => p.category === 'approval')).toEqual({ category: 'approval', inApp: false, email: false });
    await prefs.setPref(ANA, { category: 'approval', inApp: true });
    expect((await n.listNotices(t, 'admin', ANA)).map((r) => r.title)).toContain('Foto esperando');
    expect((await prefs.getPrefs(ANA)).find((p) => p.category === 'approval')).toEqual({ category: 'approval', inApp: true, email: false });
  });

  it('kind sem categoria aparece mesmo com tudo desligado', async () => {
    for (const category of ['publication', 'approval', 'planning', 'connection', 'account']) await prefs.setPref(BIA, { category, inApp: false });
    expect((await n.listNotices(t, 'admin', BIA)).map((r) => r.title)).toEqual(['Sem categoria']);
  });
});
