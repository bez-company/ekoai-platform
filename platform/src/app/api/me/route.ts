import { NextResponse } from 'next/server';
import { renameUser } from '@/lib/accounts';
import { badRequest, apiError } from '@/lib/api';
import { parsePersonName } from '@/lib/person-profile-model';
import { requireUserPermission } from '@/lib/session';

// Seu perfil (BEZ-304): a pessoa muda o próprio nome. Vale para todas as contas dela. Qualquer papel
// com acesso à conta chama; o id vem da sessão, nunca do corpo.
export async function PUT(req: Request) {
  try {
    const { user } = await requireUserPermission('content.view');
    const parsed = parsePersonName(await req.json().catch(() => null));
    if (!parsed.ok) return badRequest(parsed.error);
    await renameUser(user.id, parsed.value.name);
    return NextResponse.json({ ok: true, name: parsed.value.name });
  } catch (e) {
    return apiError(e, 'api/me');
  }
}
