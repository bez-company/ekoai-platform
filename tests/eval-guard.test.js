import { describe, it, expect } from 'vitest';
import { EVAL_DEFAULT_PROJECT, evalEnv, evalLabels, evalProject } from '../evals/guard.js';

describe('guard dos evals (BEZ-458)', () => {
  it('o padrão é o staging, nunca a produção', () => {
    expect(evalProject({})).toBe(EVAL_DEFAULT_PROJECT);
    expect(EVAL_DEFAULT_PROJECT).toBe('ekoai-staging');
  });

  it('o ekoai-prod só passa com EVAL_ALLOW_PROD=1', () => {
    expect(() => evalProject({ VERTEX_PROJECT_ID: 'ekoai-prod' })).toThrow(/ekoai-prod recusado/);
    expect(() => evalProject({ VERTEX_PROJECT_ID: 'ekoai-prod', EVAL_ALLOW_PROD: '0' })).toThrow(/recusado/);
    expect(evalProject({ VERTEX_PROJECT_ID: 'ekoai-prod', EVAL_ALLOW_PROD: '1' })).toBe('ekoai-prod');
  });

  it('outro projeto escolhido passa', () => {
    expect(evalProject({ VERTEX_PROJECT_ID: 'meu-teste' })).toBe('meu-teste');
  });

  it('o ambiente devolvido leva o projeto resolvido e o resto intacto', () => {
    expect(evalEnv({ EVAL_RUNS: '2' })).toEqual({ EVAL_RUNS: '2', VERTEX_PROJECT_ID: 'ekoai-staging' });
    expect(() => evalEnv({ VERTEX_PROJECT_ID: 'ekoai-prod' })).toThrow();
  });

  it('os labels marcam o eval e seguem a regra de valor do Google', () => {
    expect(evalLabels('studio-diretor', { run: 'Rodada 3/Marca X' })).toEqual({ origin: 'eval', step: 'studio-diretor', run: 'rodada-3-marca-x' });
    expect(evalLabels('x', { run: undefined, case: '' })).toEqual({ origin: 'eval', step: 'x' });
    expect(evalLabels('a'.repeat(80)).step).toHaveLength(63);
  });
});
