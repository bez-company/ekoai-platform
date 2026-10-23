// GET /api/suggestions: as sugestões abertas do coordenador de conteúdo para os próximos 7 dias
// (SPEC 017 decisão 8, BEZ-239), cada uma com o horário, o objetivo, a foto, a ideia e o motivo.

import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/session';
import { apiError } from '@/lib/api';
import { track } from '@/lib/analytics';
import { listSuggestions } from '@/lib/content-coordinator';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const t = await requirePermission('content.view');
    const suggestions = await listSuggestions(t);
    if (suggestions.length) await track(t.tenantId, 'suggestion_viewed', { count: suggestions.length, with_photo: suggestions.filter((s) => s.assetId).length });
    return NextResponse.json({ suggestions });
  } catch (e) {
    return apiError(e, 'api/suggestions');
  }
}
