import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// As rotas do staging sob demanda (SPEC 016). A API do Google e o banco são trocados por dublês;
// o que se prova aqui é o contrato de cada rota e que fora do staging elas não existem.
const power = { policy: vi.fn(), lastUpdate: vi.fn(), setPolicy: vi.fn(), userRequests: vi.fn() };
const probe = vi.fn();
const pending = vi.fn();
const runDue = vi.fn();
vi.mock('@/lib/publish', () => ({ hasPendingPublishes: (...a) => pending(...a), reconcileStalePublishing: async () => ({ checked: 0 }), runPublishDue: (...a) => runDue(...a) }));
vi.mock('@/lib/log', () => ({ log: () => undefined, logError: () => undefined }));
vi.mock('@/lib/stale-approvals', () => ({ runStaleApprovals: async () => ({ warned: 0, asked: 0 }) }));
vi.mock('@/lib/env-power', async (orig) => ({ ...(await orig()), powerClient: () => power, probeDb: (...a) => probe(...a) }));

const { GET: live } = await import('../platform/src/app/api/live/route.ts');
const { GET: estado } = await import('../platform/src/app/api/ambiente/route.ts');
const { POST: ligar } = await import('../platform/src/app/api/ambiente/ligar/route.ts');
const { POST: sleepIfIdle } = await import('../platform/src/app/api/cron/sleep-if-idle/route.ts');
const { POST: publishDue } = await import('../platform/src/app/api/cron/publish-due/route.ts');
const { resetWakeThrottle } = await import('../platform/src/lib/env-power.ts');
const { middleware } = await import('../platform/src/middleware.ts');
const { NextRequest } = await import('../platform/node_modules/next/server.js');

const saved = { ...process.env };
const ON = { WAKE_ENABLED: 'true', WAKE_SQL_PROJECT: 'proj-staging', WAKE_SQL_INSTANCE: 'ekoai-pg', CRON_SECRET: 'segredo-do-teste' };
const cron = (token) => new Request('http://x/api/cron/sleep-if-idle', { method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {} });
const MIN = 60_000;
const publishCron = () => new Request('http://x/api/cron/publish-due', { method: 'POST', headers: { authorization: 'Bearer segredo-do-teste' } });

beforeEach(() => {
  Object.assign(process.env, ON);
  Object.values(power).forEach((m) => m.mockReset());
  probe.mockReset().mockResolvedValue(false);
  pending.mockReset().mockResolvedValue(false);
  power.lastUpdate.mockResolvedValue({ startedAtMs: Date.now() - 6 * MIN, status: 'RUNNING', failed: false });
  resetWakeThrottle();
});
afterEach(() => { process.env = { ...saved }; });

describe('GET /api/live', () => {
  it('responde 200 sem tocar no banco, para o Cloud Run subir com o banco parado', async () => {
    const res = await live();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
    expect(probe).not.toHaveBeenCalled();
  });
});

describe('GET /api/ambiente', () => {
  it('fora do staging é 404', async () => {
    delete process.env.WAKE_ENABLED;
    expect((await estado()).status).toBe(404);
  });

  it('banco respondendo é pronto, sem chamar o Google', async () => {
    probe.mockResolvedValue(true);
    const body = await (await estado()).json();
    expect(body.state).toBe('ready');
    expect(power.policy).not.toHaveBeenCalled();
  });

  it('banco fora com política NEVER é dormindo', async () => {
    power.policy.mockResolvedValue('NEVER');
    expect((await (await estado()).json()).state).toBe('sleeping');
  });

  it('banco fora com política ALWAYS é ligando, com o tempo corrido', async () => {
    power.policy.mockResolvedValue('ALWAYS');
    const body = await (await estado()).json();
    expect(body.state).toBe('starting');
    expect(body.elapsedS).toBeGreaterThanOrEqual(359);
  });

  it('falha ao consultar o Google vira estado de erro com mensagem, não 500', async () => {
    power.policy.mockRejectedValue(new Error('Google Cloud 403: x'));
    const res = await estado();
    expect(res.status).toBe(200);
    expect((await res.json())).toMatchObject({ state: 'error', message: expect.stringContaining('Cloud SQL') });
  });
});

describe('POST /api/ambiente/ligar', () => {
  it('fora do staging é 404 e não liga nada', async () => {
    delete process.env.WAKE_ENABLED;
    expect((await ligar()).status).toBe(404);
    expect(power.setPolicy).not.toHaveBeenCalled();
  });

  it('dormindo: liga o banco e devolve 202 ligando', async () => {
    power.policy.mockResolvedValue('NEVER');
    const res = await ligar();
    expect(res.status).toBe(202);
    expect(power.setPolicy).toHaveBeenCalledWith('ALWAYS');
    expect((await res.json()).state).toBe('starting');
  });

  it('dois pedidos seguidos ligam uma vez só', async () => {
    power.policy.mockResolvedValue('NEVER');
    await ligar();
    await ligar();
    expect(power.setPolicy).toHaveBeenCalledTimes(1);
  });

  it('já ligando ou de pé não chama o PATCH', async () => {
    power.policy.mockResolvedValue('ALWAYS');
    await ligar();
    expect(power.setPolicy).not.toHaveBeenCalled();
    probe.mockResolvedValue(true);
    expect((await (await ligar()).json()).state).toBe('ready');
  });

  it('o Google recusar vira 502 com estado de erro', async () => {
    power.policy.mockResolvedValue('NEVER');
    power.setPolicy.mockRejectedValue(new Error('Google Cloud 403'));
    const res = await ligar();
    expect(res.status).toBe(502);
    expect((await res.json()).state).toBe('error');
  });
});

describe('POST /api/cron/sleep-if-idle', () => {
  it('sem credencial é 401 e nada acontece', async () => {
    expect((await sleepIfIdle(cron())).status).toBe(401);
    expect((await sleepIfIdle(cron('errado'))).status).toBe(401);
    expect(power.policy).not.toHaveBeenCalled();
  });

  it('fora do staging não faz nada', async () => {
    delete process.env.WAKE_ENABLED;
    const body = await (await sleepIfIdle(cron('segredo-do-teste'))).json();
    expect(body).toMatchObject({ ok: true, action: 'none' });
  });

  it('desliga o banco sem uso há mais que a janela', async () => {
    power.policy.mockResolvedValue('ALWAYS');
    power.lastUpdate.mockResolvedValue({ startedAtMs: Date.now() - 180 * MIN, status: 'DONE', failed: false });
    power.userRequests.mockResolvedValue(0);
    const body = await (await sleepIfIdle(cron('segredo-do-teste'))).json();
    expect(body).toMatchObject({ ok: true, action: 'stopped' });
    expect(power.setPolicy).toHaveBeenCalledWith('NEVER');
    expect(power.userRequests).toHaveBeenCalledWith(60);
  });

  it('com uso na janela, o banco continua ligado', async () => {
    power.policy.mockResolvedValue('ALWAYS');
    power.lastUpdate.mockResolvedValue({ startedAtMs: Date.now() - 180 * MIN, status: 'DONE', failed: false });
    power.userRequests.mockResolvedValue(12);
    const body = await (await sleepIfIdle(cron('segredo-do-teste'))).json();
    expect(body).toMatchObject({ action: 'none', requests: 12 });
    expect(power.setPolicy).not.toHaveBeenCalled();
  });

  it('com post agendado esperando, o banco continua ligado mesmo sem uso', async () => {
    power.policy.mockResolvedValue('ALWAYS');
    power.lastUpdate.mockResolvedValue({ startedAtMs: Date.now() - 180 * MIN, status: 'DONE', failed: false });
    power.userRequests.mockResolvedValue(0);
    pending.mockResolvedValue(true);
    const body = await (await sleepIfIdle(cron('segredo-do-teste'))).json();
    expect(body).toMatchObject({ ok: true, action: 'none', reason: expect.stringContaining('post agendado') });
    expect(power.setPolicy).not.toHaveBeenCalled();
  });

  it('falha ao ler os agendados deixa o banco ligado (500)', async () => {
    power.policy.mockResolvedValue('ALWAYS');
    power.lastUpdate.mockResolvedValue({ startedAtMs: Date.now() - 180 * MIN, status: 'DONE', failed: false });
    power.userRequests.mockResolvedValue(0);
    pending.mockRejectedValue(new Error('Falha ao buscar agendados'));
    expect((await sleepIfIdle(cron('segredo-do-teste'))).status).toBe(500);
    expect(power.setPolicy).not.toHaveBeenCalled();
  });

  it('banco já desligado não consulta o uso nem muda nada', async () => {
    power.policy.mockResolvedValue('NEVER');
    const body = await (await sleepIfIdle(cron('segredo-do-teste'))).json();
    expect(body.action).toBe('none');
    expect(power.userRequests).not.toHaveBeenCalled();
    expect(pending).not.toHaveBeenCalled();
    expect(power.setPolicy).not.toHaveBeenCalled();
  });

  it('qualquer falha deixa o banco ligado: métrica ausente é 500 e não desliga', async () => {
    power.policy.mockResolvedValue('ALWAYS');
    power.userRequests.mockRejectedValue(new Error('Google Cloud 404: Metric not found'));
    const res = await sleepIfIdle(cron('segredo-do-teste'));
    expect(res.status).toBe(500);
    expect(power.setPolicy).not.toHaveBeenCalled();
  });
});

describe('middleware: o que é público sem sessão', () => {
  const pass = async (path) => {
    const res = await middleware(new NextRequest(`http://x${path}`));
    return res.headers.get('x-middleware-next') === '1';
  };

  it('libera só os três caminhos exatos do staging sob demanda', async () => {
    expect(await pass('/api/live')).toBe(true);
    expect(await pass('/api/ambiente')).toBe(true);
    expect(await pass('/api/ambiente/ligar')).toBe(true);
  });

  it('não libera o que estiver debaixo deles nem rota vizinha', async () => {
    expect(await pass('/api/ambiente/outra')).toBe(false);
    expect(await pass('/api/live/x')).toBe(false);
    expect(await pass('/api/ambientes')).toBe(false);
  });
});

describe('POST /api/cron/publish-due com o staging sob demanda (BEZ-482)', () => {
  beforeEach(() => runDue.mockReset().mockResolvedValue({ due: 0, published: 0, failed: 0 }));

  it('banco dormindo ou ligando responde 200 sem rodar o ciclo', async () => {
    probe.mockResolvedValue(false);
    const res = await publishDue(publishCron());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, skipped: 'ambiente dormindo ou ligando' });
    expect(runDue).not.toHaveBeenCalled();
  });

  it('banco respondendo roda o ciclo normal', async () => {
    probe.mockResolvedValue(true);
    const res = await publishDue(publishCron());
    expect(res.status).toBe(200);
    expect(runDue).toHaveBeenCalledTimes(1);
  });

  it('fora do staging nem confere o banco: o ciclo roda sempre e falha de banco continua sendo erro', async () => {
    delete process.env.WAKE_ENABLED;
    const res = await publishDue(publishCron());
    expect(res.status).toBe(200);
    expect(runDue).toHaveBeenCalledTimes(1);
    expect(probe).not.toHaveBeenCalled();
  });
});
