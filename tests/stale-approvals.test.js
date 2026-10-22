import { describe, it, expect } from 'vitest';
import { staleActions, staleNotice, archiveNotice } from '../platform/src/lib/stale-approvals.ts';
import { parseArchive } from '../platform/src/lib/route-input.ts';

const now = Date.parse('2026-10-22T12:00:00Z');
const daysAgo = (d) => new Date(now - d * 86_400_000).toISOString();
const row = (id, days, extra = {}) => ({ id, savedAt: daysAgo(days), staleNotifiedAt: null, archiveAskedAt: null, ...extra });

describe('posts esquecidos em Aprovar (SPEC 017, decisão 12)', () => {
  it('mais de 3 dias avisa; mais de 14 pergunta se arquiva; 3 dias certos ainda não', () => {
    expect(staleActions([row('a', 2), row('b', 3), row('c', 4), row('d', 15)], now)).toEqual({ warn: ['c'], ask: ['d'] });
  });

  it('cada aviso sai uma vez por post', () => {
    const warned = daysAgo(1);
    expect(staleActions([row('c', 5, { staleNotifiedAt: warned })], now)).toEqual({ warn: [], ask: [] });
    expect(staleActions([row('c', 15, { staleNotifiedAt: warned })], now)).toEqual({ warn: [], ask: ['c'] });
    expect(staleActions([row('d', 20, { staleNotifiedAt: warned, archiveAskedAt: warned })], now)).toEqual({ warn: [], ask: [] });
  });

  it('o texto junta os posts da conta e fala no singular quando é um', () => {
    expect(staleNotice(1).title).toBe('1 post espera aprovação há mais de 3 dias');
    expect(staleNotice(2)).toMatchObject({ title: '2 posts esperam aprovação há mais de 3 dias', link: '/inbox', audience: 'team' });
    expect(archiveNotice(3).title).toBe('3 posts em Aprovar há mais de 14 dias');
    expect(archiveNotice(1).body).toMatch(/não conta como rejeição/);
  });

  it('arquivar: pede o post e se é para arquivar ou desfazer', () => {
    expect(parseArchive({ pendingId: 'plat-1', archived: true })).toEqual({ ok: true, value: { pendingId: 'plat-1', archived: true } });
    expect(parseArchive({ pendingId: 'plat-1' }).ok).toBe(false);
    expect(parseArchive({ archived: false }).ok).toBe(false);
    expect(parseArchive(null).ok).toBe(false);
  });
});
