// Excluir a conta contra o Postgres (SPEC 011 R8): a cascata percorre TODAS as tabelas da conta na
// ordem das chaves estrangeiras, a auditoria sobrevive, a outra conta e as pessoas ficam intactas
// e os arquivos do bucket saem. Também a exportação, que leva o logo.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { resetTenantData } from './helpers.js';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL ausente');
process.env.DATABASE_URL = url;

const admin = new pg.Pool({ connectionString: url, max: 2 });
const { tenantDb } = await import('../../platform/src/lib/tenant-db.ts');
const deletion = await import('../../platform/src/lib/account-deletion.ts');
const logos = await import('../../platform/src/lib/brand-logo.ts');
const profile = await import('../../platform/src/lib/company-profile.ts');
const logoModel = await import('../../platform/src/lib/logo-model.ts');
const exporter = await import('../../platform/src/lib/export.ts');
const { TENANT_TABLES } = await import('../../platform/src/lib/tenant-tables.ts');

const A = 'it-del-a';
const B = 'it-del-b';
const C = 'it-del-c';
const U = (n) => `00000000-0000-4000-8000-0000000005${String(n).padStart(2, '0')}`;
const EMAIL = (n) => `it-del-${n}@example.test`;
const ANA = { id: U(1), name: 'Ana', sessionVersion: 1, lastTenantId: null };
const one = async (sql, params) => (await admin.query(sql, params)).rows[0];
const count = async (sql, params) => (await one(sql, params)).n;

const objects = new Map();
const store = {
  put: async (key, bytes, type) => void objects.set(key, { bytes, type }),
  get: async (key) => objects.get(key).bytes,
  remove: async (key) => void objects.delete(key),
  removePrefix: async (prefix) => {
    for (const k of [...objects.keys()]) if (k.startsWith(prefix)) objects.delete(k);
  },
};
const be32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const chunk = (type, data = []) => [...be32(data.length), ...[...type].map((c) => c.charCodeAt(0)), ...data, 0, 0, 0, 0];
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...chunk('IHDR', [...be32(8), ...be32(8), 8, 6, 0, 0, 0]), ...chunk('IDAT', [1]), ...chunk('IEND')]);
const ABOUT = { ok: true, section: 'about', values: { niche: 'Alimentação', offering: 'Bolos', audience: 'Famílias', region: null, site_url: null, instagram_handle: null } };

async function cleanup() {
  await resetTenantData(admin, [A, B, C]);
}

async function seed(tenant, label) {
  await admin.query('insert into tenants (id, name) values ($1, $2)', [tenant, label]);
  const t = tenantDb(tenant);
  await profile.saveSection(t, ANA, ABOUT);
  await logos.saveLogo(t, ANA, logoModel.inspectLogo(PNG), store);
  await admin.query("insert into notifications (tenant_id, kind, title) values ($1, 'teste', 'um aviso')", [tenant]);
  await admin.query("insert into style_rules (tenant_id, rule) values ($1, 'sem gíria')", [tenant]);
  const sa = await one("insert into social_accounts (tenant_id, channel, external_id, handle) values ($1, 'instagram', $2, '@x') returning id", [tenant, `ext-${tenant}`]);
  await admin.query("insert into social_account_secrets (social_account_id, access_token_ciphertext, key_version) values ($1, 'cifrado', 'v1')", [sa.id]);
  await admin.query("insert into invitations (tenant_id, email, role, token_hash) values ($1, $2, 'viewer', $3)", [tenant, `convite-${tenant}@example.test`, 'f'.repeat(63) + (tenant === A ? 'a' : 'b')]);
  return sa.id;
}

beforeAll(async () => {
  await cleanup();
  for (let n = 1; n <= 4; n += 1) await admin.query('insert into users (id, email, name) values ($1, $2, $3)', [U(n), EMAIL(n), `Pessoa ${n}`]);
  await seed(A, 'It Del A');
  await seed(B, 'It Del B');
  await admin.query("insert into tenant_members (tenant_id, user_id, role) values ($1, $2, 'admin'), ($1, $3, 'admin'), ($1, $4, 'creator')", [A, U(1), U(2), U(3)]);
  await admin.query("insert into tenant_members (tenant_id, user_id, role) values ($1, $2, 'admin')", [B, U(4)]);
  await admin.query('update users set last_tenant_id = $1 where id = any($2)', [A, [U(1), U(3)]]);
  await admin.query('update users set last_tenant_id = $1 where id = $2', [B, U(4)]);
  await admin.query("insert into audit_events (tenant_id, actor_user_id, action) values ($1, $2, 'team.invitation_sent')", [A, U(1)]);
});
afterAll(async () => {
  await admin.query('delete from audit_events where tenant_id = any($1)', [[A, B, C]]).catch(() => undefined);
  await cleanup();
  await admin.end();
});

describe('exportação da conta', () => {
  it('leva as tabelas e o arquivo do logo; nunca o token das redes', async () => {
    const out = await exporter.exportTenant(tenantDb(A), store);
    expect(Object.keys(out.tables).sort()).toEqual([...TENANT_TABLES].sort());
    expect(out.files.logo).toMatchObject({ content_type: 'image/png', encoding: 'base64' });
    expect(Buffer.from(out.files.logo.data, 'base64').equals(Buffer.from(PNG))).toBe(true);
    expect(out.files.logo.path).toMatch(new RegExp(`^tenants/${A}/logo/`));
    expect(JSON.stringify(out)).not.toContain('cifrado');
    expect(out.tables.invitations[0]).not.toHaveProperty('token_hash');
  });

  it('sem logo, o campo vem nulo; logo que sumiu do bucket não derruba a exportação', async () => {
    const t = tenantDb(B);
    const empty = { ...store, get: async () => Promise.reject(new Error('sumiu')) };
    const out = await exporter.exportTenant(t, empty);
    expect(out.files.logo).toBeNull();
    expect(out.tables.company_profiles).toHaveLength(1);
  });
});

describe('excluir a conta', () => {
  let result;

  it('apaga a conta e devolve os outros administradores a avisar', async () => {
    expect(await count('select count(*)::int as n from tenants where id = $1', [A])).toBe(1);
    result = await deletion.deleteAccount({ tenantId: A, actorUserId: U(1), kind: 'empresa' }, store);
    expect(result.members).toBe(3);
    expect(result.adminEmails).toEqual([EMAIL(2)]); // o autor da exclusão não é avisado, o criador não é administrador
    expect(await count('select count(*)::int as n from tenants where id = $1', [A])).toBe(0);
  });

  it('nenhuma tabela da conta guarda linha dela (menos a auditoria, que fica)', async () => {
    for (const table of TENANT_TABLES.filter((x) => x !== 'audit_events')) {
      expect(await count(`select count(*)::int as n from "${table}" where tenant_id = $1`, [A]), table).toBe(0);
    }
    expect(await count('select count(*)::int as n from tenant_members where tenant_id = $1', [A])).toBe(0);
  });

  it('os tokens das redes saem junto (em cascata), sem sobrar texto cifrado de ninguém da conta', async () => {
    expect(await count("select count(*)::int as n from social_account_secrets s where not exists (select 1 from social_accounts a where a.id = s.social_account_id)", [])).toBe(0);
    expect(await count("select count(*)::int as n from social_account_secrets where access_token_ciphertext = 'cifrado'", [])).toBe(1); // só o da conta B
  });

  it('a auditoria sobrevive e registra quem excluiu, sem o nome da conta', async () => {
    const rows = (await admin.query("select action, actor_user_id, target_id, metadata from audit_events where tenant_id = $1 order by created_at", [A])).rows;
    expect(rows.map((r) => r.action)).toContain('team.invitation_sent');
    const del = rows.find((r) => r.action === 'account.deleted');
    expect(del).toMatchObject({ actor_user_id: U(1), target_id: A, metadata: { kind: 'empresa', members: 3 } });
    expect(JSON.stringify(del)).not.toContain('It Del A');
  });

  it('os arquivos da conta saem do bucket e os da outra ficam', async () => {
    expect([...objects.keys()].filter((k) => k.startsWith(`tenants/${A}/`))).toEqual([]);
    expect([...objects.keys()].filter((k) => k.startsWith(`tenants/${B}/`)).length).toBe(1);
  });

  it('as pessoas continuam existindo, sem a conta como última', async () => {
    expect(await count('select count(*)::int as n from users where id = any($1)', [[U(1), U(2), U(3)]])).toBe(3);
    expect(await count('select count(*)::int as n from users where last_tenant_id = $1', [A])).toBe(0);
  });

  it('a outra conta fica intacta, com perfil, logo, equipe e redes', async () => {
    const t = tenantDb(B);
    expect((await profile.getProfile(t)).niche).toBe('Alimentação');
    expect(await logos.readLogo(t, store)).not.toBeNull();
    expect(await count('select count(*)::int as n from tenant_members where tenant_id = $1', [B])).toBe(1);
    expect(await count('select count(*)::int as n from social_accounts where tenant_id = $1', [B])).toBe(1);
    expect(await count('select count(*)::int as n from users where last_tenant_id = $1', [B])).toBe(1);
  });

  it('excluir de novo (ou uma conta que não existe) falha sem apagar nada', async () => {
    await expect(deletion.deleteAccount({ tenantId: A, actorUserId: U(1), kind: 'empresa' }, store)).rejects.toThrow(/não encontrada/);
    expect(await count('select count(*)::int as n from tenants where id = $1', [B])).toBe(1);
  });

  it('falha no meio desfaz tudo (transação)', async () => {
    await admin.query('insert into tenants (id, name) values ($1, $2)', [C, 'It Del C']);
    await admin.query("insert into notifications (tenant_id, kind, title) values ($1, 'teste', 'fica')", [C]);
    // um gatilho que recusa o delete em notifications derruba a exclusão no meio
    await admin.query('create or replace function public.zz_nope() returns trigger language plpgsql as $$ begin raise exception \'recusado\'; end $$');
    await admin.query('create trigger zz_nope before delete on public.notifications for each row execute function public.zz_nope()');
    try {
      await expect(deletion.deleteAccount({ tenantId: C, actorUserId: U(1), kind: 'empresa' }, store)).rejects.toThrow(/recusado/);
      expect(await count('select count(*)::int as n from tenants where id = $1', [C])).toBe(1);
      expect(await count('select count(*)::int as n from notifications where tenant_id = $1', [C])).toBe(1);
      expect(await count('select count(*)::int as n from audit_events where tenant_id = $1', [C])).toBe(0);
    } finally {
      await admin.query('drop trigger if exists zz_nope on public.notifications');
      await admin.query('drop function if exists public.zz_nope()');
      await admin.query('delete from tenants where id = $1', [C]).catch(() => undefined);
    }
  });
});
