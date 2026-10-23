import { describe, it, expect, vi } from 'vitest';
import { cardRef, prEvent, targetStatus, sync } from '../scripts/clickup-pr-sync.js';

describe('cardRef', () => {
  it('lê o BEZ-N do prefixo do título', () => {
    expect(cardRef('[BEZ-296] fix(generation): keep the part')).toBe('BEZ-296');
    expect(cardRef('  [BEZ-5] feat: x')).toBe('BEZ-5');
  });
  it('ignora título sem o prefixo, ou com outro formato', () => {
    expect(cardRef('fix: sem card')).toBeNull();
    expect(cardRef('[CU-1dfhfaq7kfu] fix: x')).toBeNull();
    expect(cardRef('fix(x): menciona [BEZ-9] no meio')).toBeNull();
    expect(cardRef('[BEZ-9]fix: sem espaço')).toBeNull();
    expect(cardRef(undefined)).toBeNull();
  });
});

describe('prEvent', () => {
  it('abrir e editar são open; fechar mergeada é merged', () => {
    expect(prEvent({ action: 'opened', base: 'staging' })).toBe('open');
    expect(prEvent({ action: 'edited', base: 'staging' })).toBe('open');
    expect(prEvent({ action: 'closed', merged: true, base: 'staging' })).toBe('merged');
  });
  it('fechar sem merge, outra ação e outra base não fazem nada', () => {
    expect(prEvent({ action: 'closed', merged: false, base: 'staging' })).toBeNull();
    expect(prEvent({ action: 'labeled', base: 'staging' })).toBeNull();
    expect(prEvent({ action: 'opened', base: 'main' })).toBeNull();
  });
});

describe('targetStatus', () => {
  it('PR aberta leva a In Review só de quem ainda não chegou lá', () => {
    expect(targetStatus('open', 'todo')).toBe('in review');
    expect(targetStatus('open', 'in progress')).toBe('in review');
    expect(targetStatus('open', 'in review')).toBeNull();
    expect(targetStatus('open', 'staging')).toBeNull();
    expect(targetStatus('open', 'done')).toBeNull();
  });
  it('merge leva a Staging e nunca regride Done nem Canceled', () => {
    expect(targetStatus('merged', 'in review')).toBe('staging');
    expect(targetStatus('merged', 'in progress')).toBe('staging');
    expect(targetStatus('merged', 'done')).toBeNull();
    expect(targetStatus('merged', 'canceled')).toBeNull();
    expect(targetStatus('merged', 'staging')).toBeNull();
  });
});

describe('sync', () => {
  const silent = { log: vi.fn() };
  const respond = (status, comments = []) =>
    vi.fn(async (url, init = {}) => {
      const body = url.includes('/team/') ? { tasks: [{ id: 'abc', name: '[BEZ-296] Card', status: { status } }] }
        : url.endsWith('/team') ? { teams: [{ id: '1' }] }
        : url.includes('/comment') && !init.method ? { comments }
        : {};
      return { ok: true, json: async () => body };
    });
  const args = { token: 't', ref: 'BEZ-296', prUrl: 'https://github.com/o/r/pull/178', prNumber: 178, log: silent };

  it('comenta o link e move o card ao abrir a PR', async () => {
    const fetchMock = respond('in progress');
    vi.stubGlobal('fetch', fetchMock);
    await sync({ ...args, event: 'open' });
    const writes = fetchMock.mock.calls.filter(([, i]) => i?.method).map(([u, i]) => `${i.method} ${u.split('/v2/')[1]} ${i.body}`);
    expect(writes).toEqual([
      'POST task/abc/comment {"comment_text":"PR #178: https://github.com/o/r/pull/178"}',
      'PUT task/abc {"status":"in review"}',
    ]);
  });

  it('não repete o comentário nem mexe no status quando já está certo', async () => {
    const fetchMock = respond('in review', [{ comment_text: 'PR #178: https://github.com/o/r/pull/178' }]);
    vi.stubGlobal('fetch', fetchMock);
    await sync({ ...args, event: 'open' });
    expect(fetchMock.mock.calls.filter(([, i]) => i?.method)).toEqual([]);
  });
});
