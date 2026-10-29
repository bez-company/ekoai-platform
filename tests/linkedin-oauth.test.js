import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ConnectError, FLASH, REFRESH_WINDOW_DAYS, SCOPES, authorUrn, buildAuthorizeUrl, callbackUrl, connectedProps, isFlashKey, isPermanentFailure, missingScopes, parseCallbackQuery, parseProfile, parseToken, refreshDecision, API_VERSION, PAGE_SCOPES, hasPageScopes, isOrganizationUrn, organizationId, pagesEnabled, parseAcls, parsePages, storedPages } from '../platform/src/lib/linkedin-oauth-model.ts';
import { LinkedInApiError, connectWithCode, fetchPages, oauthApp, refreshWithToken } from '../platform/src/lib/linkedin-oauth.ts';
import { createState, stateValid } from '../platform/src/lib/instagram-oauth-model.ts';
import { linkedinView } from '../platform/src/lib/channels-view.ts';

const D = 86_400_000;
const NOW = Date.parse('2026-10-28T12:00:00Z');
const APP = { clientId: 'cid-123', clientSecret: 'secret-abc' };
const TOKEN_OK = { access_token: 'AQX-token', expires_in: 5184000, scope: 'openid,profile,w_member_social' };
const INFO_OK = { sub: 'AbC123xyz', name: 'Ana Ribeiro', given_name: 'Ana', family_name: 'Ribeiro' };

// LinkedIn simulado: responde pelo endereço, e guarda o que recebeu para conferir o que o app mandou.
function fakeLinkedIn(handlers) {
  const calls = [];
  const fetchFn = async (input, init = {}) => {
    const url = String(input);
    const body = init.body instanceof URLSearchParams ? Object.fromEntries(init.body) : null;
    calls.push({ url, body, auth: init.headers?.Authorization ?? null });
    const key = Object.keys(handlers).find((k) => url.startsWith(k));
    if (!key) throw new Error(`chamada inesperada: ${url}`);
    const r = handlers[key](body);
    if (r instanceof Error) throw r;
    return new Response(JSON.stringify(r.json ?? {}), { status: r.status ?? 200 });
  };
  return { calls, fetchFn };
}
const TOKEN = 'https://www.linkedin.com/oauth/v2/accessToken';
const USERINFO = 'https://api.linkedin.com/v2/userinfo';

describe('modelo da conexão do LinkedIn (SPEC 028, BEZ-423)', () => {
  it('a URL de autorização leva os escopos, o state e o redirect, sem o segredo', () => {
    const u = new URL(buildAuthorizeUrl({ clientId: 'cid', redirectUri: 'https://app.test/api/linkedin/callback', state: 's.1.2' }));
    expect(u.origin + u.pathname).toBe('https://www.linkedin.com/oauth/v2/authorization');
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('client_id')).toBe('cid');
    expect(u.searchParams.get('scope')).toBe('openid profile w_member_social');
    expect(u.searchParams.get('state')).toBe('s.1.2');
    expect(u.search).not.toContain('secret');
    expect(SCOPES).toEqual(['openid', 'profile', 'w_member_social']);
    expect(callbackUrl('https://app.test/')).toBe('https://app.test/api/linkedin/callback');
  });

  it('o callback devolve código e state, ou diz que a pessoa cancelou, ou que veio incompleto', () => {
    expect(parseCallbackQuery(new URLSearchParams('code=abc&state=xyz'))).toEqual({ kind: 'code', code: 'abc', state: 'xyz' });
    for (const e of ['user_cancelled_login', 'user_cancelled_authorize', 'access_denied']) expect(parseCallbackQuery(new URLSearchParams(`error=${e}`))).toEqual({ kind: 'denied' });
    for (const q of ['error=server_error', 'code=abc', 'state=xyz', '', `code=${'a'.repeat(2001)}&state=x`, `code=a&state=${'s'.repeat(201)}`]) expect(parseCallbackQuery(new URLSearchParams(q)), q).toEqual({ kind: 'invalid' });
  });

  it('o state é o mesmo do Instagram, assinado com o segredo do app do LinkedIn e preso à conta', () => {
    const state = createState({ tenantId: 'acme', secret: APP.clientSecret, now: NOW });
    expect(stateValid(state, { tenantId: 'acme', secret: APP.clientSecret, now: NOW + 1000 })).toBe(true);
    expect(stateValid(state, { tenantId: 'outra', secret: APP.clientSecret, now: NOW + 1000 })).toBe(false);
    expect(stateValid(state, { tenantId: 'acme', secret: 'outro-segredo', now: NOW + 1000 })).toBe(false);
    expect(stateValid(state, { tenantId: 'acme', secret: APP.clientSecret, now: NOW + 11 * 60 * 1000 })).toBe(false);
  });

  it('lê o token com e sem refresh token, e escopo separado por vírgula ou espaço', () => {
    expect(parseToken(TOKEN_OK)).toEqual({ accessToken: 'AQX-token', expiresInSeconds: 5184000, refreshToken: null, refreshExpiresInSeconds: null, scopes: ['openid', 'profile', 'w_member_social'] });
    const withRefresh = parseToken({ ...TOKEN_OK, refresh_token: 'RT-1', refresh_token_expires_in: 31536000, scope: 'openid profile w_member_social' });
    expect(withRefresh).toMatchObject({ refreshToken: 'RT-1', refreshExpiresInSeconds: 31536000, scopes: ['openid', 'profile', 'w_member_social'] });
    for (const bad of [null, [], 'x', {}, { access_token: 'a' }, { access_token: 'a', expires_in: 0 }, { access_token: '', expires_in: 10 }, { access_token: 'a', expires_in: 'x' }]) expect(() => parseToken(bad), JSON.stringify(bad)).toThrow();
  });

  it('lê quem é a pessoa pelo userinfo e monta o autor do post', () => {
    expect(parseProfile(INFO_OK)).toEqual({ memberId: 'AbC123xyz', name: 'Ana Ribeiro' });
    expect(parseProfile({ sub: 'x1', given_name: 'Bruno', family_name: 'Costa' })).toEqual({ memberId: 'x1', name: 'Bruno Costa' });
    expect(parseProfile({ sub: 'x1' })).toEqual({ memberId: 'x1', name: null });
    expect(() => parseProfile({ name: 'Sem id' })).toThrow();
    expect(authorUrn('AbC123xyz')).toBe('urn:li:person:AbC123xyz');
  });

  it('sem a permissão de publicar a conexão é recusada; as de perfil não barram', () => {
    expect(missingScopes(['openid', 'profile', 'w_member_social'])).toEqual([]);
    expect(missingScopes(['openid', 'profile'])).toEqual(['w_member_social']);
  });

  it('as mensagens da volta são claras, sem travessão, e cada chave existe', () => {
    for (const [key, f] of Object.entries(FLASH)) {
      expect(isFlashKey(key)).toBe(true);
      expect(f.text, key).not.toMatch(/[–—]/);
      expect(f.text.length, key).toBeGreaterThan(20);
    }
    expect(isFlashKey('qualquer')).toBe(false);
    expect(new ConnectError('no_publish').message).toBe(FLASH.no_publish.text);
  });
});

describe('quando renovar, avisar ou pedir reconexão', () => {
  const at = (days, over = {}) => ({ status: 'active', expiresAt: new Date(NOW + days * D), hasRefreshToken: false, expiringNotified: false, ...over });

  it('longe de vencer não faz nada', () => {
    expect(refreshDecision(at(REFRESH_WINDOW_DAYS + 5), NOW)).toBe('skip');
    expect(refreshDecision(at(40, { hasRefreshToken: true }), NOW)).toBe('skip');
  });

  it('com refresh token, renova dentro da janela', () => {
    expect(refreshDecision(at(REFRESH_WINDOW_DAYS - 1, { hasRefreshToken: true }), NOW)).toBe('refresh');
    expect(refreshDecision(at(1, { hasRefreshToken: true }), NOW)).toBe('refresh');
  });

  it('sem refresh token, avisa uma vez dentro da janela e não repete', () => {
    expect(refreshDecision(at(10), NOW)).toBe('warn');
    expect(refreshDecision(at(10, { expiringNotified: true }), NOW)).toBe('skip');
  });

  it('vencido pede reconexão, com ou sem refresh token; conta que não está ativa ou sem prazo é ignorada', () => {
    expect(refreshDecision(at(-1), NOW)).toBe('expired');
    expect(refreshDecision(at(-1, { hasRefreshToken: true }), NOW)).toBe('expired');
    expect(refreshDecision(at(5, { status: 'reauth_required' }), NOW)).toBe('skip');
    expect(refreshDecision(at(5, { status: 'revoked' }), NOW)).toBe('skip');
    expect(refreshDecision({ status: 'active', expiresAt: null, hasRefreshToken: false, expiringNotified: false }, NOW)).toBe('skip');
  });

  it('só refresh recusado é permanente; rede, limite e 5xx tentam de novo', () => {
    expect(isPermanentFailure({ status: 400, error: 'invalid_grant' })).toBe(true);
    expect(isPermanentFailure({ status: 401, error: null })).toBe(true);
    for (const f of [{ status: null, error: null }, { status: 429, error: null }, { status: 500, error: null }, { status: 400, error: 'temporarily_unavailable' }, { status: 400, error: null }]) expect(isPermanentFailure(f), JSON.stringify(f)).toBe(false);
  });
});

describe('chamadas ao LinkedIn (simulado)', () => {
  it('o app só existe com client id e secret', () => {
    expect(oauthApp({})).toBeNull();
    expect(oauthApp({ LINKEDIN_CLIENT_ID: 'a' })).toBeNull();
    expect(oauthApp({ LINKEDIN_CLIENT_ID: ' a ', LINKEDIN_CLIENT_SECRET: ' b ' })).toEqual({ clientId: 'a', clientSecret: 'b' });
  });

  it('conecta: troca o código, confere a permissão e lê o perfil com o token novo', async () => {
    const li = fakeLinkedIn({ [TOKEN]: () => ({ json: { ...TOKEN_OK, refresh_token: 'RT-9' } }), [USERINFO]: () => ({ json: INFO_OK }) });
    const out = await connectWithCode({ code: 'CODE', redirectUri: 'https://app.test/api/linkedin/callback', app: APP }, li.fetchFn, NOW);
    expect(out).toMatchObject({ accessToken: 'AQX-token', refreshToken: 'RT-9', scopes: ['openid', 'profile', 'w_member_social'], profile: { memberId: 'AbC123xyz', name: 'Ana Ribeiro' } });
    expect(out.expiresAt.getTime()).toBe(NOW + 5184000 * 1000);
    expect(li.calls[0].body).toEqual({ grant_type: 'authorization_code', code: 'CODE', redirect_uri: 'https://app.test/api/linkedin/callback', client_id: 'cid-123', client_secret: 'secret-abc' });
    expect(li.calls[1].auth).toBe('Bearer AQX-token');
  });

  it('sem a permissão de publicar, para antes de ler o perfil', async () => {
    const li = fakeLinkedIn({ [TOKEN]: () => ({ json: { ...TOKEN_OK, scope: 'openid,profile' } }), [USERINFO]: () => ({ json: INFO_OK }) });
    await expect(connectWithCode({ code: 'C', redirectUri: 'https://x', app: APP }, li.fetchFn, NOW)).rejects.toMatchObject({ flash: 'no_publish' });
    expect(li.calls).toHaveLength(1);
  });

  it('o LinkedIn recusar ou cair vira erro sem token nem corpo, e a rede fora é passageira', async () => {
    const refused = fakeLinkedIn({ [TOKEN]: () => ({ status: 400, json: { error: 'invalid_grant', error_description: 'código SEGREDO' } }) });
    const e1 = await connectWithCode({ code: 'C', redirectUri: 'https://x', app: APP }, refused.fetchFn, NOW).catch((e) => e);
    expect(e1).toBeInstanceOf(LinkedInApiError);
    expect(e1).toMatchObject({ step: 'code', status: 400, error: 'invalid_grant', permanent: true });
    expect(e1.message).not.toContain('SEGREDO');
    const down = fakeLinkedIn({ [TOKEN]: () => new Error('ECONNRESET') });
    const e2 = await connectWithCode({ code: 'C', redirectUri: 'https://x', app: APP }, down.fetchFn, NOW).catch((e) => e);
    expect(e2).toMatchObject({ status: null, permanent: false });
  });

  it('renova com o refresh token e guarda o novo, ou o anterior quando o LinkedIn não manda outro', async () => {
    const a = fakeLinkedIn({ [TOKEN]: () => ({ json: { ...TOKEN_OK, access_token: 'novo-1', refresh_token: 'RT-novo' } }) });
    expect(await refreshWithToken('RT-velho', APP, a.fetchFn, NOW)).toMatchObject({ accessToken: 'novo-1', refreshToken: 'RT-novo' });
    expect(a.calls[0].body).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'RT-velho', client_id: 'cid-123' });
    const b = fakeLinkedIn({ [TOKEN]: () => ({ json: { ...TOKEN_OK, access_token: 'novo-2' } }) });
    expect(await refreshWithToken('RT-velho', APP, b.fetchFn, NOW)).toMatchObject({ accessToken: 'novo-2', refreshToken: 'RT-velho' });
  });
});

describe('a tela de redes do LinkedIn', () => {
  const acc = (over = {}) => ({ id: 'a1', channel: 'linkedin', handle: 'Ana Ribeiro', status: 'active', expiresAt: new Date(NOW + 40 * D).toISOString(), connectedAt: new Date(NOW).toISOString(), scopes: [], ...over });
  const input = (over = {}) => ({ accounts: [], configured: true, canManage: true, nowMs: NOW, ...over });

  it('sem conta: conectar para quem administra, com o motivo para quem não pode ou quando o app não está configurado', () => {
    expect(linkedinView(input())).toEqual({ kind: 'none', canConnect: true, blockedReason: null });
    expect(linkedinView(input({ canManage: false }))).toMatchObject({ canConnect: false, blockedReason: expect.stringContaining('administradores') });
    expect(linkedinView(input({ configured: false }))).toMatchObject({ canConnect: false, blockedReason: expect.stringContaining('ainda não está ativa') });
  });

  it('conectado mostra os dias que faltam e destaca quando vence em breve', () => {
    expect(linkedinView(input({ accounts: [acc()] }))).toMatchObject({ kind: 'connected', id: 'a1', handle: 'Ana Ribeiro', daysLeft: 40, expiringSoon: false });
    expect(linkedinView(input({ accounts: [acc({ expiresAt: new Date(NOW + 5 * D).toISOString() })] }))).toMatchObject({ kind: 'connected', daysLeft: 5, expiringSoon: true });
  });

  it('precisa reconectar quando o status pede ou o prazo acabou; conta revogada e de outra rede não contam', () => {
    expect(linkedinView(input({ accounts: [acc({ status: 'reauth_required' })] }))).toEqual({ kind: 'reauth', id: 'a1', handle: 'Ana Ribeiro' });
    expect(linkedinView(input({ accounts: [acc({ expiresAt: new Date(NOW - D).toISOString() })] }))).toMatchObject({ kind: 'reauth' });
    expect(linkedinView(input({ accounts: [acc({ status: 'revoked' }), acc({ channel: 'instagram' })] })).kind).toBe('none');
  });
});

// A credencial do LinkedIn mora no banco, cifrada, por conta. Variável de ambiente só para o app (client id e secret), a versão da API e a chave que liga as páginas (LINKEDIN_PAGES).
describe('nenhuma credencial do LinkedIn vem do ambiente', () => {
  const walk = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));
  const files = walk(new URL('../platform/src', import.meta.url).pathname).filter((f) => /\.(ts|tsx)$/.test(f));

  it('só o app (client id e secret), a versão da API e a chave das páginas são lidos do ambiente', () => {
    const allowed = new Set(['LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET', 'LINKEDIN_VERSION', 'LINKEDIN_PAGES']);
    for (const file of files) {
      const found = [...readFileSync(file, 'utf8').matchAll(/(?:env|process\.env)\.?\[?['"]?(LINKEDIN_[A-Z_]+)/g)].map((m) => m[1]);
      for (const name of found) expect(allowed.has(name), `${file}: ${name}`).toBe(true);
    }
  });

  it('o adapter de publicação não importa a configuração do app nem lê token do ambiente', () => {
    const src = readFileSync(new URL('../platform/src/lib/channels/linkedin.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/LINKEDIN_ACCESS_TOKEN|LINKEDIN_AUTHOR_URN|LINKEDIN_CLIENT/);
    expect(src).toContain('export type LinkedInCreds');
  });
});

describe('evento de conexão (BEZ-450)', () => {
  it('diz só se o LinkedIn devolveu refresh token, nunca o token', () => {
    expect(connectedProps({ refreshToken: 'AQX-refresh-token-longo-demais-para-um-evento-123456789' })).toEqual({ has_refresh: true });
    expect(connectedProps({ refreshToken: null })).toEqual({ has_refresh: false });
  });

  it('a conexão de verdade passa pelo helper: com e sem refresh token no corpo', async () => {
    const reply = (body) => async (url) => new Response(JSON.stringify(String(url).includes('userinfo') ? { sub: 'abc123', name: 'Ana' } : body), { status: 200 });
    const app = { clientId: 'id', clientSecret: 'segredo' };
    const base = { access_token: 'acesso', expires_in: 5184000, scope: 'openid,profile,w_member_social' };
    const withRefresh = await connectWithCode({ code: 'c', redirectUri: 'https://app.test/api/linkedin/callback', app }, reply({ ...base, refresh_token: 'r', refresh_token_expires_in: 31536000 }));
    const without = await connectWithCode({ code: 'c', redirectUri: 'https://app.test/api/linkedin/callback', app }, reply(base));
    expect(connectedProps(withRefresh)).toEqual({ has_refresh: true });
    expect(connectedProps(without)).toEqual({ has_refresh: false });
  });
});

describe('publicar como página (BEZ-455)', () => {
  const PAGE_TOKEN = { ...TOKEN_OK, scope: 'openid,profile,w_member_social,r_organization_admin,w_organization_social' };
  const ACLS = { elements: [
    { role: 'ADMINISTRATOR', organization: 'urn:li:organization:111', roleAssignee: 'urn:li:person:x', state: 'APPROVED' },
    { role: 'CONTENT_ADMINISTRATOR', organizationTarget: 'urn:li:organization:222', state: 'APPROVED' },
    { role: 'ANALYST', organization: 'urn:li:organization:333', state: 'APPROVED' },
    { role: 'ADMINISTRATOR', organization: 'urn:li:organization:444', state: 'REQUESTED' },
    { role: 'ADMINISTRATOR', organization: 'urn:li:organization:111', state: 'APPROVED' },
    { role: 'ADMINISTRATOR', organization: 'urn:li:person:zzz', state: 'APPROVED' },
  ] };
  const LOOKUP = { results: { 111: { localizedName: 'Bez Company' }, 222: { localizedName: '  Doce Ponto  ' } } };

  // LinkedIn simulado: devolve o que cada endereço pede e guarda as chamadas.
  const linkedin = (overrides = {}) => {
    const calls = [];
    const fetchFn = async (url, init = {}) => {
      const u = String(url);
      calls.push({ url: u, headers: init.headers ?? {} });
      const hit = Object.entries(overrides).find(([k]) => u.includes(k));
      if (hit) return typeof hit[1] === 'function' ? hit[1]() : hit[1];
      if (u.includes('accessToken')) return new Response(JSON.stringify(PAGE_TOKEN), { status: 200 });
      if (u.includes('userinfo')) return new Response(JSON.stringify({ sub: 'mem-1', name: 'Ana Ribeiro' }), { status: 200 });
      if (u.includes('organizationAcls')) return new Response(JSON.stringify(ACLS), { status: 200 });
      if (u.includes('organizationsLookup')) return new Response(JSON.stringify(LOOKUP), { status: 200 });
      return new Response('{}', { status: 404 });
    };
    return { calls, fetchFn };
  };
  const connect = (fetchFn) => connectWithCode({ code: 'c', redirectUri: 'https://app.test/api/linkedin/callback', app: APP }, fetchFn, NOW);

  it('os escopos de página só entram na autorização quando o ambiente liga', () => {
    const base = { clientId: 'c', redirectUri: 'https://app.test/cb', state: 's' };
    const off = new URL(buildAuthorizeUrl(base)).searchParams.get('scope');
    const on = new URL(buildAuthorizeUrl({ ...base, pages: true })).searchParams.get('scope');
    expect(off).toBe(SCOPES.join(' '));
    expect(on.split(' ')).toEqual([...SCOPES, ...PAGE_SCOPES]);
    expect(pagesEnabled({ LINKEDIN_PAGES: '1' })).toBe(true);
    expect(pagesEnabled({ LINKEDIN_PAGES: 'true' })).toBe(false);
    expect(pagesEnabled({})).toBe(false);
    expect(hasPageScopes(['r_organization_admin', 'w_organization_social', 'openid'])).toBe(true);
    expect(hasPageScopes(['w_organization_social'])).toBe(false);
  });

  it('lê só as organizações aprovadas em que a pessoa pode publicar, sem repetir nem aceitar outro tipo de urn', () => {
    expect(parseAcls(ACLS)).toEqual(['urn:li:organization:111', 'urn:li:organization:222']);
    expect(parseAcls({})).toEqual([]);
    expect(parseAcls(null)).toEqual([]);
    expect(isOrganizationUrn('urn:li:organization:12')).toBe(true);
    expect(isOrganizationUrn('urn:li:organization:abc')).toBe(false);
    expect(isOrganizationUrn('urn:li:person:12')).toBe(false);
    expect(organizationId('urn:li:organization:12')).toBe('12');
  });

  it('o nome vem do lookup; sem nome legível a página aparece com o número', () => {
    expect(parsePages(['urn:li:organization:111', 'urn:li:organization:222', 'urn:li:organization:333'], LOOKUP)).toEqual([
      { urn: 'urn:li:organization:111', name: 'Bez Company' },
      { urn: 'urn:li:organization:222', name: 'Doce Ponto' },
      { urn: 'urn:li:organization:333', name: 'Página 333' },
    ]);
    expect(parsePages(['urn:li:organization:5'], null)).toEqual([{ urn: 'urn:li:organization:5', name: 'Página 5' }]);
    expect(storedPages([{ urn: 'urn:li:organization:1', name: 'A' }, { urn: 'urn:li:person:1', name: 'B' }, { urn: 'urn:li:organization:2' }, null])).toEqual([{ urn: 'urn:li:organization:1', name: 'A' }]);
    expect(storedPages('x')).toEqual([]);
  });

  it('conectar com os escopos de página traz as páginas, e a chamada leva a versão e o token no cabeçalho', async () => {
    const { calls, fetchFn } = linkedin();
    const connected = await connect(fetchFn);
    expect(connected.pages).toEqual([{ urn: 'urn:li:organization:111', name: 'Bez Company' }, { urn: 'urn:li:organization:222', name: 'Doce Ponto' }]);
    const acls = calls.find((c) => c.url.includes('organizationAcls'));
    expect(acls.url).toContain('q=roleAssignee');
    expect(acls.headers).toMatchObject({ Authorization: 'Bearer AQX-token', 'LinkedIn-Version': API_VERSION, 'X-Restli-Protocol-Version': '2.0.0' });
    expect(calls.find((c) => c.url.includes('organizationsLookup')).url).toContain('ids=List(111,222)');
  });

  it('sem os escopos de página, nenhuma chamada de página é feita', async () => {
    const { calls, fetchFn } = linkedin({ accessToken: new Response(JSON.stringify(TOKEN_OK), { status: 200 }) });
    const connected = await connect(fetchFn);
    expect(connected.pages).toEqual([]);
    expect(calls.some((c) => c.url.includes('organization'))).toBe(false);
  });

  it('falha ao ler as páginas não derruba a conexão do perfil', async () => {
    const { fetchFn } = linkedin({ organizationAcls: () => new Response('{"message":"forbidden"}', { status: 403 }) });
    const connected = await connect(fetchFn);
    expect(connected.pages).toEqual([]);
    expect(connected.profile.memberId).toBe('mem-1');
  });

  it('falha só no nome das páginas mantém a lista, com o número no lugar do nome', async () => {
    const { fetchFn } = linkedin({ organizationsLookup: () => new Response('{}', { status: 500 }) });
    expect((await connect(fetchFn)).pages.map((p) => p.name)).toEqual(['Página 111', 'Página 222']);
    await expect(fetchPages('t', async () => new Response('{}', { status: 401 }))).rejects.toBeInstanceOf(LinkedInApiError);
  });

  it('a tela mostra o destino: perfil por padrão, página quando escolhida, e se o ambiente já libera páginas', () => {
    const account = { id: 'a1', channel: 'linkedin', handle: 'Ana Ribeiro', status: 'active', expiresAt: new Date(NOW + 40 * D).toISOString(), connectedAt: '', scopes: [], pages: [{ urn: 'urn:li:organization:111', name: 'Bez Company' }], publishAs: null };
    const view = (over, pagesEnabled = true) => linkedinView({ accounts: [{ ...account, ...over }], configured: true, canManage: true, nowMs: NOW, pagesEnabled }).destination;
    expect(view({})).toMatchObject({ pagesEnabled: true, publishAs: null, publishingAs: 'Ana Ribeiro' });
    expect(view({ publishAs: 'urn:li:organization:111' })).toMatchObject({ publishAs: 'urn:li:organization:111', publishingAs: 'Bez Company' });
    expect(view({ publishAs: 'urn:li:organization:999' })).toMatchObject({ publishAs: null, publishingAs: 'Ana Ribeiro' }); // página que saiu da lista
    expect(view({}, false).pagesEnabled).toBe(false);
  });

  it('os avisos novos existem e não têm travessão', () => {
    for (const key of ['choose_page', 'no_pages', 'page_saved']) {
      expect(isFlashKey(key)).toBe(true);
      expect(FLASH[key].text).not.toMatch(/[–—]/);
    }
  });
});
