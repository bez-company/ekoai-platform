// POST /api/linkedin/publish-as: escolhe onde os posts do LinkedIn saem (BEZ-455): `{ urn: null }` é o perfil pessoal e
// `{ urn: "urn:li:organization:<id>" }` é uma das páginas que a pessoa administra (lidas na conexão). Só quem gerencia as redes.

import { NextResponse } from 'next/server';
import { requireUserPermission } from '@/lib/session';
import { setLinkedInPublishAs } from '@/lib/social-accounts';
import { isOrganizationUrn } from '@/lib/linkedin-oauth-model';
import { track } from '@/lib/analytics';
import { apiError, badRequest } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const { t, user } = await requireUserPermission('channels.manage');
    const body = (await req.json().catch(() => null)) as { urn?: unknown } | null;
    if (!body || !('urn' in body) || (body.urn !== null && !isOrganizationUrn(body.urn))) return badRequest('Escolha o perfil ou uma página da lista.');
    const result = await setLinkedInPublishAs(t, user.id, body.urn);
    await track(t.tenantId, 'linkedin_publish_as_changed', { target: result.publishAs ? 'page' : 'member' });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return apiError(e, 'api/linkedin/publish-as');
  }
}
