import { describe, it, expect } from 'vitest';
import { currentTenantId } from '../src/tenant.js';

describe('conta do job (src/tenant.js)', () => {
  it('lê o TENANT_ID do ambiente', () => {
    expect(currentTenantId({ TENANT_ID: 'acme' })).toBe('acme');
  });

  it('sem TENANT_ID falha na largada, sem queda padrão (ADR 0010)', () => {
    expect(() => currentTenantId({})).toThrow(/TENANT_ID não definido/);
  });

  it('recusa id fora do formato da tabela tenants', () => {
    for (const bad of ['A', 'Conta Ruim', '-acme', 'x'.repeat(41)]) {
      expect(() => currentTenantId({ TENANT_ID: bad }), bad).toThrow(/inválido/);
    }
  });
});
