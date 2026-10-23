import { NextResponse } from 'next/server';
import { track } from '@/lib/analytics';
import { approvePending } from '@/lib/scheduling';
import { assertDesignVersion, markDesignApproved } from '@/lib/post-design-revisions';
import { approvedProps } from '@/lib/design-edit-events';
import { publishNow } from '@/lib/publish';
import { requirePermission } from '@/lib/session';
import { parseApprove } from '@/lib/route-input';
import { apiError, badRequest } from '@/lib/api';

// Publicar agora espera a rede aceitar o post (o Instagram processa a imagem antes de publicar).
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const t = await requirePermission('content.approve');
    const parsed = parseApprove(await req.json().catch(() => null));
    if (!parsed.ok) return badRequest(parsed.error);
    // A versão do design que a pessoa via: se outra pessoa salvou uma nova, aprovar para (409).
    const design = await assertDesignVersion(t, parsed.value.pendingId, parsed.value.designVersion);
    const result = await approvePending(t, parsed.value);
    if (design) await markDesignApproved(t, design.designId);
    await track(t.tenantId, 'post_approved', approvedProps(design));
    if (!parsed.value.publishNow) return NextResponse.json({ ok: true, ...result });
    // Aprovado já está: se a publicação falhar, o post fica na Agenda como falhou, com o erro.
    const published = await publishNow(t, result.id);
    return NextResponse.json({ ok: true, ...result, published: published.ok, error: published.error });
  } catch (e) {
    return apiError(e, 'api/approve');
  }
}
