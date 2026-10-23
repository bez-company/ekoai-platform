// console-api.ts: resposta de erro das rotas do console. O "não" do portão é um 404 seco (a rota some
// para quem não é a pessoa); o resto segue o padrão de apiError.

import { NextResponse } from 'next/server';
import { apiError } from './api';
import { ConsoleDeniedError } from './platform-admin';

export function consoleError(e: unknown, scope: string): NextResponse {
  if (e instanceof ConsoleDeniedError) return NextResponse.json({ error: 'Não encontrado' }, { status: 404 });
  return apiError(e, scope);
}
