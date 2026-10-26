// sentry.ts: envio de erros do servidor para o Sentry (projeto `ekoai` da BEZ). Só liga com
// SENTRY_DSN (Secret Manager em produção); sem ele tudo aqui é no-op, como no desenvolvimento.
//
// Sem as integrações automáticas (OpenTelemetry): só os erros que o app captura de propósito, o
// que o Next reporta em `onRequestError` (instrumentation.ts) e o `logError`. Sem dado pessoal:
// e-mail, cookie e segredo saem mascarados pelo mesmo `scrub` do log.

import * as Sentry from '@sentry/node';
import { scrub } from './log';

let started = false;

export function initSentry(): void {
  if (started) return;
  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || 'local',
    release: process.env.K_REVISION,
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
}

// O Next empacota instrumentation.ts e as rotas em módulos separados (e o SDK pode ser uma cópia em
// cada um): este arquivo existe em mais de uma cópia e cada cópia liga o seu próprio cliente na
// primeira vez que precisa, em vez de depender do `register()` de outra.
export function captureError(error: unknown, scope: string, fields: Record<string, unknown> = {}): void {
  initSentry();
  if (!started) return;
  Sentry.withScope((s) => {
    s.setTag('scope', scope);
    s.setExtras(scrub(fields) as Record<string, unknown>);
    Sentry.captureException(error);
  });
}

// Antes de o processo morrer ou de a instância ser congelada.
export async function flushSentry(timeoutMs = 2000): Promise<void> {
  if (started) await Sentry.flush(timeoutMs);
}
