// GET /api/suggestions: as sugestões abertas do coordenador de conteúdo para os próximos 7 dias
// (SPEC 017 decisão 8, BEZ-239), cada uma com o horário, o objetivo, a foto, a ideia e o motivo.

import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/session';
import { apiError } from '@/lib/api';
import { listSuggestions } from '@/lib/content-coordinator';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const t = await requirePermission('content.view');
    return NextResponse.json({ suggestions: await listSuggestions(t) });
  } catch (e) {
    return apiError(e, 'api/suggestions');
  }
}
