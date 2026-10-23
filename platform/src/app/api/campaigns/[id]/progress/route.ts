// /api/campaigns/[id]/progress: posts, cadência e engajamento da campanha. Nunca venda: curtida, comentário e
// alcance não dizem quanto vendeu.

import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/session';
import { apiError } from '@/lib/api';
import { NotFoundError } from '@/lib/errors';
import { isCampaignId } from '@/lib/campaign-model';
import { campaignProgress } from '@/lib/campaigns';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const t = await requirePermission('content.view');
    const { id } = await params;
    if (!isCampaignId(id)) throw new NotFoundError('Campanha não encontrada.');
    return NextResponse.json({ progress: await campaignProgress(t, id) });
  } catch (e) {
    return apiError(e, 'api/campaigns/[id]/progress');
  }
}
