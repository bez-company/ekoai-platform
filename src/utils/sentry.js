// sentry.js — envio de falha de job para o Sentry (projeto `ekoai` da BEZ). Só liga com
// SENTRY_DSN (Secret Manager nos Cloud Run Jobs); sem ele é no-op. Sem integração automática:
// o dispatcher (src/jobs.js) reporta o job que falhou, com o nome do job e o passo como tag.

import * as Sentry from '@sentry/node';

let started = false;

export function initSentry(env = process.env) {
  if (started) return false;
  const dsn = env.SENTRY_DSN?.trim();
  if (!dsn) return false;
  Sentry.init({
    dsn,
    environment: env.SENTRY_ENVIRONMENT || 'local',
    release: env.CLOUD_RUN_EXECUTION || undefined,
    defaultIntegrations: false,
    integrations: [Sentry.linkedErrorsIntegration(), Sentry.dedupeIntegration()],
    tracesSampleRate: 0,
    // Sem dado pessoal: na v11 o padrão coleta usuário, cookie, cabeçalho, corpo e variáveis locais.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
    },
  });
  started = true;
  return true;
}

export function captureJobFailure(job, error, extra = {}) {
  if (!started) return;
  Sentry.withScope(scope => {
    scope.setTag('job', job);
    scope.setExtras(extra);
    Sentry.captureException(error);
  });
}

export async function flushSentry(timeoutMs = 2000) {
  if (started) await Sentry.flush(timeoutMs);
}
