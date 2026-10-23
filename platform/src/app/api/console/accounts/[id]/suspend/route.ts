import { NextResponse } from 'next/server';
import { badRequest } from '@/lib/api';
import { suspendAccount } from '@/lib/console-accounts';
import { consoleError } from '@/lib/console-api';
import { isAccountId, parseSuspend } from '@/lib/console-model';
import { requirePlatformAdmin } from '@/lib/platform-admin';

// Suspender uma conta: ninguém da conta entra e nada é publicado até reativar. Motivo obrigatório.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requirePlatformAdmin();
    const { id } = await ctx.params;
    if (!isAccountId(id)) return badRequest('Conta inválida. Volte para a lista e escolha de novo.');
    const parsed = parseSuspend(await req.json().catch(() => null));
    if (!parsed.ok) return badRequest(parsed.error);
    await suspendAccount(id, admin.user.id, parsed.value.reason);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return consoleError(e, 'api/console/accounts/suspend');
  }
}
