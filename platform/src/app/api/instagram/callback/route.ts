import { NextResponse } from 'next/server';
import { requireUserPermission, ForbiddenError, UnauthorizedError } from '@/lib/session';
import { appOrigin } from '@/lib/origin';
import { connectWithCode, instagramApp } from '@/lib/instagram-oauth';
import { saveInstagramConnection } from '@/lib/social-accounts';
import { ConnectError, callbackUrl, parseCallbackQuery, stateValid, type FlashKey } from '@/lib/instagram-oauth-model';
import { track } from '@/lib/analytics';
import { apiError } from '@/lib/api';
import { logError } from '@/lib/log';

// Volta da tela de permissão do Instagram: confere o `state` assinado, troca o código por token, cifra e grava.
// Termina sempre na tela de redes, com o resultado em `?ig=`.
export async function GET(req: Request) {
  const origin = appOrigin(req);
  const back = (key: FlashKey) => {
    return NextResponse.redirect(new URL(`/settings/channels?ig=${key}`, origin));
  };

  try {
    const { t, user } = await requireUserPermission('channels.manage');
    const query = parseCallbackQuery(new URL(req.url).searchParams);
    if (query.kind === 'denied') return back('denied');
    if (query.kind === 'invalid') return back('invalid');
    const app = instagramApp();
    if (!app) return back('unavailable');
    if (!stateValid(query.state, { tenantId: t.tenantId, secret: app.appSecret })) return back('invalid');
    const connected = await connectWithCode({ code: query.code, redirectUri: callbackUrl(origin), app });
    await saveInstagramConnection(t, { userId: user.id, connected });
    await track(t.tenantId, 'instagram_connected');
    return back('connected');
  } catch (e) {
    if (e instanceof ConnectError) return back(e.flash);
    if (e instanceof UnauthorizedError || e instanceof ForbiddenError) return apiError(e, 'api/instagram/callback');
    logError('api/instagram/callback', e);
    return back('failed');
  }
}
