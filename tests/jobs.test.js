import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { JOBS, stepsFor } from '../src/jobs.js';

describe('jobs (Cloud Run Jobs)', () => {
  it('todo passo aponta para um script que existe', () => {
    for (const [name, steps] of Object.entries(JOBS)) {
      for (const { step } of steps) expect(existsSync(step[0]), `${name}: ${step[0]}`).toBe(true);
    }
  });

  it('post monta o índice antes de gerar, menos em DRY_RUN', () => {
    expect(stepsFor('post', {})).toEqual([['src/build-index.js'], ['src/index.js']]);
    expect(stepsFor('post', { DRY_RUN: 'true' })).toEqual([['src/index.js']]);
  });

  it('token-health é o refresh-tokens em modo check', () => {
    expect(stepsFor('token-health')).toEqual([['src/refresh-tokens.js', 'check']]);
  });

  it('nome desconhecido lista os disponíveis', () => {
    expect(() => stepsFor('nada')).toThrow(/Disponíveis: post, resolve/);
  });

  it('cobre os workflows que o GitHub Actions rodava', () => {
    for (const name of ['post', 'resolve', 'reflect', 'refresh-tokens', 'token-health', 'weekly-report', 'funnel']) {
      expect(JOBS[name]).toBeDefined();
    }
  });
});
