import { NextResponse } from 'next/server';
import { badRequest } from '@/lib/api';
import { endAccountDiscount, setAccountDiscount } from '@/lib/console-discounts';
import { consoleError } from '@/lib/console-api';
import { isAccountId } from '@/lib/console-model';
import { dayOf, parseDiscount } from '@/lib/price-model';
import { requirePlatformAdmin } from '@/lib/platform-admin';

// Aplicar um desconto de preço à conta (SPEC 032): percentual sobre o preço de lista, a partir de hoje, com motivo e fim opcional. Substitui o
// que valia. Só a administradora da plataforma. A auditoria guarda só que mudou, sem os valores.
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requirePlatformAdmin();
    const { id } = await ctx.params;
    if (!isAccountId(id)) return badRequest('Conta inválida. Volte para a lista e escolha de novo.');
    const parsed = parseDiscount(await req.json().catch(() => null), dayOf(new Date()));
    if (!parsed.ok) return badRequest(parsed.error);
    await setAccountDiscount(id, parsed.value, admin.user.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return consoleError(e, 'api/console/accounts/discount');
  }
}

// Encerrar o desconto: os posts dele mantêm o preço; os novos voltam ao preço de lista.
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requirePlatformAdmin();
    const { id } = await ctx.params;
    if (!isAccountId(id)) return badRequest('Conta inválida. Volte para a lista e escolha de novo.');
    await endAccountDiscount(id, admin.user.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return consoleError(e, 'api/console/accounts/discount');
  }
}
