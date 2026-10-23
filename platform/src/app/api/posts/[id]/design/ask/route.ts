// POST /api/posts/[id]/design/ask: "Pedir ajuste" em texto livre (SPEC 024). Uma chamada de texto lê o pedido e
// devolve só o que muda; o servidor aplica sobre a versão em uso pela mesma via do Confirmar (revisor, conflito
// de versão) e grava uma versão nova, que a pessoa desfaz restaurando a anterior. Não chama o modelo de imagem.
// A legenda proposta volta na resposta: ela só vale quando a pessoa aprova o post.

import { NextResponse } from 'next/server';
import { requirePermission, requireSession } from '@/lib/session';
import { designEditError } from '@/lib/design-edit-api';
import { isUuid } from '@/lib/route-input';
import { parseAskBody } from '@/lib/design/ask-model';
import { askAdjust } from '@/lib/post-design-ask';
import { vertexClient } from '@/lib/vertex';
import { hit, tooMany } from '@/lib/rate-limit';
import { RULES } from '@/lib/rate-limit-model';
import { track } from '@/lib/analytics';
import { askProps } from '@/lib/design-edit-events';
import { proposeDesignRules } from '@/lib/design-rules';
import { log } from '@/lib/log';
import type { AskResponse } from '@/lib/design-ask-view';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const t = await requirePermission('content.edit');
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: 'Post não encontrado. Recarregue a página.' }, { status: 404 });
    const parsed = parseAskBody(await req.json().catch(() => null));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error, field: parsed.field }, { status: 400 });
    const limited = await hit(RULES.designAsk, t.tenantId);
    if (!limited.allowed) return tooMany(limited, 'api/posts/design/ask', RULES.designAsk.bucket);
    const userId = (await requireSession()).user?.id ?? null;
    const out = await askAdjust(t, id, { ...parsed.value, userId }, { model: vertexClient() });

    const diff = out.saved?.diff ?? [];
    await track(t.tenantId, 'design_ask', askProps({ briefId: id, aspect: parsed.value.aspect, outcome: out.saved ? 'applied' : out.caption ? 'caption' : 'needs_visual', version: out.saved?.version ?? null, diff, captionChanged: !!out.caption, notApplied: out.notApplied.length, modelCalls: out.modelCalls }));
    // Mesma regra do Confirmar: a mudança que se repete em 3 posts pode virar proposta de regra, sem nunca derrubar o ajuste já gravado.
    if (out.saved) await proposeDesignRules(t).catch((e) => log('warn', 'design-rules', 'não propôs regra', { error: e instanceof Error ? e.message : String(e) }));
    const body: AskResponse = {
      version: out.saved?.version ?? null,
      previousVersion: out.previousVersion,
      summary: out.saved?.summary ?? null,
      diff: diff.map(({ field, op, before, after }) => ({ field, op, before, after })),
      caption: out.caption,
      needsVisual: out.needsVisual,
      notApplied: out.notApplied,
    };
    return NextResponse.json(body, { status: out.saved ? 201 : 200 });
  } catch (e) {
    return designEditError(e, 'api/posts/[id]/design/ask');
  }
}
