import { describe, it, expect } from 'vitest';
import * as f from '../platform/src/lib/auth-flow.ts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('mensagens de erro do Firebase', () => {
  it('senha errada e e-mail desconhecido dizem a mesma coisa', () => {
    const a = f.firebaseMessage('auth/invalid-credential');
    expect(f.firebaseMessage('auth/wrong-password')).toBe(a);
    expect(f.firebaseMessage('auth/user-not-found')).toBe(a);
    expect(a).toMatch(/redefina a senha/);
  });

  it('cada erro conhecido diz o que houve e o próximo passo; o resto é neutro', () => {
    for (const code of ['auth/email-already-in-use', 'auth/too-many-requests', 'auth/network-request-failed', 'auth/invalid-verification-code', 'auth/requires-recent-login', 'auth/weak-password']) {
      expect(f.firebaseMessage(code)).not.toBe(f.GENERIC_AUTH_ERROR);
    }
    for (const bad of ['auth/coisa-nova', '', undefined, null, 42]) expect(f.firebaseMessage(bad)).toBe(f.GENERIC_AUTH_ERROR);
  });

  it('nenhuma mensagem tem travessão, "Oops" nem culpa', () => {
    const src = readFileSync(join(import.meta.dirname, '../platform/src/lib/auth-flow.ts'), 'utf8');
    expect(src).not.toMatch(/—|–/);
    expect(src).not.toMatch(/Oops|Ops!/i);
  });

  it('lê o código de qualquer forma de erro', () => {
    expect(f.errorCode({ code: 'auth/x' })).toBe('auth/x');
    expect(f.errorCode(new Error('x'))).toBe('');
    expect(f.errorCode(null)).toBe('');
    expect(f.errorCode({ code: 5 })).toBe('');
  });
});

describe('o que a tela faz depois da sessão', () => {
  it('200 conclui', () => expect(f.sessionOutcome(200, {}, false)).toEqual({ kind: 'done' }));

  it('administrador sem segundo fator vai ativar as duas etapas', () => {
    expect(f.sessionOutcome(403, { code: 'mfa_required' }, false)).toEqual({ kind: 'mfa-setup' });
  });

  it('sem acesso: cria a conta com cadastro aberto; fechado, mostra a mensagem do servidor', () => {
    expect(f.sessionOutcome(403, { code: 'no_access', error: 'Peça um convite.' }, true)).toEqual({ kind: 'create-account' });
    expect(f.sessionOutcome(403, { code: 'no_access', error: 'Peça um convite.' }, false)).toEqual({ kind: 'fail', message: 'Peça um convite.' });
  });

  it('e-mail ainda não confirmado volta para a confirmação', () => {
    expect(f.sessionOutcome(403, { code: 'email_not_verified' }, false)).toEqual({ kind: 'verify' });
  });

  it('login velho ou token inválido recomeça com a mensagem', () => {
    expect(f.sessionOutcome(401, { code: 'login_stale', error: 'Entre de novo.' }, false)).toEqual({ kind: 'restart', message: 'Entre de novo.' });
    expect(f.sessionOutcome(401, { code: 'invalid_token', error: 'x' }, false).kind).toBe('restart');
  });

  it('o resto falha com a mensagem do servidor, ou uma neutra', () => {
    expect(f.sessionOutcome(403, { code: 'not_member', error: 'Escolha outra conta.' }, false)).toEqual({ kind: 'fail', message: 'Escolha outra conta.' });
    expect(f.sessionOutcome(500, {}, false)).toEqual({ kind: 'fail', message: f.GENERIC_AUTH_ERROR });
  });

  it('criar conta: 201 conclui, falta de segundo fator volta para ativar, limite mostra o erro', () => {
    expect(f.accountOutcome(201, {})).toEqual({ kind: 'done' });
    expect(f.accountOutcome(403, { code: 'mfa_required' })).toEqual({ kind: 'mfa-setup' });
    expect(f.accountOutcome(403, { code: 'account_limit', error: 'Você já administra 5 contas.' })).toEqual({ kind: 'fail', message: 'Você já administra 5 contas.' });
    expect(f.accountOutcome(401, { code: 'login_stale', error: 'x' }).kind).toBe('restart');
  });
});

describe('senha do cadastro', () => {
  it('exige tamanho, letra, número e diferença do e-mail', () => {
    expect(f.passwordOk('docinho2026', 'ana@x.com')).toBe(true);
    expect(f.passwordOk('curta1', 'ana@x.com')).toBe(false);
    expect(f.passwordOk('somenteletras', 'ana@x.com')).toBe(false);
    expect(f.passwordOk('1234567890', 'ana@x.com')).toBe(false);
    expect(f.passwordOk('ana@x.com', 'ANA@x.com')).toBe(false);
  });

  it('as regras mostram o que falta, na ordem da tela', () => {
    const rules = f.passwordRules('abc', 'ana@x.com');
    expect(rules.map((r) => r.ok)).toEqual([false, false, true]);
    expect(rules[0].label).toMatch(/10 caracteres/);
  });

  it('valida o formato do e-mail', () => {
    expect(f.isEmail('ana@empresa.com.br')).toBe(true);
    for (const bad of ['', 'ana', 'ana@', '@x.com', 'a b@x.com', `${'a'.repeat(250)}@x.com`]) expect(f.isEmail(bad)).toBe(false);
  });
});

describe('código do app autenticador', () => {
  it('só dígitos, no máximo 6', () => {
    expect(f.cleanOtp('12 34-56')).toBe('123456');
    expect(f.cleanOtp('1234567890')).toBe('123456');
    expect(f.cleanOtp('abc')).toBe('');
  });

  it('a chave sai em grupos de 4 para digitar sem errar', () => {
    expect(f.groupSecret('JBSWY3DPEHPK3PXP')).toBe('JBSW Y3DP EHPK 3PXP');
    expect(f.groupSecret('JBSWY3')).toBe('JBSW Y3');
  });
});

describe('para onde ir depois do login', () => {
  it('só caminhos da própria plataforma', () => {
    expect(f.safeNext('/settings')).toBe('/settings');
    expect(f.safeNext('/inbox/abc?x=1')).toBe('/inbox/abc?x=1');
    for (const bad of ['https://evil.com', '//evil.com', '/\\evil.com', 'javascript:alert(1)', 'evil', '', null, undefined]) {
      expect(f.safeNext(bad)).toBe('/');
    }
  });
});

describe('contagem para reenviar', () => {
  it('mostra minutos e segundos e nunca fica negativa', () => {
    expect(f.countdown(42)).toBe('0:42');
    expect(f.countdown(60)).toBe('1:00');
    expect(f.countdown(0.2)).toBe('0:01');
    expect(f.countdown(-5)).toBe('0:00');
  });
});

describe('o que a tela faz depois de aceitar o convite', () => {
  it('200 conclui e 202 (aceitou, falta o segundo fator) leva a ativar as duas etapas', () => {
    expect(f.acceptOutcome(200, {})).toEqual({ kind: 'done' });
    expect(f.acceptOutcome(202, { accepted: true, code: 'mfa_required' })).toEqual({ kind: 'mfa-setup' });
  });

  it('quem já é da conta segue pelo login normal', () => {
    expect(f.acceptOutcome(409, { code: 'already_member', error: 'x' })).toEqual({ kind: 'continue-login' });
  });

  it('e-mail diferente do convite mostra a tela própria, com a mensagem', () => {
    expect(f.acceptOutcome(403, { code: 'invite_email_mismatch', error: 'Saia e entre com o e-mail do convite.' })).toEqual({ kind: 'wrong-account', message: 'Saia e entre com o e-mail do convite.' });
  });

  it('convite que fechou no meio do caminho volta ao login com a mensagem', () => {
    for (const code of ['invite_not_found', 'invite_cancelled', 'invite_used', 'invite_expired']) {
      expect(f.acceptOutcome(410, { code, error: 'fechado' })).toEqual({ kind: 'invite-closed', message: 'fechado' });
    }
  });

  it('e-mail não confirmado e login velho seguem as mesmas regras do login', () => {
    expect(f.acceptOutcome(403, { code: 'email_not_verified' })).toEqual({ kind: 'verify' });
    expect(f.acceptOutcome(401, { code: 'login_stale', error: 'x' }).kind).toBe('restart');
    expect(f.acceptOutcome(500, {})).toEqual({ kind: 'fail', message: f.GENERIC_AUTH_ERROR });
  });
});

describe('texto do convite', () => {
  it('cada papel tem rótulo e uma frase do que pode', () => {
    expect(Object.keys(f.ROLE_COPY).sort()).toEqual(['admin', 'creator', 'viewer']);
    for (const r of Object.values(f.ROLE_COPY)) {
      expect(r.label).toBeTruthy();
      expect(r.what).toMatch(/\.$/);
    }
  });

  it('dias até vencer: inteiros para cima e nunca negativos', () => {
    const now = Date.UTC(2026, 9, 20, 12);
    expect(f.daysLeft(new Date(now + 5 * 86_400_000).toISOString(), now)).toBe(5);
    expect(f.daysLeft(new Date(now + 5 * 86_400_000 - 3_600_000).toISOString(), now)).toBe(5);
    expect(f.daysLeft(new Date(now + 60_000).toISOString(), now)).toBe(1);
    expect(f.daysLeft(new Date(now - 1000).toISOString(), now)).toBe(0);
  });
});

