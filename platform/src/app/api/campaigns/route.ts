// /api/campaigns: as campanhas da conta (SPEC 018, BEZ-262). Quem vê o conteúdo lê; quem gere a marca cria.
// A campanha nasce rascunho e só vale depois de confirmada.

import { NextResponse } from 'next/server';
import { requirePermission, requireUserPermission } from '@/lib/session';
import { apiError } from '@/lib/api';
import { parseCampaignInput } from '@/lib/campaign-model';
import { createCampaign, listCampaigns } from '@/lib/campaigns';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const t = await requirePermission('content.view');
    return NextResponse.json({ campaigns: await listCampaigns(t) });
  } catch (e) {
    return apiError(e, 'api/campaigns');
  }
}

export async function POST(req: Request) {
  try {
    const { t, user } = await requireUserPermission('brand.manage');
    const parsed = parseCampaignInput(await req.json().catch(() => null));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error, field: parsed.field ?? null }, { status: 400 });
    return NextResponse.json({ campaign: await createCampaign(t, user, parsed.value) }, { status: 201 });
  } catch (e) {
    return apiError(e, 'api/campaigns');
  }
}
