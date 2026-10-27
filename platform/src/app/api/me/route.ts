import { NextResponse } from 'next/server';
import { renameUser, setUserPhone } from '@/lib/accounts';
import { badRequest, apiError } from '@/lib/api';
import { parseOptionalPhone, parsePersonName } from '@/lib/person-profile-model';
import { requireUserPermission } from '@/lib/session';

// Seu perfil (BEZ-304): a pessoa muda o próprio nome e o celular de contato. Vale para todas as contas
// dela. Qualquer papel com acesso à conta chama; o id vem da sessão, nunca do corpo.
export async function PUT(req: Request) {
  try {
    const { user } = await requireUserPermission('content.view');
    const body = await req.json().catch(() => null);
    const parsed = parsePersonName(body);
    if (!parsed.ok) return badRequest(parsed.error);
    const phone = parseOptionalPhone(body && typeof body === 'object' ? (body as Record<string, unknown>).phone : undefined);
    if (!phone.ok) return badRequest(phone.error);
    await renameUser(user.id, parsed.value.name);
    await setUserPhone(user.id, phone.value);
    return NextResponse.json({ ok: true, name: parsed.value.name, phone: phone.value });
  } catch (e) {
    return apiError(e, 'api/me');
  }
}
