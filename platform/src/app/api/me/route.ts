import { NextResponse } from 'next/server';
import { renameUser, setUserPhone, setUserTermsAccepted } from '@/lib/accounts';
import { badRequest, apiError } from '@/lib/api';
import { parseTermsAccepted } from '@/lib/legal';
import { parseOptionalPhone, parsePersonName } from '@/lib/person-profile-model';
import { requireUserPermission } from '@/lib/session';

// Seu perfil (BEZ-304): a pessoa muda o próprio nome e o celular de contato (e, no cadastro, o aceite dos termos). Vale para todas as contas
// dela. Qualquer papel com acesso à conta chama; o id vem da sessão, nunca do corpo.
export async function PUT(req: Request) {
  try {
    const { user } = await requireUserPermission('content.view');
    const body = await req.json().catch(() => null);
    const parsed = parsePersonName(body);
    if (!parsed.ok) return badRequest(parsed.error);
    const phone = parseOptionalPhone(body && typeof body === 'object' ? (body as Record<string, unknown>).phone : undefined);
    if (!phone.ok) return badRequest(phone.error);
    const terms = parseTermsAccepted(body && typeof body === 'object' ? (body as Record<string, unknown>).termsVersion : undefined);
    if (!terms.ok) return badRequest(terms.error);
    await renameUser(user.id, parsed.value.name);
    await setUserPhone(user.id, phone.value);
    if (terms.value) await setUserTermsAccepted(user.id, terms.value);
    return NextResponse.json({ ok: true, name: parsed.value.name, phone: phone.value });
  } catch (e) {
    return apiError(e, 'api/me');
  }
}
