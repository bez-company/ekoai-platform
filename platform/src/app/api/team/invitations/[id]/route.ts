import { NextResponse } from 'next/server';
import { requireUserPermission } from '@/lib/session';
import { cancelInvitation } from '@/lib/team';
import { isUuid } from '@/lib/route-input';
import { apiError, badRequest } from '@/lib/api';

// Cancelar convite pendente.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { t, user } = await requireUserPermission('team.manage');
    const { id } = await params;
    if (!isUuid(id)) return badRequest('Convite inválido. Recarregue a página.');
    await cancelInvitation(t, user, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e, 'api/team/invitations/[id]');
  }
}
