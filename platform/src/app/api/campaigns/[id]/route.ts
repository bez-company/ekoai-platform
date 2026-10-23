// /api/campaigns/[id]: editar uma campanha em rascunho, ativa ou pausada. Encerrada não muda.

import { NextResponse } from 'next/server';
import { requireUserPermission } from '@/lib/session';
import { apiError } from '@/lib/api';
import { NotFoundError } from '@/lib/errors';
import { isCampaignId, parseCampaignPatch } from '@/lib/campaign-model';
import { getCampaign, updateCampaign } from '@/lib/campaigns';

export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { t, user } = await requireUserPermission('brand.manage');
    const { id } = await params;
    if (!isCampaignId(id)) throw new NotFoundError('Campanha não encontrada.');
    const current = await getCampaign(t, id);
    const parsed = parseCampaignPatch(await req.json().catch(() => null), current);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error, field: parsed.field ?? null }, { status: 400 });
    return NextResponse.json({ campaign: await updateCampaign(t, user, id, parsed.value) });
  } catch (e) {
    return apiError(e, 'api/campaigns/[id]');
  }
}
