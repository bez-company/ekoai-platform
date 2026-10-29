import { describe, it, expect } from 'vitest';
import { EVAL_DEFAULT_PROJECT, assertBudget, budgetedClient, chargeEval, evalBudgetUsd, evalEnv, evalLabels, evalProject, evalSpentUsd, resetEvalSpend } from '../evals/guard.js';

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

describe('orçamento do eval (29/10/2026)', () => {
  it('o padrão é US$ 1 e valor inválido volta ao padrão', () => {
    expect(evalBudgetUsd({})).toBe(1);
    expect(evalBudgetUsd({ EVAL_BUDGET_USD: '5' })).toBe(5);
    expect(evalBudgetUsd({ EVAL_BUDGET_USD: 'abc' })).toBe(1);
    expect(evalBudgetUsd({ EVAL_BUDGET_USD: '-3' })).toBe(1);
  });

  it('passou do orçamento, a próxima chamada falha antes de gastar', () => {
    resetEvalSpend();
    assertBudget({});
    chargeEval(0.6);
    assertBudget({});
    chargeEval(0.5);
    expect(evalSpentUsd()).toBeCloseTo(1.1, 6);
    expect(() => assertBudget({})).toThrow(/Orçamento do eval esgotado/);
    expect(() => assertBudget({ EVAL_BUDGET_USD: '5' })).not.toThrow();
    resetEvalSpend();
  });

  it('o cliente embrulhado soma o custo de cada chamada e para no orçamento', async () => {
    resetEvalSpend();
    let calls = 0;
    const client = { config: {}, async generateText() { calls += 1; return { text: 'x', costUsd: 0.4 }; }, async generateImage() { calls += 1; return { png: Buffer.from('x'), costUsd: 0.4 }; }, async generateJson() { calls += 1; return { json: {}, costUsd: 0.4 }; } };
    const guarded = budgetedClient(client, { EVAL_BUDGET_USD: '1' });
    await guarded.generateText({});
    await guarded.generateImage({});
    await guarded.generateJson({});
    await expect(guarded.generateText({})).rejects.toThrow(/Orçamento do eval esgotado/);
    expect(calls).toBe(3);
    resetEvalSpend();
  });
});
