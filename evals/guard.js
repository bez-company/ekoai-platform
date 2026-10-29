// guard.js: onde o eval pode gastar (BEZ-458). Os evals chamam o Vertex de verdade e uma rodada completa custa de
// dezenas a centenas de reais; rodar no projeto de produção mistura esse gasto com o dos clientes e come o orçamento e o
// crédito do teste. Por isso o padrão é o `ekoai-staging`, o `ekoai-prod` só com EVAL_ALLOW_PROD=1, e toda chamada
// leva labels (`origin=eval`, `step`) para o painel de custo (bez-platform, cost_ai) separar o eval do produto.

export const EVAL_DEFAULT_PROJECT = 'ekoai-staging';

export function evalProject(env = process.env) {
  const project = env.VERTEX_PROJECT_ID || EVAL_DEFAULT_PROJECT;
  if (project === 'ekoai-prod' && env.EVAL_ALLOW_PROD !== '1') {
    throw new Error(
      'Eval no ekoai-prod recusado: o gasto de IA de teste não pode ir para a conta de produção. Use o padrão (ekoai-staging) ou, se for de propósito, EVAL_ALLOW_PROD=1.',
    );
  }
  return project;
}

// O ambiente que o vertexConfig lê, já com o projeto resolvido.
export function evalEnv(env = process.env) {
  return { ...env, VERTEX_PROJECT_ID: evalProject(env) };
}

// Valor de label do Google: minúsculas, números, `_` e `-`, até 63 caracteres.
const clean = (v) => String(v).toLowerCase().replace(/[^a-z0-9_-]/g, '-').slice(0, 63);

export function evalLabels(step, extra = {}) {
  const labels = { origin: 'eval', step, ...extra };
  return Object.fromEntries(Object.entries(labels).filter(([, v]) => v != null && v !== '').map(([k, v]) => [k, clean(v)]));
}
