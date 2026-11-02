import { NextResponse } from 'next/server';
import { requireUserPermission } from '@/lib/session';
import { apiError } from '@/lib/api';
import { applySiteRead } from '@/lib/site-read/apply';
import { parseApplyBody } from '@/lib/site-read/apply-model';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Aplica ao perfil o que a pessoa escolheu na leitura do site (SPEC 033): negócio, jeito de falar, fatos (pendentes) e logo. Quem
// tem brand.manage; cada parte passa pelo parser de sempre. Cores e fontes não passam por aqui: vão para o formulário do Visual.
export async function POST(req: Request) {
  try {
    const { t, user } = await requireUserPermission('brand.manage');
    const body = await req.json().catch(() => null);
    return NextResponse.json(await applySiteRead(t, user, parseApplyBody(body)));
  } catch (e) {
    return apiError(e, 'api/profile/site-read/apply');
  }
}
