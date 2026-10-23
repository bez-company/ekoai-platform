import { describe, it, expect } from 'vitest';
import * as m from '../platform/src/lib/instagram-oauth-model.ts';
import { MetaApiError, connectWithCode, instagramApp, refreshLongToken } from '../platform/src/lib/instagram-oauth.ts';

const APP = { appId: '27356348073961636', appSecret: 'segredo-do-app' };
const REDIRECT = 'https://ekoai.example/api/instagram/callback';

describe('URL de autorização', () => {
  it('pede as permissões do app (duas obrigatórias e a de insights), com state e login forçado', () => {
    const url = new URL(m.buildAuthorizeUrl({ appId: APP.appId, redirectUri: REDIRECT, state: 'abc' }));
    expect(url.origin + url.pathname).toBe('https://www.instagram.com/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe(APP.appId);
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toBe('instagram_business_basic,instagram_business_content_publish,instagram_business_manage_insights');
    expect(url.searchParams.get('state')).toBe('abc');
    expect(url.searchParams.get('force_reauth')).toBe('true');
  });

  it('o redirect do callback não duplica a barra final da origem', () => {
    expect(m.callbackUrl('https://ekoai.example/')).toBe(REDIRECT);
    expect(m.callbackUrl('https://ekoai.example')).toBe(REDIRECT);
  });
});

describe('state contra CSRF (assinado, sem cookie)', () => {
  const input = { tenantId: 't1', secret: 'segredo', now: 1_000_000 };
  const state = m.createState({ ...input, nonce: 'abc' });

  it('aceita o state da mesma empresa dentro do prazo', () => {
    expect(m.stateValid(state, input)).toBe(true);
    expect(state.length).toBeLessThan(200);
  });

  it('recusa outra empresa, outro segredo, adulterado, vencido e vazio', () => {
    expect(m.stateValid(state, { ...input, tenantId: 't2' })).toBe(false);
    expect(m.stateValid(state, { ...input, secret: 'outro' })).toBe(false);
    expect(m.stateValid(state.replace('abc', 'abd'), input)).toBe(false);
    expect(m.stateValid(state, { ...input, now: input.now + (m.STATE_TTL_SECONDS + 1) * 1000 })).toBe(false);
    expect(m.stateValid(undefined, input)).toBe(false);
    expect(m.stateValid('', input)).toBe(false);
    expect(m.stateValid('a.b', input)).toBe(false);
  });
});

describe('query do callback', () => {
  const q = (s) => m.parseCallbackQuery(new URLSearchParams(s));
  it('code e state viram code; sufixo #_ da Meta sai', () => {
    expect(q('code=AQB123#_&state=s1')).toEqual({ kind: 'code', code: 'AQB123', state: 's1' });
  });
  it('recusa na tela da Meta vira denied; outro erro ou falta de campo vira invalid', () => {
    expect(q('error=access_denied&error_reason=user_denied')).toEqual({ kind: 'denied' });
    expect(q('error=server_error')).toEqual({ kind: 'invalid' });
    expect(q('state=s1')).toEqual({ kind: 'invalid' });
    expect(q('code=abc')).toEqual({ kind: 'invalid' });
    expect(q(`code=${'x'.repeat(2001)}&state=s`)).toEqual({ kind: 'invalid' });
  });
});

describe('respostas da Meta (dado externo)', () => {
  it('id acima de 2^53 não perde dígitos', () => {
    const body = m.parseJsonKeepingIds('{"user_id":17841400000000123,"access_token":"IGQ"}');
    expect(m.parseShortToken(body).userId).toBe('17841400000000123');
  });

  it('o token curto aceita o formato direto e o dentro de data[]', () => {
    const direct = m.parseShortToken({ access_token: 'T', user_id: '1', permissions: 'instagram_business_basic,instagram_business_content_publish' });
    const wrapped = m.parseShortToken({ data: [{ access_token: 'T', user_id: '1', permissions: ['instagram_business_basic'] }] });
    expect(direct.permissions).toEqual(['instagram_business_basic', 'instagram_business_content_publish']);
    expect(wrapped.permissions).toEqual(['instagram_business_basic']);
  });

  it('resposta fora do formato falha cedo e claro', () => {
    expect(() => m.parseShortToken({})).toThrow(/access_token/);
    expect(() => m.parseShortToken(null)).toThrow(/formato/);
    expect(() => m.parseLongToken({ access_token: 'T' })).toThrow(/expires_in/);
    expect(() => m.parseLongToken({ access_token: 'T', expires_in: -1 })).toThrow(/expires_in/);
    expect(() => m.parseProfile({ username: 'x' })).toThrow(/user_id/);
  });

  it('só conta profissional passa', () => {
    expect(m.isProfessional(m.parseProfile({ user_id: '1', account_type: 'BUSINESS' }))).toBe(true);
    expect(m.isProfessional(m.parseProfile({ user_id: '1', account_type: 'MEDIA_CREATOR' }))).toBe(true);
    expect(m.isProfessional(m.parseProfile({ user_id: '1', account_type: 'PERSONAL' }))).toBe(false);
    expect(m.isProfessional(m.parseProfile({ user_id: '1' }))).toBe(false);
  });

  it('lista a permissão obrigatória que faltou; a de insights é opcional', () => {
    expect(m.missingScopes(['instagram_business_basic'])).toEqual(['instagram_business_content_publish']);
    expect(m.missingScopes([...m.SCOPES])).toEqual([]);
    expect(m.missingScopes([...m.REQUIRED_SCOPES])).toEqual([]);
  });


  it('dias até vencer nunca fica negativo', () => {
    const now = Date.UTC(2026, 9, 22);
    expect(m.daysUntil(new Date(now + 3 * 86_400_000 - 1000), now)).toBe(3);
    expect(m.daysUntil(new Date(now - 5 * 86_400_000), now)).toBe(0);
    expect(m.daysUntil(null, now)).toBeNull();
  });
});

describe('textos da tela', () => {
  it('toda chave tem texto e nenhum usa travessão', () => {
    for (const [key, v] of Object.entries(m.FLASH)) {
      expect(v.text.length, key).toBeGreaterThan(10);
      expect(v.text, key).not.toMatch(/[\u2014\u2013]/);
    }
    expect(m.isFlashKey('connected')).toBe(true);
    expect(m.isFlashKey('<script>')).toBe(false);
  });
});

function fakeMeta(steps) {
  const calls = [];
  const fetchFn = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    calls.push({ url, init });
    const step = steps.shift();
    if (!step) throw new Error(`chamada inesperada: ${url.pathname}`);
    return new Response(step.body, { status: step.status ?? 200 });
  };
  return { calls, fetchFn };
}

const NOW = Date.UTC(2026, 9, 22, 12);
const SHORT = '{"access_token":"IGQshort","user_id":17841400000000123,"permissions":"instagram_business_basic,instagram_business_content_publish"}';
const LONG = '{"access_token":"IGQlong","token_type":"bearer","expires_in":5183944}';
const ME = '{"user_id":"17841400000000123","username":"ekoai.app","account_type":"BUSINESS"}';

describe('connectWithCode', () => {
  it('troca o código, estende o token e lê o perfil, na ordem certa', async () => {
    const { calls, fetchFn } = fakeMeta([{ body: SHORT }, { body: LONG }, { body: ME }]);
    const got = await connectWithCode({ code: 'CODE', redirectUri: REDIRECT, app: APP }, fetchFn, NOW);

    expect(got.accessToken).toBe('IGQlong');
    expect(got.profile).toEqual({ userId: '17841400000000123', username: 'ekoai.app', accountType: 'BUSINESS' });
    expect(got.expiresAt.toISOString()).toBe(new Date(NOW + 5183944 * 1000).toISOString());

    const [first, second, third] = calls;
    expect(first.url.href).toBe('https://api.instagram.com/oauth/access_token');
    expect(first.init.method).toBe('POST');
    const form = new URLSearchParams(first.init.body.toString());
    expect(Object.fromEntries(form)).toMatchObject({ client_id: APP.appId, grant_type: 'authorization_code', redirect_uri: REDIRECT, code: 'CODE' });
    expect(second.url.searchParams.get('grant_type')).toBe('ig_exchange_token');
    expect(second.url.searchParams.get('access_token')).toBe('IGQshort');
    expect(third.url.pathname).toBe('/v21.0/me');
    expect(third.url.searchParams.get('access_token')).toBe('IGQlong');
  });

  it('conta pessoal vira not_professional, sem gravar nada', async () => {
    const personal = '{"user_id":"1","username":"fulano","account_type":"PERSONAL"}';
    const { fetchFn } = fakeMeta([{ body: SHORT }, { body: LONG }, { body: personal }]);
    await expect(connectWithCode({ code: 'C', redirectUri: REDIRECT, app: APP }, fetchFn, NOW)).rejects.toMatchObject({ flash: 'not_professional' });
  });

  it('sem a permissão de publicar para antes de pedir o token longo', async () => {
    const partial = '{"access_token":"T","user_id":1,"permissions":"instagram_business_basic"}';
    const { calls, fetchFn } = fakeMeta([{ body: partial }]);
    await expect(connectWithCode({ code: 'C', redirectUri: REDIRECT, app: APP }, fetchFn, NOW)).rejects.toMatchObject({ flash: 'no_publish' });
    expect(calls).toHaveLength(1);
  });

  it('código recusado pela Meta falha sem vazar segredo na mensagem', async () => {
    const { fetchFn } = fakeMeta([{ status: 400, body: '{"error_type":"OAuthException","error_message":"Invalid authorization code"}' }]);
    const err = await connectWithCode({ code: 'C', redirectUri: REDIRECT, app: APP }, fetchFn, NOW).catch((e) => e);
    expect(err).toBeInstanceOf(MetaApiError);
    expect(err.message).toBe('Meta code: 400');
    expect(err.message).not.toContain(APP.appSecret);
  });
});

describe('instagramApp', () => {
  it('só existe com id e segredo preenchidos', () => {
    expect(instagramApp({ INSTAGRAM_APP_ID: '1', INSTAGRAM_APP_SECRET: 's' })).toEqual({ appId: '1', appSecret: 's' });
    expect(instagramApp({ INSTAGRAM_APP_ID: '1', INSTAGRAM_APP_SECRET: '  ' })).toBeNull();
    expect(instagramApp({})).toBeNull();
  });
});

const D = 86_400_000;
const at = (offsetMs) => new Date(NOW + offsetMs).toISOString();

describe('refreshDecision', () => {
  const base = { status: 'active', expiresAt: at(5 * D), refreshedAt: null, connectedAt: at(-10 * D) };
  it('renova dentro da janela de 15 dias e só depois de 24 horas de vida', () => {
    expect(m.refreshDecision(base, NOW)).toBe('refresh');
    expect(m.refreshDecision({ ...base, expiresAt: at(15 * D) }, NOW)).toBe('refresh');
    expect(m.refreshDecision({ ...base, connectedAt: at(-2 * 3_600_000) }, NOW)).toBe('wait');
    expect(m.refreshDecision({ ...base, refreshedAt: at(-23 * 3_600_000) }, NOW)).toBe('wait');
    expect(m.refreshDecision({ ...base, refreshedAt: at(-25 * 3_600_000) }, NOW)).toBe('refresh');
  });
  it('longe de vencer, sem prazo ou fora de ativo não faz nada', () => {
    expect(m.refreshDecision({ ...base, expiresAt: at(16 * D) }, NOW)).toBe('skip');
    expect(m.refreshDecision({ ...base, expiresAt: null }, NOW)).toBe('skip');
    expect(m.refreshDecision({ ...base, status: 'reauth_required' }, NOW)).toBe('skip');
    expect(m.refreshDecision({ ...base, status: 'revoked' }, NOW)).toBe('skip');
  });
  it('já vencido pede reconexão em vez de tentar renovar', () => {
    expect(m.refreshDecision({ ...base, expiresAt: at(-1000) }, NOW)).toBe('expired');
    expect(m.refreshDecision({ ...base, expiresAt: at(0) }, NOW)).toBe('expired');
  });
});

describe('falha da Meta', () => {
  it('token inválido ou retirado é permanente; rede, 5xx e limite de taxa não', () => {
    expect(m.isPermanentMetaFailure({ status: 400, code: 190, type: 'OAuthException' })).toBe(true);
    expect(m.isPermanentMetaFailure({ status: 400, code: 463, type: null })).toBe(true);
    expect(m.isPermanentMetaFailure({ status: 500, code: null, type: null })).toBe(false);
    expect(m.isPermanentMetaFailure({ status: null, code: null, type: null })).toBe(false);
  });

  it('limite de taxa chega como 400 OAuthException e não derruba a conexão', () => {
    for (const code of [4, 17, 32, 613]) expect(m.isPermanentMetaFailure({ status: 400, code, type: 'OAuthException' })).toBe(false);
    expect(m.isPermanentMetaFailure({ status: 401, code: null, type: 'OAuthException' })).toBe(false);
  });
});

describe('refreshLongToken', () => {
  it('pede a renovação com o token e devolve o prazo novo', async () => {
    const { calls, fetchFn } = fakeMeta([{ body: '{"access_token":"IGQnew","token_type":"bearer","expires_in":5183944}' }]);
    const got = await refreshLongToken('IGQold', fetchFn, NOW);
    expect(got.accessToken).toBe('IGQnew');
    expect(got.expiresAt.toISOString()).toBe(new Date(NOW + 5183944 * 1000).toISOString());
    expect(calls[0].url.origin + calls[0].url.pathname).toBe('https://graph.instagram.com/refresh_access_token');
    expect(calls[0].url.searchParams.get('grant_type')).toBe('ig_refresh_token');
    expect(calls[0].url.searchParams.get('access_token')).toBe('IGQold');
  });

  it('erro de token da Meta vira MetaApiError permanente, sem o token na mensagem', async () => {
    const { fetchFn } = fakeMeta([{ status: 400, body: '{"error":{"message":"Error validating access token","type":"OAuthException","code":190}}' }]);
    const err = await refreshLongToken('IGQold', fetchFn, NOW).catch((e) => e);
    expect(err).toBeInstanceOf(MetaApiError);
    expect(err).toMatchObject({ status: 400, code: 190, type: 'OAuthException', permanent: true });
    expect(err.message).not.toContain('IGQold');
  });

  it('5xx e queda de rede são passageiros', async () => {
    const down = fakeMeta([{ status: 503, body: 'indisponível' }]);
    const e1 = await refreshLongToken('IGQold', down.fetchFn, NOW).catch((e) => e);
    expect(e1).toMatchObject({ status: 503, permanent: false });
    const offline = async () => {
      throw new TypeError('fetch failed');
    };
    const e2 = await refreshLongToken('IGQold', offline, NOW).catch((e) => e);
    expect(e2).toBeInstanceOf(MetaApiError);
    expect(e2).toMatchObject({ status: null, permanent: false });
  });

  it('resposta sem expires_in falha cedo e claro', async () => {
    const { fetchFn } = fakeMeta([{ body: '{"access_token":"IGQnew"}' }]);
    await expect(refreshLongToken('IGQold', fetchFn, NOW)).rejects.toThrow(/expires_in/);
  });
});
