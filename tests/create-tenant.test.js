import { describe, it, expect } from 'vitest';
import { parseArgs, validate } from '../scripts/create-tenant.js';

describe('create-tenant', () => {
  it('lê --chave valor', () => {
    expect(parseArgs(['--id', 'acme', '--name', 'Acme Eng'])).toEqual({ id: 'acme', name: 'Acme Eng' });
  });

  it('aceita id e nome válidos', () => {
    expect(validate({ id: 'acme-eng', name: 'Acme' })).toBeNull();
  });

  it('recusa id fora do formato da tabela tenants', () => {
    for (const id of ['Acme', 'a', '-acme', 'acme_eng', 'x'.repeat(41), undefined, true]) {
      expect(validate({ id, name: 'Acme' })).toMatch(/--id/);
    }
  });

  it('o tipo da conta é empresa ou pessoa', () => {
    expect(validate({ id: 'acme', name: 'Acme', kind: 'pessoa' })).toBeNull();
    expect(validate({ id: 'acme', name: 'Acme', kind: 'empresa' })).toBeNull();
    expect(validate({ id: 'acme', name: 'Acme', kind: 'agencia' })).toMatch(/--kind/);
    expect(validate({ id: 'acme', name: 'Acme', kind: true })).toMatch(/--kind/);
  });

  it('recusa nome vazio', () => {
    expect(validate({ id: 'acme', name: '  ' })).toMatch(/--name/);
    expect(validate({ id: 'acme' })).toMatch(/--name/);
  });
});
