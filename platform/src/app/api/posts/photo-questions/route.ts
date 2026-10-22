// POST /api/posts/photo-questions: as perguntas de um clique sobre a foto anexada no Criar post (SPEC
// 017 decisão 7, BEZ-237). No máximo 2: "Como usar a foto?" (se o pedido não disse) e "O que
// escrever?" (se o pedido não diz o assunto). A resposta vai no POST /api/posts, em asset_id e photo_usage.

import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/session';
import { apiError } from '@/lib/api';
import { parseQuestionRequest } from '@/lib/photo-question-model';
import { photoQuestions } from '@/lib/photo-questions';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const t = await requirePermission('content.create');
    const parsed = parseQuestionRequest(await req.json().catch(() => null));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error, field: parsed.field ?? null }, { status: 400 });
    return NextResponse.json(await photoQuestions(t, parsed.value));
  } catch (e) {
    return apiError(e, 'api/posts/photo-questions');
  }
}
