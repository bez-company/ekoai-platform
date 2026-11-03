import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as m from '../platform/src/lib/instagram-oauth-model.ts';

// A rota abaixo usa uma versão da variável controlada pelo teste; a regra de verdade se testa pelo módulo real.
const { instagramOnboardingEnabled, onboardingFlash } = await vi.importActual('../platform/src/lib/instagram-onboarding.ts');
const input = { tenantId: 't1', secret: 'segredo', now: 1_000_000 };

describe('destino da volta, dentro do state assinado', () => {
  it('o state de redes continua no formato de sempre (3 partes) e vale como destino "canais"', () => {
    const state = m.createState({ ...input, nonce: 'abc' });
    expect(state.split('.')).toHaveLength(3);
    expect(m.readState(state, input)).toEqual({ valid: true, dest: 'canais' });
    expect(m.createState({ ...input, nonce: 'abc', dest: 'canais' })).toBe(state);
  });

  it('o state do cadastro leva o destino e a volta o devolve', () => {
    const state = m.createState({ ...input, nonce: 'abc', dest: 'onboarding' });
    expect(state.split('.')).toHaveLength(4);
    expect(m.readState(state, input)).toEqual({ valid: true, dest: 'onboarding' });
    expect(m.stateValid(state, input)).toBe(true);
  });

  it('trocar o destino, de qualquer lado, derruba a assinatura', () => {
    const onboarding = m.createState({ ...input, nonce: 'abc', dest: 'onboarding' });
    const [nonce, exp, , sig] = onboarding.split('.');
    expect(m.readState(`${nonce}.${exp}.canais.${sig}`, input).valid).toBe(false);
    expect(m.readState(`${nonce}.${exp}.https://mau.example.${sig}`, input).valid).toBe(false);
    expect(m.readState(`${nonce}.${exp}.admin.${sig}`, input).valid).toBe(false);
    const plain = m.createState({ ...input, nonce: 'abc' });
    const [n2, e2, s2] = plain.split('.');
    expect(m.readState(`${n2}.${e2}.onboarding.${s2}`, input).valid).toBe(false);
  });

  it('state de outra empresa, de outro segredo, vencido ou quebrado: inválido e volta para redes', () => {
    const state = m.createState({ ...input, nonce: 'abc', dest: 'onboarding' });
    const bad = { valid: false, dest: 'canais' };
    expect(m.readState(state, { ...input, tenantId: 't2' })).toEqual(bad);
    expect(m.readState(state, { ...input, secret: 'outro' })).toEqual(bad);
    expect(m.readState(state, { ...input, now: input.now + (m.STATE_TTL_SECONDS + 1) * 1000 })).toEqual(bad);
    for (const junk of [undefined, null, '', 'a.b', 'a.b.c.d.e', '..', 'a.1.onboarding.']) expect(m.readState(junk, input), String(junk)).toEqual(bad);
  });

  it('só os destinos da lista valem; qualquer outro valor é a tela de redes', () => {
    expect(m.parseDest('onboarding')).toBe('onboarding');
    expect(m.parseDest('canais')).toBe('canais');
    for (const v of [undefined, null, '', 'ONBOARDING', 'https://mau.example', '/inicio', 42, ['onboarding']]) expect(m.parseDest(v), String(v)).toBe('canais');
    expect(m.destPath('onboarding')).toBe('/boas-vindas');
    expect(m.destPath('canais')).toBe('/configuracoes/canais');
  });
});

describe('passo do Instagram no cadastro', () => {
  it('só liga com INSTAGRAM_ONBOARDING_CONNECT=true', () => {
    expect(instagramOnboardingEnabled({ INSTAGRAM_ONBOARDING_CONNECT: 'true' })).toBe(true);
    for (const v of [undefined, '', 'false', '1', 'TRUE', 'yes']) expect(instagramOnboardingEnabled({ INSTAGRAM_ONBOARDING_CONNECT: v }), String(v)).toBe(false);
  });

  it('o aviso da volta diz o que houve e o próximo passo, sem culpar a pessoa', () => {
    expect(onboardingFlash('denied')).toMatchObject({ tone: 'warn', text: expect.stringMatching(/Sem problema.*só com o site.*Configurações, Redes/) });
    expect(onboardingFlash('refused').text).toMatch(/ainda está liberando contas novas/);
    expect(onboardingFlash('refused').text).not.toMatch(/avise o suporte|culpa/i);
    expect(onboardingFlash('connected')).toMatchObject({ tone: 'ok' });
    // chaves da tela de redes que o cadastro usa como estão
    expect(onboardingFlash('not_professional').text).toMatch(/conta profissional/);
    expect(onboardingFlash('disconnected')).toBeNull();
    expect(onboardingFlash('inventada')).toBeNull();
    expect(onboardingFlash(undefined)).toBeNull();
  });
});

// ── rotas ──
const session = { error: null };
const flag = { on: true };
const app = { appId: 'app', appSecret: 'segredo' };
const calls = { saved: 0 };
vi.mock('@/lib/session', () => {
  class UnauthorizedError extends Error {}
  class ForbiddenError extends Error {}
  return {
    UnauthorizedError,
    ForbiddenError,
    requirePermission: async () => {
      if (session.error) throw session.error;
      return { tenantId: 't1' };
    },
    requireUserPermission: async () => {
      if (session.error) throw session.error;
      return { t: { tenantId: 't1' }, user: { id: 'u1' } };
    },
  };
});
vi.mock('@/lib/origin', () => ({ appOrigin: () => 'https://app.test' }));
vi.mock('@/lib/instagram-oauth', () => ({ instagramApp: () => app, connectWithCode: async () => ({ ok: true }), MetaApiError: class MetaApiError extends Error {} }));
vi.mock('@/lib/social-accounts', () => ({ saveInstagramConnection: async () => { calls.saved += 1; } }));
vi.mock('@/lib/analytics', () => ({ track: async () => {} }));
vi.mock('@/lib/log', async (orig) => ({ ...(await orig()), logError: async () => {}, log: () => {} }));
vi.mock('@/lib/instagram-onboarding', async (orig) => ({ ...(await orig()), instagramOnboardingEnabled: () => flag.on }));

const { GET: connect } = await import('../platform/src/app/api/instagram/connect/route.ts');
const { GET: callback } = await import('../platform/src/app/api/instagram/callback/route.ts');

const where = (res) => new URL(res.headers.get('location'));
beforeEach(() => {
  session.error = null;
  flag.on = true;
  calls.saved = 0;
});

describe('GET /api/instagram/connect', () => {
  it('sem destino: o state é o de sempre e a volta é a tela de redes', async () => {
    const res = await connect(new Request('https://app.test/api/instagram/connect'));
    const state = where(res).searchParams.get('state');
    expect(where(res).origin).toBe('https://www.instagram.com');
    expect(m.readState(state, { tenantId: 't1', secret: app.appSecret })).toEqual({ valid: true, dest: 'canais' });
  });

  it('?dest=onboarding leva o destino dentro do state assinado', async () => {
    const res = await connect(new Request('https://app.test/api/instagram/connect?dest=onboarding'));
    expect(m.readState(where(res).searchParams.get('state'), { tenantId: 't1', secret: app.appSecret })).toEqual({ valid: true, dest: 'onboarding' });
  });

  it('destino inventado vira a tela de redes (nunca uma URL da pessoa)', async () => {
    const res = await connect(new Request('https://app.test/api/instagram/connect?dest=https://mau.example/x'));
    expect(m.readState(where(res).searchParams.get('state'), { tenantId: 't1', secret: app.appSecret }).dest).toBe('canais');
  });

  it('com a variável desligada o cadastro não abre a conexão: volta ao cadastro com o aviso', async () => {
    flag.on = false;
    const res = await connect(new Request('https://app.test/api/instagram/connect?dest=onboarding'));
    expect(where(res).pathname + where(res).search).toBe('/boas-vindas?ig=unavailable');
  });

  it('a tela de redes não depende da variável', async () => {
    flag.on = false;
    const res = await connect(new Request('https://app.test/api/instagram/connect'));
    expect(where(res).origin).toBe('https://www.instagram.com');
  });
});

describe('GET /api/instagram/callback', () => {
  const stateFor = (dest) => m.createState({ tenantId: 't1', secret: app.secret ?? app.appSecret, dest });

  it('conexão que começou no cadastro termina no cadastro, com o resultado', async () => {
    const res = await callback(new Request(`https://app.test/api/instagram/callback?code=abc&state=${stateFor('onboarding')}`));
    expect(where(res).pathname + where(res).search).toBe('/boas-vindas?ig=connected');
    expect(calls.saved).toBe(1);
  });

  it('conexão que começou em redes termina em redes, como sempre', async () => {
    const res = await callback(new Request(`https://app.test/api/instagram/callback?code=abc&state=${stateFor(undefined)}`));
    expect(where(res).pathname + where(res).search).toBe('/configuracoes/canais?ig=connected');
  });

  it('a pessoa recusar no Instagram volta ao lugar de onde saiu, pelo state que a Meta devolve', async () => {
    const res = await callback(new Request(`https://app.test/api/instagram/callback?error=access_denied&state=${stateFor('onboarding')}`));
    expect(where(res).pathname + where(res).search).toBe('/boas-vindas?ig=denied');
    expect(calls.saved).toBe(0);
  });

  it('recusa com state ausente ou adulterado volta para redes', async () => {
    const a = await callback(new Request('https://app.test/api/instagram/callback?error=access_denied'));
    expect(where(a).pathname).toBe('/configuracoes/canais');
    const [n, e, , s] = stateFor('onboarding').split('.');
    const b = await callback(new Request(`https://app.test/api/instagram/callback?error=access_denied&state=${n}.${e}.onboarding.${s.slice(0, -1)}${s.endsWith('0') ? '1' : '0'}`));
    expect(where(b).pathname).toBe('/configuracoes/canais');
  });

  it('state de outra empresa com código: inválido, nada é gravado, e volta para redes', async () => {
    const other = m.createState({ tenantId: 'outra', secret: app.appSecret, dest: 'onboarding' });
    const res = await callback(new Request(`https://app.test/api/instagram/callback?code=abc&state=${other}`));
    expect(where(res).pathname + where(res).search).toBe('/configuracoes/canais?ig=invalid');
    expect(calls.saved).toBe(0);
  });
});

describe('o cadastro (componente de tela) não importa valores do módulo do servidor', () => {
  it('lib/instagram-onboarding.ts importa o OAuth (node:crypto): a tela só pode importar tipos dele', async () => {
    const { readFileSync } = await import('node:fs');
    for (const file of ['ProfileWizard.tsx', 'InstagramConnectCard.tsx']) {
      const src = readFileSync(new URL(`../platform/src/components/profile/${file}`, import.meta.url), 'utf8');
      const imports = [...src.matchAll(/^import\s+(.+?)\s+from\s+'@\/lib\/instagram-(?:onboarding|oauth-model)';/gm)].map((x) => x[1]);
      for (const i of imports) expect(i, `${file}: ${i}`).toMatch(/^type\s/);
    }
  });
});
