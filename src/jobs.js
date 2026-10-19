// jobs.js — ponto de entrada dos Cloud Run Jobs (SPEC 010). Uma imagem só; cada job do Cloud Run
// passa o nome no argumento (`node src/jobs.js post`). Os passos rodam em sequência, cada um em
// seu processo, e o primeiro que falhar derruba o job com o mesmo código de saída.
//
// Os horários moram no Cloud Scheduler (infra/terraform), um por job, os mesmos dos workflows
// do GitHub Actions que este arquivo substitui.

import { spawn } from 'node:child_process';

// [script, ...argumentos]. `when` filtra o passo pelo ambiente.
export const JOBS = {
  post: [
    { step: ['src/build-index.js'], when: env => env.DRY_RUN !== 'true' },
    { step: ['src/index.js'] },
  ],
  resolve: [{ step: ['src/resolve.js'] }],
  reflect: [{ step: ['src/reflect.js'] }],
  'refresh-tokens': [{ step: ['src/refresh-tokens.js'] }],
  'token-health': [{ step: ['src/refresh-tokens.js', 'check'] }],
  'weekly-report': [{ step: ['src/metrics.js'] }],
  funnel: [{ step: ['src/funnel.js'] }],
  engage: [{ step: ['src/engage.js'] }],
  repurpose: [{ step: ['src/repurpose.js'] }],
  reel: [{ step: ['src/reel.js'] }],
  migrate: [{ step: ['scripts/migrate.js'] }],
};

export function stepsFor(name, env = process.env) {
  const job = JOBS[name];
  if (!job) throw new Error(`Job desconhecido: "${name}". Disponíveis: ${Object.keys(JOBS).join(', ')}`);
  return job.filter(({ when }) => !when || when(env)).map(({ step }) => step);
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
  try {
    for (const step of stepsFor(name)) await run(step);
  } catch (err) {
    console.error(`[jobs] ${name}: ${err.message}`);
    process.exit(err.code ?? 1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
