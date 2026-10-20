// api.ts: resposta de erro padrão das rotas. Sessão vencida = 401; papel sem permissão = 403;
// erro de domínio = 400 com a mensagem; o resto = 500 neutro, com o detalhe só no log.

import { NextResponse } from 'next/server';
import { UserError, GENERIC_ERROR, userMessage } from './errors';
import { ForbiddenError, UnauthorizedError } from './session';
import { log, logError } from './log';

export function apiError(e: unknown, scope: string): NextResponse {
  if (e instanceof UnauthorizedError) return NextResponse.json({ error: e.message }, { status: 401 });
  if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
  if (e instanceof UserError) return NextResponse.json({ error: e.message }, { status: 400 });
  logError(scope, e);
  return NextResponse.json({ error: GENERIC_ERROR }, { status: 500 });
}

export function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 });
}

// Páginas: mesma regra das rotas, devolvendo o texto que a tela mostra.
export function pageError(e: unknown, scope: string): string {
  if (!(e instanceof UserError)) logError(scope, e);
  return userMessage(e);
}

// Resposta quando o ID token não passa. A pessoa recebe sempre a mesma mensagem; o motivo técnico vai
// para o log: aviso quando é rotina (vencido, revogado), erro (e Sentry) quando é problema nosso, como
// a conta de serviço sem leitura do Firebase Auth, que antes derrubava todo login sem deixar rastro.
export function invalidTokenResponse(scope: string, e: Error & { code?: string; routine?: boolean }): NextResponse {
  if (e.routine) log('warn', scope, 'ID token recusado', { reason: e.message, code: e.code });
  else logError(scope, e, { code: e.code });
  return NextResponse.json({ error: 'Não deu para confirmar o login. Entre de novo.', code: 'invalid_token' }, { status: 401 });
}

