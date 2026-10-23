// /api/campaigns/[id]/resume: retoma uma campanha pausada. Só uma ativa por conta (409 se já houver).

import { NextResponse } from 'next/server';
import { requireUserPermission } from '@/lib/session';
import { apiError } from '@/lib/api';
import { NotFoundError } from '@/lib/errors';
import { isCampaignId } from '@/lib/campaign-model';
import { changeCampaign } from '@/lib/campaigns';

export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { t, user } = await requireUserPermission('brand.manage');
    const { id } = await params;
    if (!isCampaignId(id)) throw new NotFoundError('Campanha não encontrada.');
    return NextResponse.json({ campaign: await changeCampaign(t, user, id, 'resume') });
  } catch (e) {
    return apiError(e, 'api/campaigns/[id]/resume');
  }
}
