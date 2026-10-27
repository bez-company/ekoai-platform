import { describe, it, expect, vi, beforeEach } from 'vitest';

// Seu perfil (BEZ-304): o parser do nome, o texto da verificação em duas etapas por estado e a rota
// que grava o nome. Sessão e banco simulados: aqui só a ligação da rota.
const sessionMock = { error: null, calls: [] };
vi.mock('@/lib/session', () => {
  class UnauthorizedError extends Error {}
  class ForbiddenError extends Error {}
  return {
    UnauthorizedError,
    ForbiddenError,
    requireUserPermission: async (permission) => {
      sessionMock.calls.push(permission);
      if (sessionMock.error) throw sessionMock.error;
      return { t: { tenantId: 'acme' }, user: { id: 'u1', name: 'Ana' } };
    },
  };
});
const dataMock = { renamed: [], phones: [] };
vi.mock('@/lib/accounts', () => ({
  renameUser: async (id, name) => void dataMock.renamed.push([id, name]),
  setUserPhone: async (id, phone) => void dataMock.phones.push([id, phone]),
}));

const { PUT } = await import('../platform/src/app/api/me/route.ts');
const { NAME_MAX, PHONE_ERROR, formatPhone, mfaView, normalizePhone, parseOptionalPhone, parsePersonName } = await import('@/lib/person-profile-model');
const { ForbiddenError, UnauthorizedError } = await import('@/lib/session');

const put = (body) => PUT(new Request('http://app.test/api/me', { method: 'PUT', body: typeof body === 'string' ? body : JSON.stringify(body) }));

beforeEach(() => {
  Object.assign(sessionMock, { error: null, calls: [] });
  dataMock.renamed = [];
  dataMock.phones = [];
});

describe('parsePersonName', () => {
  it('limpa espaços e quebras de linha', () => {
    expect(parsePersonName({ name: '  Ana   Maria\n Ribeiro ' })).toEqual({ ok: true, value: { name: 'Ana Maria Ribeiro' } });
  });

  it('recusa vazio, só espaço e tipo errado, com o próximo passo', () => {
    for (const body of [null, {}, { name: 42 }, { name: '' }, { name: '   \n ' }, [], 'Ana']) {
      const r = parsePersonName(body);
      expect(r.ok).toBe(false);
      expect(r.error).toBe('Digite o seu nome.');
    }
  });

  it('recusa nome acima do limite', () => {
    expect(parsePersonName({ name: 'a'.repeat(NAME_MAX) }).ok).toBe(true);
    const r = parsePersonName({ name: 'a'.repeat(NAME_MAX + 1) });
    expect(r.ok).toBe(false);
    expect(r.error).toContain(String(NAME_MAX));
  });
});

describe('mfaView', () => {
  it('desligada: oferece ativar; se o papel exige, avisa que precisa', () => {
    const optional = mfaView('off', false);
    expect(optional.action).toBe('enable');
    expect(optional.description).toMatch(/Recomendamos ligar/);
    const required = mfaView('off', true);
    expect(required.action).toBe('enable');
    expect(required.description).toMatch(/Administradores precisam/);
  });

  it('ligada: oferece desligar, a menos que o administrador a exija para entrar', () => {
    expect(mfaView('on', false).action).toBe('disable');
    const locked = mfaView('on', true);
    expect(locked.action).toBeNull();
    expect(locked.actionLabel).toBeNull();
    expect(locked.description).toMatch(/não dá para desligar/);
  });

  it('sem leitura do provedor: não afirma nada e não oferece ação', () => {
    const v = mfaView('unknown', false);
    expect(v.action).toBeNull();
    expect(v.description).toMatch(/Não deu para ler/);
  });
});

describe('PUT /api/me', () => {
  it('pede content.view e grava o nome da pessoa da sessão', async () => {
    const res = await put({ name: ' Ana  Ribeiro ' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, name: 'Ana Ribeiro', phone: null });
    expect(sessionMock.calls).toEqual(['content.view']);
    expect(dataMock.renamed).toEqual([['u1', 'Ana Ribeiro']]);
  });

  it('grava o celular em E.164 e apaga quando vem vazio', async () => {
    const res = await put({ name: 'Ana', phone: '(11) 91234-5678' });
    expect(await res.json()).toEqual({ ok: true, name: 'Ana', phone: '+5511912345678' });
    expect(dataMock.phones).toEqual([['u1', '+5511912345678']]);
    await put({ name: 'Ana', phone: '  ' });
    expect(dataMock.phones.at(-1)).toEqual(['u1', null]);
  });

  it('celular inválido volta 400 e não grava nada', async () => {
    const res = await put({ name: 'Ana', phone: '1234' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(PHONE_ERROR);
    expect(dataMock.renamed).toEqual([]);
    expect(dataMock.phones).toEqual([]);
  });

  it('ignora um id no corpo: o alvo é sempre a pessoa da sessão', async () => {
    await put({ name: 'Ana', id: 'outra-pessoa', userId: 'outra-pessoa' });
    expect(dataMock.renamed).toEqual([['u1', 'Ana']]);
  });

  it('corpo inválido volta 400 e não grava', async () => {
    const res = await put({ name: '   ' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Digite o seu nome.');
    expect((await put('{quebrado')).status).toBe(400);
    expect(dataMock.renamed).toEqual([]);
  });

  it('sessão vencida volta 401 e sem permissão volta 403, sem gravar', async () => {
    sessionMock.error = new UnauthorizedError();
    expect((await put({ name: 'Ana' })).status).toBe(401);
    sessionMock.error = new ForbiddenError();
    expect((await put({ name: 'Ana' })).status).toBe(403);
    expect(dataMock.renamed).toEqual([]);
  });
});

describe('celular', () => {
  it('normaliza as formas comuns para E.164 e só aceita celular com DDD', () => {
    for (const raw of ['(11) 91234-5678', '11912345678', '+55 11 91234-5678', '5511912345678']) expect(normalizePhone(raw)).toBe('+5511912345678');
    for (const raw of ['', '1234', '(11) 1234-5678', '(01) 91234-5678', '+1 415 555 0100']) expect(normalizePhone(raw)).toBeNull();
  });

  it('mostra no formato brasileiro e devolve vazio sem número', () => {
    expect(formatPhone('+5511912345678')).toBe('(11) 91234-5678');
    expect(formatPhone(null)).toBe('');
  });

  it('campo opcional: ausente e vazio valem null, inválido é erro', () => {
    expect(parseOptionalPhone(undefined)).toEqual({ ok: true, value: null });
    expect(parseOptionalPhone('')).toEqual({ ok: true, value: null });
    expect(parseOptionalPhone('11912345678')).toEqual({ ok: true, value: '+5511912345678' });
    expect(parseOptionalPhone('abc')).toEqual({ ok: false, error: PHONE_ERROR });
    expect(parseOptionalPhone(42)).toEqual({ ok: false, error: PHONE_ERROR });
  });
});
