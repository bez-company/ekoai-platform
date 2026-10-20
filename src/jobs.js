// jobs.js — ponto de entrada dos Cloud Run Jobs (SPEC 010). Uma imagem só; cada job do Cloud Run
// passa o nome no argumento (`node src/jobs.js weekly-report`). Os passos rodam em sequência, cada um em
// seu processo, e o primeiro que falhar derruba o job com o mesmo código de saída.
//
// Os horários moram no Cloud Scheduler (infra/terraform), um por job. Os jobs de geração (post,
// resolve, reflect, funnel, engage, repurpose, reel) saíram com o ADR 0010 e voltam na fase 2.

import { spawn } from 'node:child_process';
import { currentTenantId } from './tenant.js';
import { initSentry, captureJobFailure, flushSentry } from './utils/sentry.js';

// [script, ...argumentos]. `when` filtra o passo pelo ambiente.
export const JOBS = {
  'refresh-tokens': [{ step: ['src/refresh-tokens.js'] }],
  'token-health': [{ step: ['src/refresh-tokens.js', 'check'] }],
  'weekly-report': [{ step: ['src/metrics.js'] }],
  migrate: [{ step: ['scripts/migrate.js'] }],
  // Operação de sistema, sem agenda: recebem os argumentos do `gcloud run jobs execute --args`
  // (ex.: tenant-create,--id,acme,--name,Acme). O banco é privado, então é por aqui que se
  // cria a conta e se dá o primeiro acesso.
  'tenant-create': [{ step: ['scripts/create-tenant.js'], passArgs: true }],
  'access-grant': [{ step: ['scripts/grant-access.js'], passArgs: true }],
  'platform-admin': [{ step: ['scripts/platform-admin.js'], passArgs: true }],
};

// Jobs que leem ou gravam dado de uma conta. Sem TENANT_ID válido não começam (ADR 0010).
const TENANT_JOBS = new Set(['refresh-tokens', 'token-health', 'weekly-report']);

export function stepsFor(name, env = process.env, extraArgs = []) {
  const job = JOBS[name];
  if (!job) throw new Error(`Job desconhecido: "${name}". Disponíveis: ${Object.keys(JOBS).join(', ')}`);
  if (TENANT_JOBS.has(name)) currentTenantId(env);
  return job
    .filter(({ when }) => !when || when(env))
    .map(({ step, passArgs }) => (passArgs ? [...step, ...extraArgs] : step));
}

function run(step) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, step, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code, signal) => (code === 0 ? resolve() : reject(Object.assign(new Error(`${step.join(' ')} saiu com ${signal ?? code}`), { code: code ?? 1 }))));
  });
}

async function main() {
  const name = process.argv[2];
  initSentry();
  try {
    for (const step of stepsFor(name, process.env, process.argv.slice(3))) await run(step);
  } catch (err) {
    console.error(`[jobs] ${name}: ${err.message}`);
    // Nome desconhecido é erro de quem chamou, não do job: não vira issue.
    if (!/^Job desconhecido/.test(err.message)) captureJobFailure(name, err, { exitCode: err.code ?? 1 });
    await flushSentry();
    process.exit(err.code ?? 1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
