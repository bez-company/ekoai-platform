import { describe, it, expect } from 'vitest';
import { InvalidIdentityError } from '../platform/src/lib/identity.ts';

describe('InvalidIdentityError', () => {
  it('vencido, revogado, malformado e usuário desativado ou ausente são rotina', () => {
    for (const code of ['auth/id-token-expired', 'auth/id-token-revoked', 'auth/argument-error', 'auth/invalid-id-token', 'auth/user-disabled', 'auth/user-not-found']) {
      expect(new InvalidIdentityError('x', code).routine, code).toBe(true);
    }
  });

  it('permissão, erro interno, rede ou sem código NÃO são rotina: precisam aparecer como erro', () => {
    for (const code of ['auth/insufficient-permission', 'auth/internal-error', 'auth/network-error', 'app/network-error', 'auth/project-not-found', '']) {
      expect(new InvalidIdentityError('x', code).routine, code || '(sem código)').toBe(false);
    }
  });

  it('guarda a mensagem e o código', () => {
    const e = new InvalidIdentityError('motivo', 'auth/id-token-expired');
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toBe('motivo');
    expect(e.code).toBe('auth/id-token-expired');
  });
});
