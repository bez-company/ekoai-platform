// session.ts: quem está logado, em qual conta e com que papel. Server-only (lê o cookie).
// Dois modos (SPEC 009): senha única, em que a sessão é da instalação e vale como admin; e por
// pessoa, em que cada requisição confere no banco a versão da sessão e a membership.

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, authProvider, verifySessionToken } from './auth';
import { tenantDb, type TenantDb } from './tenant-db';
import { hasPermission, roleIn, sessionUser, type SessionUser } from './accounts';
import type { Permission, Role } from './permissions';
import { UserError } from './errors';

export class UnauthorizedError extends Error {
  constructor() {
    super('Sua sessão expirou. Entre de novo.');
  }
}

export class ForbiddenError extends Error {
  constructor() {
    super('Seu papel nesta conta não permite essa ação. Peça a um administrador.');
  }
}

export type SessionContext = { t: TenantDb; role: Role; user: SessionUser | null };

export async function requireSession(): Promise<SessionContext> {
  const store = await cookies();
  const session = await verifySessionToken(store.get(SESSION_COOKIE)?.value);
  if (!session) throw new UnauthorizedError();
  const provider = authProvider();

  if (!session.userId) {
    if (provider !== 'password') throw new UnauthorizedError();
    return { t: tenantDb(session.tenantId), role: 'admin', user: null };
  }

  if (provider !== 'identity') throw new UnauthorizedError();
  const user = await sessionUser(session.userId);
  if (!user || user.sessionVersion !== session.sessionVersion) throw new UnauthorizedError();
  const role = await roleIn(user.id, session.tenantId);
  if (!role) throw new UnauthorizedError();
  return { t: tenantDb(session.tenantId), role, user };
}

// Toda rota da API passa por aqui com a permissão que a ação exige (SPEC 009).
export async function requirePermission(permission: Permission): Promise<TenantDb> {
  const ctx = await requireSession();
  if (ctx.user && !(await hasPermission(ctx.role, ctx.t.tenantId, permission))) throw new ForbiddenError();
  return ctx.t;
}

// Ações que precisam saber QUEM fez (equipe, convites): exige a permissão e devolve a pessoa. No
// login de senha única não há pessoa, então essas ações não existem lá.
export async function requireUserPermission(permission: Permission): Promise<{ t: TenantDb; user: SessionUser }> {
  const ctx = await requireSession();
  if (!ctx.user) throw new UserError('A equipe só existe no login por pessoa.');
  if (!(await hasPermission(ctx.role, ctx.t.tenantId, permission))) throw new ForbiddenError();
  return { t: ctx.t, user: ctx.user };
}

export async function currentTenantId(): Promise<string> {
  return (await requireSession()).t.tenantId;
}

export async function requireTenant(): Promise<TenantDb> {
  return requirePermission('content.view');
}

// Páginas: sessão vencida leva ao login em vez de quebrar a tela.
export async function pageTenant(): Promise<TenantDb> {
  try {
    return await requireTenant();
  } catch (e) {
    if (e instanceof UnauthorizedError) redirect('/login');
    throw e;
  }
}
