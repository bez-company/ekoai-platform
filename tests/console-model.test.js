import { describe, it, expect } from 'vitest';
import { accountStatus, isAccountId, parseAccountQuery, parseCreateConsoleAccount, parseSuspend, REASON_MAX } from '../platform/src/lib/console-model.ts';
import { activeMemberships, pickTenant, suspensionRefusal } from '../platform/src/lib/login-policy.ts';

describe('accountStatus', () => {
  it('suspensa vale mais que pausada, e pausada mais que ativa', () => {
    expect(accountStatus({ status: 'active', paused: false })).toBe('active');
    expect(accountStatus({ status: 'active', paused: true })).toBe('paused');
    expect(accountStatus({ status: 'suspended', paused: true })).toBe('suspended');
    expect(accountStatus({ status: 'suspended', paused: false })).toBe('suspended');
  });
});

describe('parseAccountQuery', () => {
  it('lê busca e status da URL, limpando o texto', () => {
    expect(parseAccountQuery({ q: '  doce   ponto ', status: 'suspended' })).toEqual({ search: 'doce ponto', status: 'suspended' });
  });

  it('valor desconhecido ou de outro tipo volta ao padrão', () => {
    expect(parseAccountQuery({ q: ['a', 'b'], status: 'qualquer' })).toEqual({ search: '', status: 'all' });
    expect(parseAccountQuery({})).toEqual({ search: '', status: 'all' });
    expect(parseAccountQuery({ q: 'x'.repeat(500) }).search).toHaveLength(80);
  });
});

describe('parseCreateConsoleAccount', () => {
  const ok = { name: '  Doce  Ponto ', kind: 'empresa', email: ' Ana@DocePonto.com.br ' };

  it('normaliza nome e e-mail', () => {
    expect(parseCreateConsoleAccount(ok)).toEqual({ ok: true, value: { name: 'Doce Ponto', kind: 'empresa', email: 'ana@doceponto.com.br' } });
  });

  it('cada recusa diz o que falta', () => {
    expect(parseCreateConsoleAccount({ ...ok, name: '  ' })).toMatchObject({ ok: false, error: 'Dê um nome para a conta.' });
    expect(parseCreateConsoleAccount({ ...ok, name: 'a'.repeat(81) }).error).toMatch(/até 80/);
    expect(parseCreateConsoleAccount({ ...ok, kind: 'grupo' }).error).toMatch(/empresa ou de uma pessoa/);
    expect(parseCreateConsoleAccount({ ...ok, email: 'sem-arroba' }).error).toMatch(/e-mail completo/);
    expect(parseCreateConsoleAccount({ ...ok, email: `${'a'.repeat(250)}@x.com` }).ok).toBe(false);
    expect(parseCreateConsoleAccount(null).ok).toBe(false);
    expect(parseCreateConsoleAccount([]).ok).toBe(false);
  });
});

describe('parseSuspend', () => {
  it('exige um motivo de verdade', () => {
    expect(parseSuspend({ reason: '  Pagamento   em atraso ' })).toEqual({ ok: true, value: { reason: 'Pagamento em atraso' } });
    for (const body of [null, {}, { reason: '' }, { reason: '   ' }, { reason: 'ok' }, { reason: 42 }]) {
      expect(parseSuspend(body).ok, JSON.stringify(body)).toBe(false);
    }
    expect(parseSuspend({ reason: 'a'.repeat(REASON_MAX + 1) }).error).toMatch(/até 500/);
  });
});

describe('isAccountId', () => {
  it('aceita só o formato da tabela tenants', () => {
    expect(isAccountId('doce-ponto')).toBe(true);
    for (const bad of ['', 'A', '-x', 'x'.repeat(41), 'a b', "x'; drop", undefined, 3]) expect(isAccountId(bad), String(bad)).toBe(false);
  });
});

describe('suspensão no login', () => {
  const m = (tenantId, suspended) => ({ tenantId, role: 'admin', createdAt: '2026-10-01', suspended });

  it('só avisa "suspensa" quando todas as contas da pessoa estão suspensas', () => {
    expect(suspensionRefusal([m('a', true)])).toMatchObject({ status: 403, code: 'account_suspended' });
    expect(suspensionRefusal([m('a', true), m('b', true)])?.code).toBe('account_suspended');
    expect(suspensionRefusal([m('a', true), m('b', false)])).toBeNull();
    expect(suspensionRefusal([])).toBeNull();
  });

  it('a conta escolhida sai só das ativas', () => {
    const all = [m('a', true), m('b', false)];
    expect(activeMemberships(all).map((x) => x.tenantId)).toEqual(['b']);
    expect(pickTenant(activeMemberships(all), undefined, 'a')).toEqual({ tenantId: 'b', role: 'admin' });
    expect(pickTenant(activeMemberships(all), 'a', null)).toMatchObject({ code: 'not_member' });
  });
});
