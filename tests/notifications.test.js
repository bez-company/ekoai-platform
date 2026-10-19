import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const insert = vi.fn();
const state = { db: true };
vi.mock('../src/utils/db.js', () => ({
  usingDb: () => state.db,
  getDb: () => ({ from: (table) => ({ insert: (row) => insert(table, row) }) }),
}));

const { notify, buildNotice, channelName } = await import('../src/utils/notifications.js');
const platform = await import('../platform/src/lib/notifications.ts');

beforeEach(() => {
  insert.mockReset();
  insert.mockResolvedValue({ error: null });
  state.db = true;
});

describe('avisos dos jobs (src/utils/notifications.js)', () => {
  it('grava na tabela com o tenant carimbado', async () => {
    const out = await notify({ kind: 'publish.ok', title: 'Publicado no Instagram', link: '/history' }, { tenantId: 'acme' });
    expect(out.stored).toBe(true);
    expect(insert).toHaveBeenCalledWith('notifications', {
      tenant_id: 'acme', kind: 'publish.ok', level: 'info', title: 'Publicado no Instagram', body: null, link: '/history',
    });
  });

  it('sem o tenant explícito usa o tenant do job', async () => {
    await notify({ kind: 'report.weekly', title: 'Relatório semanal' });
    expect(insert.mock.calls[0][1].tenant_id).toBe('pilar');
  });

  it('dry-run e backend YAML não tocam no banco', async () => {
    await notify({ kind: 'publish.ok', title: 'x' }, { dryRun: true });
    state.db = false;
    await notify({ kind: 'publish.ok', title: 'x' });
    expect(insert).not.toHaveBeenCalled();
  });

  it('falha ao gravar não derruba o job', async () => {
    insert.mockResolvedValue({ error: { message: 'banco fora' } });
    const out = await notify({ kind: 'publish.ok', title: 'x' }, { tenantId: 'acme' });
    expect(out).toEqual({ stored: false, error: 'banco fora' });
  });

  it('aviso malformado falha alto (erro de código)', () => {
    expect(() => buildNotice({ title: 'sem kind' })).toThrow();
    expect(() => buildNotice({ kind: 'k', title: 't', level: 'fatal' })).toThrow();
    expect(() => buildNotice({ kind: 'k', title: 't', link: 'https://fora.com' })).toThrow();
    expect(buildNotice({ kind: 'k', title: 'a'.repeat(300) }).title).toHaveLength(200);
  });

  it('nome da rede para o texto do aviso', () => {
    expect(channelName('twitter')).toBe('X');
    expect(channelName('linkedin')).toBe('LinkedIn');
  });
});

describe('avisos da plataforma (platform/src/lib/notifications.ts)', () => {
  function fakeTenant(result) {
    const calls = [];
    return { calls, t: { tenantId: 'acme', insert: async (table, row) => { calls.push([table, row]); return result(); } } };
  }

  it('grava pelo tenantDb, sem HTML e só com link interno', async () => {
    const { calls, t } = fakeTenant(() => ({ error: null }));
    await platform.notify(t, { kind: 'publish.failed', level: 'error', title: 'Falhou', link: 'https://fora.com' });
    expect(calls).toEqual([['notifications', { kind: 'publish.failed', level: 'error', title: 'Falhou', body: null, link: null }]]);
  });

  it('erro do banco ou exceção não sobem para a publicação', async () => {
    const vi1 = fakeTenant(() => ({ error: { message: 'fora' } }));
    await expect(platform.notify(vi1.t, { kind: 'k', title: 't' })).resolves.toBeUndefined();
    const vi2 = fakeTenant(() => { throw new Error('rede'); });
    await expect(platform.notify(vi2.t, { kind: 'k', title: 't' })).resolves.toBeUndefined();
  });
});

describe('Telegram não volta', () => {
  const ROOT = join(import.meta.dirname, '..');
  const DIRS = ['src', 'platform/src', 'scripts', '.github/workflows'];

  function files(dir) {
    return readdirSync(dir).flatMap((name) => {
      const p = join(dir, name);
      return statSync(p).isDirectory() ? files(p) : /\.(js|ts|tsx|mjs|yml)$/.test(name) ? [p] : [];
    });
  }

  it('nenhum código, script ou workflow fala com o Telegram', () => {
    const offenders = DIRS.flatMap((d) => files(join(ROOT, d)))
      .filter((f) => /api\.telegram\.org|TELEGRAM_|telegram-api|node-telegram-bot-api/i.test(readFileSync(f, 'utf8')))
      .map((f) => relative(ROOT, f));
    expect(offenders).toEqual([]);
  });

  it('nenhuma dependência do Telegram', () => {
    for (const pkg of ['package.json', 'platform/package.json']) {
      expect(readFileSync(join(ROOT, pkg), 'utf8')).not.toMatch(/telegram/i);
    }
  });
});
