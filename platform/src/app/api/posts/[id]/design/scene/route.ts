// /api/posts/[id]/design/scene: o Studio livre (SPEC 027, BEZ-381). Só o desenho: nunca chama o modelo e não conta no limite do mês.
// GET    a cena que o Studio abre (a guardada, ou o layout do post em camadas) com o fundo do layout e as logos. content.view.
// PUT    Confirmar: grava a cena como a versão baseVersion + 1. 409 se outra pessoa gravou antes; 422 se o revisor reprova.
// DELETE tira as camadas e volta ao layout automático (?baseVersion=&slide=).

import { NextResponse } from 'next/server';
import { requirePermission, requireSession } from '@/lib/session';
import { designEditError } from '@/lib/design-edit-api';
import { isUuid } from '@/lib/route-input';
import { resetScene, saveScene, sceneState } from '@/lib/post-design-revisions';
import { track } from '@/lib/analytics';

export const dynamic = 'force-dynamic';

const notFound = () => NextResponse.json({ error: 'Post não encontrado. Recarregue a página.' }, { status: 404 });
const slideOf = (raw: string | null): number | undefined => (raw !== null && /^\d{1,2}$/.test(raw) ? Number(raw) : undefined);
const versionOf = (raw: unknown): number | null => (typeof raw === 'number' && Number.isInteger(raw) && raw >= 1 && raw <= 1_000_000 ? raw : typeof raw === 'string' && /^\d{1,7}$/.test(raw) && Number(raw) >= 1 ? Number(raw) : null);

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const t = await requirePermission('content.view');
    const { id } = await params;
    if (!isUuid(id)) return notFound();
    return NextResponse.json(await sceneState(t, id, { slide: slideOf(new URL(req.url).searchParams.get('slide')) }));
  } catch (e) {
    return designEditError(e, 'api/posts/[id]/design/scene');
  }
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const t = await requirePermission('content.edit');
    const { id } = await params;
    if (!isUuid(id)) return notFound();
    const body = (await req.json().catch(() => null)) as { baseVersion?: unknown; slide?: unknown; scene?: unknown } | null;
    const baseVersion = versionOf(body?.baseVersion);
    if (!body || baseVersion === null || body.scene === undefined) return NextResponse.json({ error: 'Corpo inválido: mande baseVersion e scene.' }, { status: 400 });
    const slide = typeof body.slide === 'number' && Number.isInteger(body.slide) && body.slide >= 0 && body.slide < 20 ? body.slide : undefined;
    const userId = (await requireSession()).user?.id ?? null;
    const saved = await saveScene(t, id, { baseVersion, scene: body.scene, slide, userId });
    await track(t.tenantId, 'studio_scene_saved', { brief_id: id, version: saved.version, render_ms: Math.max(0, Math.round(saved.renderMs)), model_calls: 0 });
    return NextResponse.json(saved, { status: 201 });
  } catch (e) {
    return designEditError(e, 'api/posts/[id]/design/scene');
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const t = await requirePermission('content.edit');
    const { id } = await params;
    if (!isUuid(id)) return notFound();
    const q = new URL(req.url).searchParams;
    const baseVersion = versionOf(q.get('baseVersion'));
    if (baseVersion === null) return NextResponse.json({ error: 'Faltou a versão de partida (baseVersion).' }, { status: 400 });
    const userId = (await requireSession()).user?.id ?? null;
    return NextResponse.json(await resetScene(t, id, { baseVersion, slide: slideOf(q.get('slide')), userId }), { status: 201 });
  } catch (e) {
    return designEditError(e, 'api/posts/[id]/design/scene');
  }
}
