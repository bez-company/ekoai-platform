import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/session';
import { appOrigin } from '@/lib/origin';
import { instagramApp } from '@/lib/instagram-oauth';
import { buildAuthorizeUrl, callbackUrl, createState } from '@/lib/instagram-oauth-model';
import { apiError } from '@/lib/api';

// Começa a conexão do Instagram: gera o `state` assinado (proteção contra CSRF, sem cookie) e leva a
// pessoa para a tela de permissão do Instagram. A volta é /api/instagram/callback.
export async function GET(req: Request) {
  try {
    const t = await requirePermission('channels.manage');
    const origin = appOrigin(req);
    const app = instagramApp();
    if (!app) return NextResponse.redirect(new URL('/settings/channels?ig=unavailable', origin));

    const state = createState({ tenantId: t.tenantId, secret: app.appSecret });
    return NextResponse.redirect(buildAuthorizeUrl({ appId: app.appId, redirectUri: callbackUrl(origin), state }));
  } catch (e) {
    return apiError(e, 'api/instagram/connect');
  }
}
