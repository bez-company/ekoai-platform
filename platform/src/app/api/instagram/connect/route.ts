import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/session';
import { appOrigin } from '@/lib/origin';
import { instagramApp } from '@/lib/instagram-oauth';
import { buildAuthorizeUrl, callbackUrl, createState, destPath, parseDest } from '@/lib/instagram-oauth-model';
import { instagramOnboardingEnabled } from '@/lib/instagram-onboarding';
import { apiError } from '@/lib/api';

// Começa a conexão do Instagram: gera o `state` assinado (proteção contra CSRF, sem cookie) e leva a
// pessoa para a tela de permissão do Instagram. A volta é /api/instagram/callback. `?dest=onboarding` (SPEC 034) faz a volta terminar no
// cadastro; o destino vai dentro do `state` assinado e só vale o que está na lista (qualquer outro valor é a tela de redes). O cadastro só abre
// com INSTAGRAM_ONBOARDING_CONNECT ligada.
export async function GET(req: Request) {
  try {
    const t = await requirePermission('channels.manage');
    const origin = appOrigin(req);
    const dest = parseDest(new URL(req.url).searchParams.get('dest'));
    if (dest === 'onboarding' && !instagramOnboardingEnabled()) return NextResponse.redirect(new URL(`${destPath(dest)}?ig=unavailable`, origin));
    const app = instagramApp();
    if (!app) return NextResponse.redirect(new URL(`${destPath(dest)}?ig=unavailable`, origin));

    const state = createState({ tenantId: t.tenantId, secret: app.appSecret, dest });
    return NextResponse.redirect(buildAuthorizeUrl({ appId: app.appId, redirectUri: callbackUrl(origin), state }));
  } catch (e) {
    return apiError(e, 'api/instagram/connect');
  }
}
