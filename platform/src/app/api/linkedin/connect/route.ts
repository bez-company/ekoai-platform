import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/session';
import { appOrigin } from '@/lib/origin';
import { oauthApp } from '@/lib/linkedin-oauth';
import { buildAuthorizeUrl, callbackUrl, pagesEnabled } from '@/lib/linkedin-oauth-model';
import { createState } from '@/lib/instagram-oauth-model';
import { apiError } from '@/lib/api';

// Começa a conexão do LinkedIn: gera o `state` assinado (proteção contra CSRF, sem cookie, como no Instagram) e leva a pessoa para a
// tela de permissão do LinkedIn. A volta é /api/linkedin/callback.
export async function GET(req: Request) {
  try {
    const t = await requirePermission('channels.manage');
    const origin = appOrigin(req);
    const app = oauthApp();
    if (!app) return NextResponse.redirect(new URL('/configuracoes/canais?li=unavailable', origin));

    const state = createState({ tenantId: t.tenantId, secret: app.clientSecret });
    return NextResponse.redirect(buildAuthorizeUrl({ clientId: app.clientId, redirectUri: callbackUrl(origin), state, pages: pagesEnabled() }));
  } catch (e) {
    return apiError(e, 'api/linkedin/connect');
  }
}
