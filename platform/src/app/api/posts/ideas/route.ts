// POST /api/posts/ideas: "Sugerir ideias" do Criar post (SPEC 025, BEZ-375). Seis ideias e a linha de design pelo perfil da
// empresa. Uma chamada de texto, sem imagem: não conta no limite de posts do mês; entra no teto por hora da conta.

import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/session';
import { apiError } from '@/lib/api';
import { track } from '@/lib/analytics';
import { RULES } from '@/lib/rate-limit-model';
import { hit, tooMany } from '@/lib/rate-limit';
import { starterIdeas } from '@/lib/starter-ideas';
import { vertexClient } from '@/lib/vertex';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST() {
  try {
    const t = await requirePermission('content.create');
    const limited = await hit(RULES.starterIdeas, t.tenantId);
    if (!limited.allowed) return tooMany(limited, 'api/posts/ideas', RULES.starterIdeas.bucket);
    const out = await starterIdeas(t, { model: vertexClient() });
    await track(t.tenantId, 'ideas_suggested', { count: out.ideas.length });
    return NextResponse.json(out);
  } catch (e) {
    return apiError(e, 'api/posts/ideas');
  }
}
