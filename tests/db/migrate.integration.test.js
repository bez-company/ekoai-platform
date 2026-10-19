import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { migrate, plan, checksum } from '../../scripts/migrate.js';

const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error('TEST_DATABASE_URL ausente');

const dbName = `ekoai_migrate_test_${Date.now()}`;
const admin = new pg.Pool({ connectionString: base, max: 1 });
const urlFor = (name) => { const u = new URL(base); u.pathname = `/${name}`; return u.toString(); };
const quiet = () => {};

beforeAll(async () => { await admin.query(`create database ${dbName}`); });
afterAll(async () => {
  await admin.query(`drop database if exists ${dbName} with (force)`);
  await admin.end();
});

describe('plano', () => {
  const file = (v, sql) => ({ version: v, sql, checksum: checksum(sql) });
  it('separa pendente, aplicada e alterada', () => {
    const files = [file('0001_a', 'a'), file('0002_b', 'b'), file('0003_c', 'c')];
    const applied = [{ version: '0001_a', checksum: checksum('a') }, { version: '0002_b', checksum: 'outro' }];
    const { pending, drifted } = plan(files, applied);
    expect(pending.map((f) => f.version)).toEqual(['0003_c']);
    expect(drifted.map((f) => f.version)).toEqual(['0002_b']);
  });
});

describe('migrate num banco vazio', () => {
  it('aplica o bootstrap e todas as migrations, e na segunda vez não faz nada', async () => {
    const first = await migrate({ url: urlFor(dbName), log: quiet });
    expect(first.applied.length).toBeGreaterThanOrEqual(16);
    expect(first.applied[0]).toBe('0001_init_schema');

    const second = await migrate({ url: urlFor(dbName), log: quiet });
    expect(second).toEqual({ applied: [], pending: [] });

    const pool = new pg.Pool({ connectionString: urlFor(dbName), max: 1 });
    const { rows } = await pool.query('select count(*)::int n from public.schema_migrations');
    expect(rows[0].n).toBe(first.applied.length);
    const { rows: tables } = await pool.query("select count(*)::int n from information_schema.tables where table_schema = 'public' and table_name = 'tenants'");
    expect(tables[0].n).toBe(1);
    await pool.end();
  });

  it('--dry-run lista sem aplicar', async () => {
    const name = `${dbName}_dry`;
    await admin.query(`create database ${name}`);
    const res = await migrate({ url: urlFor(name), dryRun: true, log: quiet });
    expect(res.pending.length).toBeGreaterThanOrEqual(16);
    const pool = new pg.Pool({ connectionString: urlFor(name), max: 1 });
    const { rows } = await pool.query("select to_regclass('public.tenants') as t");
    expect(rows[0].t).toBeNull();
    await pool.end();
    await admin.query(`drop database ${name} with (force)`);
  });

  it('migration alterada depois de aplicada é recusada; a nova pendente falha inteira e volta', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mig-'));
    await cp('supabase/migrations', dir, { recursive: true });
    // já aplicadas no banco do primeiro teste, com o conteúdo original
    await writeFile(path.join(dir, '0001_init_schema.sql'), '-- mexeram aqui\n');
    await expect(migrate({ url: urlFor(dbName), dir, log: quiet })).rejects.toThrow(/já aplicada foi alterada: 0001_init_schema/);

    await cp('supabase/migrations/0001_init_schema.sql', path.join(dir, '0001_init_schema.sql'));
    await writeFile(path.join(dir, '9999_quebrada.sql'), 'create table zz_nova (id int); select 1/0;');
    await expect(migrate({ url: urlFor(dbName), dir, log: quiet })).rejects.toThrow(/Falha em 9999_quebrada/);
    const pool = new pg.Pool({ connectionString: urlFor(dbName), max: 1 });
    const { rows } = await pool.query("select to_regclass('public.zz_nova') as t");
    expect(rows[0].t).toBeNull();
    await pool.end();
    await rm(dir, { recursive: true });
  });
});
