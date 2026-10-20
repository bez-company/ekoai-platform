import { NextResponse } from 'next/server';
import { requireUserPermission, requirePermission } from '@/lib/session';
import { getProfile, saveSection } from '@/lib/company-profile';
import { parseProfileSection } from '@/lib/company-profile-model';
import { apiError } from '@/lib/api';

// O perfil da empresa: admin e criador leem; só quem tem brand.manage grava.
export async function GET() {
  try {
    const t = await requirePermission('profile.view');
    return NextResponse.json({ profile: await getProfile(t) });
  } catch (e) {
    return apiError(e, 'api/profile');
  }
}

// Grava uma seção por vez (sobre o negócio, jeito de falar, visual). O erro de campo volta com o
// nome do campo para a tela marcar o lugar certo.
export async function PUT(req: Request) {
  try {
    const { t, user } = await requireUserPermission('brand.manage');
    const parsed = parseProfileSection(await req.json().catch(() => null));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error, fields: parsed.fields }, { status: 400 });
    await saveSection(t, user, parsed);
    return NextResponse.json({ profile: await getProfile(t) });
  } catch (e) {
    return apiError(e, 'api/profile');
  }
}
