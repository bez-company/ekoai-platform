import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { JOBS, stepsFor } from '../src/jobs.js';

describe('jobs (Cloud Run Jobs)', () => {
  it('todo passo aponta para um script que existe', () => {
    for (const [name, steps] of Object.entries(JOBS)) {
      for (const { step } of steps) expect(existsSync(step[0]), `${name}: ${step[0]}`).toBe(true);
    }
  });

  it('token-health é o refresh-tokens em modo check', () => {
    expect(stepsFor('token-health', { TENANT_ID: 'acme' })).toEqual([['src/refresh-tokens.js', 'check']]);
  });

  it('job de conta sem TENANT_ID não começa; migrate não precisa de conta', () => {
    for (const name of ['refresh-tokens', 'token-health', 'weekly-report']) {
      expect(() => stepsFor(name, {}), name).toThrow(/TENANT_ID não definido/);
    }
    expect(stepsFor('migrate', {})).toEqual([['scripts/migrate.js']]);
  });

  it('tenant-create e access-grant repassam os argumentos e não pedem conta', () => {
    expect(stepsFor('tenant-create', {}, ['--id', 'acme', '--name', 'Acme'])).toEqual([['scripts/create-tenant.js', '--id', 'acme', '--name', 'Acme']]);
    expect(stepsFor('access-grant', {}, ['--email', 'a@b.co'])).toEqual([['scripts/grant-access.js', '--email', 'a@b.co']]);
    // os jobs comuns ignoram argumento extra
    expect(stepsFor('migrate', {}, ['--x'])).toEqual([['scripts/migrate.js']]);
  });

  it('nome desconhecido lista os disponíveis', () => {
    expect(() => stepsFor('nada')).toThrow(/Disponíveis: refresh-tokens, token-health/);
  });

  it('os jobs de geração saíram até a fase 2 (ADR 0010)', () => {
    for (const name of ['post', 'resolve', 'reflect', 'funnel', 'engage', 'repurpose', 'reel']) {
      expect(JOBS[name]).toBeUndefined();
    }
  });
});
