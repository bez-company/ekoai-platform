import { NextResponse } from 'next/server';
import { requireUserPermission, ForbiddenError, UnauthorizedError } from '@/lib/session';
import { appOrigin } from '@/lib/origin';
import { connectWithCode, oauthApp } from '@/lib/linkedin-oauth';
import { saveLinkedInConnection } from '@/lib/social-accounts';
import { ConnectError, callbackUrl, parseCallbackQuery, type FlashKey } from '@/lib/linkedin-oauth-model';
import { stateValid } from '@/lib/instagram-oauth-model';
import { track } from '@/lib/analytics';
import { apiError } from '@/lib/api';
import { logError } from '@/lib/log';

// Volta da tela de permissão do LinkedIn: confere o `state` assinado, troca o código por token, cifra e grava. Termina sempre na tela
// de redes, com o resultado em `?li=`.
export async function GET(req: Request) {
  const origin = appOrigin(req);
  const back = (key: FlashKey) => NextResponse.redirect(new URL(`/configuracoes/canais?li=${key}`, origin));

  try {
    const { t, user } = await requireUserPermission('channels.manage');
    const query = parseCallbackQuery(new URL(req.url).searchParams);
    if (query.kind === 'denied') return back('denied');
    if (query.kind === 'invalid') return back('invalid');
    const app = oauthApp();
    if (!app) return back('unavailable');
    if (!stateValid(query.state, { tenantId: t.tenantId, secret: app.clientSecret })) return back('invalid');
    const connected = await connectWithCode({ code: query.code, redirectUri: callbackUrl(origin), app });
    await saveLinkedInConnection(t, { userId: user.id, connected });
    await track(t.tenantId, 'linkedin_connected');
    return back('connected');
  } catch (e) {
    if (e instanceof ConnectError) return back(e.flash);
    if (e instanceof UnauthorizedError || e instanceof ForbiddenError) return apiError(e, 'api/linkedin/callback');
    logError('api/linkedin/callback', e);
    return back('failed');
  }
}
