import { NextResponse } from 'next/server';
import { badRequest } from '@/lib/api';
import { reactivateAccount } from '@/lib/console-accounts';
import { consoleError } from '@/lib/console-api';
import { isAccountId } from '@/lib/console-model';
import { requirePlatformAdmin } from '@/lib/platform-admin';

// Reativar uma conta suspensa. O acesso volta; a publicação continua pausada até um administrador retomar.
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requirePlatformAdmin();
    const { id } = await ctx.params;
    if (!isAccountId(id)) return badRequest('Conta inválida. Volte para a lista e escolha de novo.');
    await reactivateAccount(id, admin.user.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return consoleError(e, 'api/console/accounts/reactivate');
  }
}
