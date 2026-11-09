import { NextResponse } from 'next/server';
import { badRequest } from '@/lib/api';
import { parseAgencyToggle } from '@/lib/agency-model';
import { setAgencyOnAccount } from '@/lib/console-agency';
import { consoleError } from '@/lib/console-api';
import { isAccountId } from '@/lib/console-model';
import { requirePlatformAdmin } from '@/lib/platform-admin';

// Liga ou desliga o plano Agência de uma conta (SPEC 039, BEZ-265). Só o administrador da plataforma; fica na auditoria.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requirePlatformAdmin();
    const { id } = await ctx.params;
    if (!isAccountId(id)) return badRequest('Conta inválida. Volte para a lista e escolha de novo.');
    const parsed = parseAgencyToggle(await req.json().catch(() => null));
    if (!parsed.ok) return badRequest(parsed.error);
    await setAgencyOnAccount(id, admin.user.id, parsed.value.on);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return consoleError(e, 'api/console/accounts/agency');
  }
}
