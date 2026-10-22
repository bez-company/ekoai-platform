import { NextResponse } from 'next/server';
import { requireUserPermission } from '@/lib/session';
import { disconnectSocialAccount } from '@/lib/social-accounts';
import { isUuid } from '@/lib/route-input';
import { track } from '@/lib/analytics';
import { apiError, badRequest } from '@/lib/api';

// Desconectar uma rede: marca a conta como revogada e apaga o token guardado.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { t, user } = await requireUserPermission('channels.manage');
    const { id } = await params;
    if (!isUuid(id)) return badRequest('Conta inválida. Recarregue a página.');
    const removed = await disconnectSocialAccount(t, user.id, id);
    if (!removed) return NextResponse.json({ error: 'Essa conexão já foi removida. Recarregue a página.' }, { status: 404 });
    await track(t.tenantId, 'instagram_disconnected');
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e, 'api/social-accounts/[id]');
  }
}
