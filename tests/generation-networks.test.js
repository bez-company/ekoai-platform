import { describe, it, expect } from 'vitest';
import { failedNetworks, networkRows } from '../platform/src/lib/generation-networks.ts';

const base = { status: 'generating', channels: ['instagram', 'linkedin'], coreDone: false, pendingChannels: [], errors: {} };
const view = (over) => networkRows({ ...base, ...over }).map((r) => [r.id, r.state]);

describe('linhas da tela Gerando por rede (SPEC 028, BEZ-437)', () => {
  it('na fila nada começou', () => {
    expect(view({ status: 'queued' })).toEqual([['core', 'todo'], ['instagram', 'todo'], ['linkedin', 'todo'], ['review', 'todo']]);
  });

  it('gerando: o núcleo roda e, depois dele, a primeira rede e só então a seguinte', () => {
    expect(view({})).toEqual([['core', 'run'], ['instagram', 'todo'], ['linkedin', 'todo'], ['review', 'todo']]);
    expect(view({ coreDone: true })).toEqual([['core', 'done'], ['instagram', 'run'], ['linkedin', 'todo'], ['review', 'todo']]);
    expect(view({ coreDone: true, pendingChannels: ['instagram'] })).toEqual([['core', 'done'], ['instagram', 'done'], ['linkedin', 'run'], ['review', 'todo']]);
    expect(view({ coreDone: true, pendingChannels: ['instagram', 'linkedin'] })).toEqual([['core', 'done'], ['instagram', 'done'], ['linkedin', 'done'], ['review', 'run']]);
  });

  it('pronto: tudo feito', () => {
    expect(view({ status: 'ready', pendingChannels: ['instagram', 'linkedin'] }).every(([, s]) => s === 'done')).toBe(true);
  });

  it('uma rede que falhou não derruba as outras e só ela oferece tentar de novo', () => {
    const rows = networkRows({ ...base, status: 'ready', pendingChannels: ['instagram'], errors: { linkedin: 'modelo fora do ar' } });
    expect(rows.map((r) => [r.id, r.state, r.canRetry])).toEqual([['core', 'done', false], ['instagram', 'done', false], ['linkedin', 'fail', true], ['review', 'done', false]]);
    expect(rows[2].error).toBe('modelo fora do ar');
    expect(rows[2].sub).toContain('As outras redes estão prontas');
    expect(failedNetworks(rows).map((r) => r.id)).toEqual(['linkedin']);
  });

  it('rede pronta sem registro de erro e sem pendência (pedido antigo) também aparece como falha', () => {
    expect(view({ status: 'ready', pendingChannels: ['instagram'] })[2]).toEqual(['linkedin', 'fail']);
  });

  it('o X ainda não tem tentar de novo por rede', () => {
    const rows = networkRows({ ...base, status: 'ready', channels: ['instagram', 'twitter'], pendingChannels: ['instagram'], errors: { twitter: 'x' } });
    expect(rows[2]).toMatchObject({ id: 'twitter', state: 'fail', canRetry: false });
  });

  it('pedido que falhou inteiro: as redes que não começaram ficam por fazer', () => {
    expect(view({ status: 'failed' })).toEqual([['core', 'todo'], ['instagram', 'fail'], ['linkedin', 'todo'], ['review', 'todo']]);
  });
});
