// /api/campaigns/[id]/pause: pausa a campanha ativa: as sugestões voltam a seguir só a rotação até retomar.

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
    return NextResponse.json({ campaign: await changeCampaign(t, user, id, 'pause') });
  } catch (e) {
    return apiError(e, 'api/campaigns/[id]/pause');
  }
}
