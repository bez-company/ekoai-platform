import { describe, it, expect } from 'vitest';
import * as m from '../platform/src/lib/account-deletion-model.ts';

const NOW = 1_800_000_000_000;
const id = (over = {}) => ({ uid: 'idp-a', email: 'ana@x.test', emailVerified: true, authTime: NOW / 1000 - 30, secondFactor: 'totp', name: 'Ana', ...over });

describe('confirmação pelo nome', () => {
  it('igualdade exata, só sem os espaços das pontas e repetidos', () => {
    expect(m.confirmationMatches('Doce Ponto Confeitaria', 'Doce Ponto Confeitaria')).toBe(true);
    expect(m.confirmationMatches('  Doce   Ponto  Confeitaria ', 'Doce Ponto Confeitaria')).toBe(true);
    expect(m.confirmationMatches('doce ponto confeitaria', 'Doce Ponto Confeitaria')).toBe(false);
    expect(m.confirmationMatches('Doce Ponto', 'Doce Ponto Confeitaria')).toBe(false);
    expect(m.confirmationMatches('Nutrição', 'Nutricao')).toBe(false);
  });

  it('nome da conta vazio nunca confere', () => {
    expect(m.confirmationMatches('', '')).toBe(false);
    expect(m.confirmationMatches('  ', '  ')).toBe(false);
  });
});

describe('corpo da exclusão', () => {
  const token = 'aaa.bbb.ccc';
  it('aceita nome e ID token com cara de token', () => {
    expect(m.parseDeleteBody({ confirmName: 'Doce', idToken: token })).toEqual({ ok: true, value: { confirmName: 'Doce', idToken: token } });
  });

  it('recusa sem nome, nome enorme, sem token ou token torto', () => {
    for (const body of [null, 'x', [], {}, { idToken: token }, { confirmName: '  ', idToken: token }, { confirmName: 'a'.repeat(201), idToken: token }]) {
      expect(m.parseDeleteBody(body).ok, JSON.stringify(body)).toBe(false);
    }
    expect(m.parseDeleteBody({ confirmName: 'Doce' }).error).toMatch(/senha e o código/);
    expect(m.parseDeleteBody({ confirmName: 'Doce', idToken: 'curto' }).ok).toBe(false);
    expect(m.parseDeleteBody({ confirmName: 'Doce', idToken: 12 }).ok).toBe(false);
  });
});

describe('reautenticação', () => {
  it('passa com a mesma pessoa, e-mail confirmado, segundo fator e poucos minutos', () => {
    expect(m.reauthRefusal(id(), 'idp-a', NOW)).toBeNull();
    expect(m.reauthRefusal(id({ authTime: NOW / 1000 - 299 }), 'idp-a', NOW)).toBeNull();
  });

  it('com MFA opcional a reautenticação por senha basta; o resto continua exigido', () => {
    expect(m.reauthRefusal(id({ secondFactor: null }), 'idp-a', NOW, 'optional')).toBeNull();
    expect(m.reauthRefusal(id({ secondFactor: null }), 'idp-a', NOW, 'required')).toBe('no_second_factor');
    expect(m.reauthRefusal(id({ secondFactor: null, uid: 'idp-b' }), 'idp-a', NOW, 'optional')).toBe('wrong_person');
    expect(m.reauthRefusal(id({ secondFactor: null, authTime: NOW / 1000 - 301 }), 'idp-a', NOW, 'optional')).toBe('stale');
    expect(m.reauthRefusal(id({ secondFactor: null, emailVerified: false }), 'idp-a', NOW, 'optional')).toBe('email_not_verified');
  });

  it('cada falha tem o seu motivo', () => {
    expect(m.reauthRefusal(id({ uid: 'idp-b' }), 'idp-a', NOW)).toBe('wrong_person');
    expect(m.reauthRefusal(id(), null, NOW)).toBe('wrong_person');
    expect(m.reauthRefusal(id({ emailVerified: false }), 'idp-a', NOW)).toBe('email_not_verified');
    expect(m.reauthRefusal(id({ secondFactor: null }), 'idp-a', NOW)).toBe('no_second_factor');
    expect(m.reauthRefusal(id({ authTime: NOW / 1000 - 301 }), 'idp-a', NOW)).toBe('stale');
    expect(m.reauthRefusal(id({ authTime: NOW / 1000 + 3600 }), 'idp-a', NOW)).toBe('stale');
  });

  it('o token do login de ontem, mesmo com segundo fator, não serve', () => {
    expect(m.reauthRefusal(id({ authTime: NOW / 1000 - 86_400 }), 'idp-a', NOW)).toBe('stale');
  });

  it('toda recusa tem mensagem em português com o próximo passo', () => {
    for (const k of ['wrong_person', 'email_not_verified', 'no_second_factor', 'stale']) expect(m.REAUTH_MESSAGES[k]).toMatch(/\.$/);
  });
});

describe('ordem de apagar', () => {
  it('filhos antes dos pais', () => {
    const order = m.deletionOrder(['posts', 'variants', 'profiles', 'assets'], [['variants', 'posts'], ['profiles', 'assets']]);
    expect(order.indexOf('variants')).toBeLessThan(order.indexOf('posts'));
    expect(order.indexOf('profiles')).toBeLessThan(order.indexOf('assets'));
    expect([...order].sort()).toEqual(['assets', 'posts', 'profiles', 'variants']);
  });

  it('cadeia de três e pai com vários filhos', () => {
    const order = m.deletionOrder(['a', 'b', 'c', 'd'], [['b', 'a'], ['c', 'b'], ['d', 'a']]);
    expect(order.indexOf('c')).toBeLessThan(order.indexOf('b'));
    expect(order.indexOf('b')).toBeLessThan(order.indexOf('a'));
    expect(order.indexOf('d')).toBeLessThan(order.indexOf('a'));
  });

  it('ignora autorreferência e tabela de fora da lista', () => {
    expect(m.deletionOrder(['a', 'b'], [['a', 'a'], ['a', 'tenants'], ['x', 'b']]).sort()).toEqual(['a', 'b']);
  });

  it('ciclo é erro, sem adivinhar', () => {
    expect(() => m.deletionOrder(['a', 'b'], [['a', 'b'], ['b', 'a']])).toThrow(/ciclo/);
  });

  it('é determinístico', () => {
    const edges = [['b', 'a']];
    expect(m.deletionOrder(['b', 'a', 'z'], edges)).toEqual(m.deletionOrder(['z', 'a', 'b'], edges));
  });
});
