import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { requirePermission } from '@/lib/session';
import { appOrigin } from '@/lib/origin';
import { instagramApp } from '@/lib/instagram-oauth';
import { STATE_COOKIE, STATE_TTL_SECONDS, buildAuthorizeUrl, callbackUrl } from '@/lib/instagram-oauth-model';
import { apiError } from '@/lib/api';

// Começa a conexão do Instagram: guarda o `state` em cookie httpOnly (proteção contra CSRF) e leva a
// pessoa para a tela de permissão do Instagram. A volta é /api/instagram/callback.
export async function GET(req: Request) {
  try {
    await requirePermission('channels.manage');
    const origin = appOrigin(req);
    const app = instagramApp();
    if (!app) return NextResponse.redirect(new URL('/settings/channels?ig=unavailable', origin));

    const state = randomBytes(24).toString('hex');
    const res = NextResponse.redirect(buildAuthorizeUrl({ appId: app.appId, redirectUri: callbackUrl(origin), state }));
    res.cookies.set(STATE_COOKIE, state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/instagram',
      maxAge: STATE_TTL_SECONDS,
    });
    return res;
  } catch (e) {
    return apiError(e, 'api/instagram/connect');
  }
}
