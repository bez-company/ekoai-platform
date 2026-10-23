// Avisos contra o Postgres (SPEC 011 R6.3, migration 0022): o público de cada papel, o "lido até
// quando" de cada pessoa e o isolamento entre contas.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { resetTenantData } from './helpers.js';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL ausente');
process.env.DATABASE_URL = url;

const admin = new pg.Pool({ connectionString: url, max: 2 });
const { tenantDb } = await import('../../platform/src/lib/tenant-db.ts');
const n = await import('../../platform/src/lib/notifications.ts');
const accounts = await import('../../platform/src/lib/accounts.ts');

const A = 'it-notice-a';
const B = 'it-notice-b';
const C = 'it-notice-c';
const U = (i) => `00000000-0000-4000-8000-0000000006${String(i).padStart(2, '0')}`;
const ta = tenantDb(A);
const titles = (rows) => rows.map((r) => r.title).sort();
const one = async (sql, params) => (await admin.query(sql, params)).rows[0];

async function cleanup() {
  await resetTenantData(admin, [A, B, C]);
}

beforeAll(async () => {
  await cleanup();
  for (let i = 1; i <= 5; i += 1) await admin.query('insert into users (id, email, name) values ($1, $2, $3)', [U(i), `it-notice-${i}@example.test`, `Pessoa ${i}`]);
  await admin.query('insert into tenants (id, name) values ($1, $2), ($3, $4)', [A, 'It Notice A', B, 'It Notice B']);
  await admin.query("insert into tenant_members (tenant_id, user_id, role, notices_seen_at) values ($1, $2, 'admin', now() - interval '3 days'), ($1, $3, 'creator', now() - interval '3 days'), ($1, $4, 'viewer', now() - interval '3 days')", [A, U(1), U(2), U(3)]);
  await admin.query("insert into tenant_members (tenant_id, user_id, role) values ($1, $2, 'admin')", [B, U(4)]);
  // um aviso por público, em horários diferentes, e um da outra conta
  await admin.query("insert into notifications (tenant_id, kind, title, audience, created_at) values ($1, 'k', 'só admin', 'admin', now() - interval '2 hours'), ($1, 'k', 'equipe', 'team', now() - interval '1 hour'), ($1, 'k', 'todos', 'all', now() - interval '30 minutes'), ($1, 'k', 'velho para todos', 'all', now() - interval '5 days'), ($2, 'k', 'da outra conta', 'all', now())", [A, B]);
});
afterAll(async () => {
  await cleanup();
  await admin.end();
});

describe('público por papel', () => {
  it('administrador lê os três públicos; criador, equipe e todos; leitor, só todos', async () => {
    expect(titles(await n.listNotices(ta, 'admin', U(1)))).toEqual(['equipe', 'só admin', 'todos', 'velho para todos'].sort());
    expect(titles(await n.listNotices(ta, 'creator', U(2)))).toEqual(['equipe', 'todos', 'velho para todos'].sort());
    expect(titles(await n.listNotices(ta, 'viewer', U(3)))).toEqual(['todos', 'velho para todos'].sort());
  });

  it('a lista vem do mais novo para o mais velho e respeita o limite', async () => {
    const rows = await n.listNotices(ta, 'admin', U(1));
    expect(rows.map((r) => r.title)).toEqual(['todos', 'equipe', 'só admin', 'velho para todos']);
    expect(await n.listNotices(ta, 'admin', U(1), 2)).toHaveLength(2);
  });

  it('nunca mostra aviso de outra conta', async () => {
    for (const role of ['admin', 'creator', 'viewer']) expect(titles(await n.listNotices(ta, role, U(1)))).not.toContain('da outra conta');
  });

  it('aviso sem público informado nasce só para administrador (padrão do banco)', async () => {
    await n.notify(ta, { kind: 'k2', title: 'sem público' });
    expect(titles(await n.listNotices(ta, 'viewer', U(3)))).not.toContain('sem público');
    expect(titles(await n.listNotices(ta, 'creator', U(2)))).not.toContain('sem público');
    expect(titles(await n.listNotices(ta, 'admin', U(1)))).toContain('sem público');
    await admin.query("delete from notifications where kind = 'k2'");
  });

  it('notify grava o público informado', async () => {
    await n.notify(ta, { kind: 'k3', title: 'para a equipe', audience: 'team' });
    expect((await one("select audience from notifications where kind = 'k3'", [])).audience).toBe('team');
    await admin.query("delete from notifications where kind = 'k3'");
  });

  it('o banco recusa público inválido', async () => {
    const err = await admin.query("insert into notifications (tenant_id, kind, title, audience) values ($1, 'k', 'x', 'viewer')", [A]).then(() => null, (e) => e);
    expect(err?.code).toBe('23514');
  });
});

describe('não lidos por pessoa', () => {
  it('conta só o que veio depois de "visto até" e é do público da pessoa', async () => {
    // visto há 3 dias: os quatro avisos recentes de cada público contam, o de 5 dias atrás não
    expect(await n.unreadCount(ta, 'admin', U(1))).toBe(3);
    expect(await n.unreadCount(ta, 'creator', U(2))).toBe(2);
    expect(await n.unreadCount(ta, 'viewer', U(3))).toBe(1);
  });

  it('cada aviso da lista diz se é novo para quem olha', async () => {
    const rows = await n.listNotices(ta, 'admin', U(1));
    expect(rows.map((r) => [r.title, r.unread])).toEqual([['todos', true], ['equipe', true], ['só admin', true], ['velho para todos', false]]);
  });

  it('marcar como lido zera só a própria pessoa, só nesta conta', async () => {
    await n.markNoticesSeen(ta, U(1));
    expect(await n.unreadCount(ta, 'admin', U(1))).toBe(0);
    expect(await n.unreadCount(ta, 'creator', U(2))).toBe(2);
    expect((await n.listNotices(ta, 'admin', U(1))).every((r) => !r.unread)).toBe(true);
    expect(await n.unreadCount(tenantDb(B), 'admin', U(4))).toBe(1); // a outra conta, outra pessoa: intacta
  });

  it('aviso novo depois de marcar volta a contar', async () => {
    await n.notify(ta, { kind: 'k4', title: 'novo', audience: 'all' });
    expect(await n.unreadCount(ta, 'admin', U(1))).toBe(1);
    expect(await n.unreadCount(ta, 'viewer', U(3))).toBe(2);
    await admin.query("delete from notifications where kind = 'k4'");
  });

  it('sem pessoa (senha única) ou quem não é da conta: nada é novo', async () => {
    expect(await n.unreadCount(ta, 'admin', null)).toBe(0);
    expect(await n.unreadCount(ta, 'admin', U(5))).toBe(0);
    expect((await n.listNotices(ta, 'admin', null)).every((r) => !r.unread)).toBe(true);
  });
});

describe('aviso de conta criada', () => {
  it('nasce para o administrador, com o link para os horários', async () => {
    const id = await accounts.createAccount({ userId: U(5), name: 'It Notice Conta Nova', kind: 'empresa' });
    try {
      const row = await one("select kind, audience, link, title from notifications where tenant_id = $1 and kind = 'account.created'", [id]);
      expect(row).toEqual({ kind: 'account.created', audience: 'admin', link: '/configuracoes', title: 'Conta criada' });
      const t = tenantDb(id);
      expect(titles(await n.listNotices(t, 'admin', U(5)))).toEqual(['Conta criada']);
      expect(await n.listNotices(t, 'viewer', U(5))).toEqual([]);
    } finally {
      await resetTenantData(admin, [id]);
    }
  });
});
