import { NextResponse } from 'next/server';
import { requireUserPermission } from '@/lib/session';
import { parseRoleChange } from '@/lib/invitation-model';
import { changeRole, removeMember } from '@/lib/team';
import { isUuid } from '@/lib/route-input';
import { apiError, badRequest } from '@/lib/api';

// Mudar o papel de alguém da equipe. O banco barra rebaixar o último administrador.
export async function PATCH(req: Request, { params }: { params: Promise<{ userId: string }> }) {
  try {
    const { t, user } = await requireUserPermission('team.manage');
    const { userId } = await params;
    if (!isUuid(userId)) return badRequest('Pessoa inválida. Recarregue a página.');
    const parsed = parseRoleChange(await req.json().catch(() => null));
    if (!parsed.ok) return badRequest(parsed.error);
    await changeRole(t, user, userId, parsed.value.role);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e, 'api/team/members/[userId]');
  }
}

// Tirar alguém da equipe: o acesso cai na próxima requisição da pessoa.
export async function DELETE(_req: Request, { params }: { params: Promise<{ userId: string }> }) {
  try {
    const { t, user } = await requireUserPermission('team.manage');
    const { userId } = await params;
    if (!isUuid(userId)) return badRequest('Pessoa inválida. Recarregue a página.');
    await removeMember(t, user, userId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e, 'api/team/members/[userId]');
  }
}
