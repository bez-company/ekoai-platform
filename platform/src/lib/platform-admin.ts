// platform-admin.ts: o portão do console do administrador da plataforma (ultra admin). Server-only.
// docs/arquitetura/ultra-admin.md: portões em série, qualquer "não" responde 404 (a rota some para quem
// não é a pessoa). Aqui valem quatro: sessão por pessoa, o e-mail confere com PLATFORM_ADMIN_EMAIL (sem a
// variável ninguém entra), o id está em `platform_admins` e, quando o ambiente exige duas etapas, a
// pessoa as tem ligadas. O IAP na frente do endereço entra com o Google Cloud.

import { notFound, redirect } from 'next/navigation';
import { db } from './db';
import { personProfiles, idpUidOf, type SessionUser } from './accounts';
import { hasSecondFactor } from './identity';
import { mfaMode } from './login-policy';
import { log } from './log';
import { UnauthorizedError, requireSession } from './session';

// "Não" do portão: a rota responde 404, sem dizer qual dos portões fechou (o motivo só vai para o log).
export class ConsoleDeniedError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super('Não encontrado');
    this.reason = reason;
  }
}

export type PlatformAdmin = { user: SessionUser; email: string };

// Compara o e-mail da sessão com a variável de ambiente, ignorando caixa e espaço.
export function emailMatches(configured: string | undefined, actual: string | null | undefined): boolean {
  const want = (configured ?? '').trim().toLowerCase();
  return want !== '' && !!actual && actual.trim().toLowerCase() === want;
}

export async function requirePlatformAdmin(): Promise<PlatformAdmin> {
  const ctx = await requireSession();
  const deny = (reason: string) => {
    log('warn', 'console', 'acesso negado ao console', { user: ctx.user?.id ?? null, reason });
    return new ConsoleDeniedError(reason);
  };
  if (!ctx.user) throw deny('sem login por pessoa');
  if (!process.env.PLATFORM_ADMIN_EMAIL?.trim()) throw deny('PLATFORM_ADMIN_EMAIL ausente');

  const email = (await personProfiles([ctx.user.id])).get(ctx.user.id)?.email ?? null;
  if (!emailMatches(process.env.PLATFORM_ADMIN_EMAIL, email)) throw deny('e-mail diferente');

  const { data, error } = await db().from('platform_admins').select('user_id').eq('user_id', ctx.user.id).maybeSingle();
  if (error) throw new Error(`platform_admins: ${error.message}`);
  if (!data) throw deny('fora de platform_admins');

  if (mfaMode() === 'required') {
    const uid = await idpUidOf(ctx.user.id);
    if (!uid || (await hasSecondFactor(uid)) !== true) throw deny('sem duas etapas');
  }
  return { user: ctx.user, email: email as string };
}

// Páginas: sessão vencida leva ao login; qualquer outro "não" é a página 404 normal.
export async function pageConsole(): Promise<PlatformAdmin> {
  try {
    return await requirePlatformAdmin();
  } catch (e) {
    if (e instanceof UnauthorizedError) redirect('/entrar');
    if (e instanceof ConsoleDeniedError) notFound();
    throw e;
  }
}
