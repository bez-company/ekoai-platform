// GET  /api/posts/[id]/design/revisions: a versão em uso, o design editável, os layouts compatíveis e as
//      versões (quem mudou, o resumo e o diff por campo). Quem vê o conteúdo lê.
// POST /api/posts/[id]/design/revisions: Confirmar. Grava a versão baseVersion + 1, sem chamar o modelo
//      (SPEC 019, ADR 0020). 409 se outra pessoa gravou antes; 422 se o revisor reprova.

import { NextResponse } from 'next/server';
import { requirePermission, requireSession } from '@/lib/session';
import { designEditError } from '@/lib/design-edit-api';
import { isUuid } from '@/lib/route-input';
import { parseEditBody } from '@/lib/design/edit-model';
import { designState, saveEdit } from '@/lib/post-design-revisions';
import { track } from '@/lib/analytics';
import { revisionSavedProps } from '@/lib/design-edit-events';
import { proposeDesignRules } from '@/lib/design-rules';
import { log } from '@/lib/log';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const t = await requirePermission('content.view');
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: 'Post não encontrado. Recarregue a página.' }, { status: 404 });
    return NextResponse.json(await designState(t, id));
  } catch (e) {
    return designEditError(e, 'api/posts/[id]/design/revisions');
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const t = await requirePermission('content.edit');
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: 'Post não encontrado. Recarregue a página.' }, { status: 404 });
    const parsed = parseEditBody(await req.json().catch(() => null));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error, field: parsed.field }, { status: 400 });
    const userId = (await requireSession()).user?.id ?? null;
    const saved = await saveEdit(t, id, { baseVersion: parsed.value.baseVersion, edit: parsed.value.edit, userId });
    await track(t.tenantId, 'design_revision_saved', revisionSavedProps({ briefId: id, version: saved.version, source: saved.source, diff: saved.diff, renderMs: saved.renderMs, editMs: parsed.value.editMs }));
    // A regra que se repete em 3 posts: nunca derruba o Confirmar, que já foi gravado.
    const proposed = await proposeDesignRules(t).catch((e) => (log('warn', 'design-rules', 'não propôs regra', { error: e instanceof Error ? e.message : String(e) }), []));
    return NextResponse.json({ ...saved, ruleProposed: proposed[0] ?? null }, { status: 201 });
  } catch (e) {
    return designEditError(e, 'api/posts/[id]/design/revisions');
  }
}
