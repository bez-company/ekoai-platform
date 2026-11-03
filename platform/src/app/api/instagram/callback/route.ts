import { NextResponse } from 'next/server';
import { requireUserPermission, ForbiddenError, UnauthorizedError } from '@/lib/session';
import { appOrigin } from '@/lib/origin';
import { MetaApiError, connectWithCode, instagramApp } from '@/lib/instagram-oauth';
import { saveInstagramConnection } from '@/lib/social-accounts';
import { ConnectError, callbackUrl, destPath, metaFailureFlash, parseCallbackQuery, readState, type ConnectDest, type FlashKey } from '@/lib/instagram-oauth-model';
import { track } from '@/lib/analytics';
import { apiError } from '@/lib/api';
import { logError } from '@/lib/log';

// Volta da tela de permissão do Instagram: confere o `state` assinado, troca o código por token, cifra e grava.
// Termina sempre na tela de redes ou, quando a conexão começou no cadastro (SPEC 034), de volta ao cadastro, com o resultado em `?ig=`. O destino vem do
// `state` assinado; sem `state` válido, é a tela de redes.
export async function GET(req: Request) {
  const origin = appOrigin(req);
  let dest: ConnectDest = 'canais';
  const back = (key: FlashKey) => {
    return NextResponse.redirect(new URL(`${destPath(dest)}?ig=${key}`, origin));
  };

  try {
    const { t, user } = await requireUserPermission('channels.manage');
    const params = new URL(req.url).searchParams;
    const app = instagramApp();
    // A Meta devolve o `state` também quando a pessoa recusa: é por ele que a recusa volta ao lugar certo.
    if (app) dest = readState(params.get('state'), { tenantId: t.tenantId, secret: app.appSecret }).dest;
    const query = parseCallbackQuery(params);
    if (query.kind === 'denied') return back('denied');
    if (query.kind === 'invalid') return back('invalid');
    if (!app) return back('unavailable');
    if (!readState(query.state, { tenantId: t.tenantId, secret: app.appSecret }).valid) return back('invalid');
    const connected = await connectWithCode({ code: query.code, redirectUri: callbackUrl(origin), app });
    await saveInstagramConnection(t, { userId: user.id, connected });
    await track(t.tenantId, 'instagram_connected');
    return back('connected');
  } catch (e) {
    if (e instanceof ConnectError) return back(e.flash);
    if (e instanceof UnauthorizedError || e instanceof ForbiddenError) return apiError(e, 'api/instagram/callback');
    // `await`: o redirect sai logo e o Cloud Run corta a CPU, então o envio ao Sentry precisa terminar antes.
    if (e instanceof MetaApiError) {
      await logError('api/instagram/callback', e, { step: e.step, status: e.status, code: e.code, type: e.type });
      return back(metaFailureFlash(e));
    }
    await logError('api/instagram/callback', e);
    return back('failed');
  }
}
