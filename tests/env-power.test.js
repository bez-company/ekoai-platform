import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  powerEnabled, powerConfig, statusOf, sleepDecision, powerClient, canWakeNow, markWake, resetWakeThrottle,
  WAKE_ESTIMATE_S, WAKE_GIVE_UP_S, WAKE_MIN_GAP_MS, ACTIVITY_METRIC,
} from '../platform/src/lib/env-power.ts';
import { environmentAsleep, resetWakeGate } from '../platform/src/lib/wake-gate.ts';

// Staging sob demanda (SPEC 016): a decisão de ligar, de desligar e o que a tela mostra.
const ON = { WAKE_ENABLED: 'true', WAKE_SQL_PROJECT: 'proj-staging', WAKE_SQL_INSTANCE: 'ekoai-pg' };
const NOW = Date.parse('2026-10-22T20:00:00Z');
const MIN = 60_000;

describe('configuração', () => {
  it('fica desligada sem WAKE_ENABLED=true, e então não há configuração', () => {
    expect(powerEnabled({})).toBe(false);
    expect(powerEnabled({ WAKE_ENABLED: 'false' })).toBe(false);
    expect(powerConfig({})).toBeNull();
  });

  it('ligada exige projeto e instância e falha cedo e claro sem eles', () => {
    expect(() => powerConfig({ WAKE_ENABLED: 'true' })).toThrow(/WAKE_SQL_PROJECT/);
    expect(powerConfig(ON)).toEqual({ project: 'proj-staging', instance: 'ekoai-pg', idleMinutes: 60 });
  });

  it('a janela de ociosidade tem piso de 15 minutos', () => {
    expect(() => powerConfig({ ...ON, WAKE_IDLE_MINUTES: '5' })).toThrow(/a partir de 15/);
    expect(() => powerConfig({ ...ON, WAKE_IDLE_MINUTES: 'abc' })).toThrow(/a partir de 15/);
    expect(powerConfig({ ...ON, WAKE_IDLE_MINUTES: '30' }).idleMinutes).toBe(30);
  });
});

describe('statusOf: o que a tela mostra', () => {
  const lastOp = (minAgo, extra = {}) => ({ startedAtMs: NOW - minAgo * MIN, status: 'RUNNING', failed: false, ...extra });

  it('banco respondendo é pronto, qualquer que seja o resto', () => {
    expect(statusOf({ dbReachable: true, policy: 'NEVER', lastOp: null, nowMs: NOW })).toMatchObject({ state: 'ready', elapsedS: null });
  });

  it('política NEVER e banco fora é dormindo', () => {
    expect(statusOf({ dbReachable: false, policy: 'NEVER', lastOp: lastOp(100), nowMs: NOW })).toMatchObject({ state: 'sleeping', estimateS: WAKE_ESTIMATE_S });
  });

  it('política ALWAYS e banco fora é ligando, com o tempo desde o pedido', () => {
    expect(statusOf({ dbReachable: false, policy: 'ALWAYS', lastOp: lastOp(6), nowMs: NOW })).toMatchObject({ state: 'starting', elapsedS: 360 });
    expect(statusOf({ dbReachable: false, policy: 'ALWAYS', lastOp: null, nowMs: NOW })).toMatchObject({ state: 'starting', elapsedS: null });
  });

  it('operação recusada, 30 minutos sem resposta, API fora ou política desconhecida são erro com mensagem', () => {
    expect(statusOf({ dbReachable: false, policy: 'ALWAYS', lastOp: lastOp(1, { failed: true }), nowMs: NOW })).toMatchObject({ state: 'error', message: expect.stringContaining('recusou') });
    expect(statusOf({ dbReachable: false, policy: 'ALWAYS', lastOp: lastOp(WAKE_GIVE_UP_S / 60 + 1), nowMs: NOW })).toMatchObject({ state: 'error', message: expect.stringContaining('30 minutos') });
    expect(statusOf({ dbReachable: false, policy: null, lastOp: null, nowMs: NOW, apiError: 'Não consegui consultar o Cloud SQL.' })).toMatchObject({ state: 'error', message: 'Não consegui consultar o Cloud SQL.' });
    expect(statusOf({ dbReachable: false, policy: null, lastOp: null, nowMs: NOW }).state).toBe('error');
  });
});

describe('sleepDecision: só desliga com a janela inteira sem uso', () => {
  const base = { policy: 'ALWAYS', lastOpStartMs: NOW - 120 * MIN, requests: 0, pendingPublishes: false, nowMs: NOW, idleMinutes: 60 };

  it('desliga: ligado há mais que a janela e nenhuma requisição de gente', () => {
    expect(sleepDecision(base)).toMatchObject({ stop: true });
  });

  it('não desliga o que já está desligado', () => {
    expect(sleepDecision({ ...base, policy: 'NEVER' })).toMatchObject({ stop: false, reason: expect.stringContaining('desligado') });
  });

  it('não desliga logo depois de ligar, mesmo sem requisição (a pessoa ainda não entrou)', () => {
    expect(sleepDecision({ ...base, lastOpStartMs: NOW - 10 * MIN })).toMatchObject({ stop: false, reason: expect.stringContaining('menos de 60 min') });
  });

  it('não desliga com uma requisição que seja', () => {
    expect(sleepDecision({ ...base, requests: 1 })).toMatchObject({ stop: false, reason: expect.stringContaining('1 requisições') });
  });

  it('não desliga com post agendado esperando para publicar: o cron não conta como uso', () => {
    expect(sleepDecision({ ...base, pendingPublishes: true })).toMatchObject({ stop: false, reason: expect.stringContaining('post agendado') });
  });

  it('sem registro de operação, decide pelo uso', () => {
    expect(sleepDecision({ ...base, lastOpStartMs: null }).stop).toBe(true);
  });
});

function fakeFetch(routes) {
  const calls = [];
  const impl = vi.fn(async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? 'GET', body: init.body, headers: init.headers });
    const hit = routes.find(([match]) => String(url).includes(match));
    const [, status, body] = hit ?? ['', 404, { error: { message: 'não achei' } }];
    return { ok: status < 400, status, json: async () => body };
  });
  return { impl, calls };
}

describe('powerClient: fala com o Cloud SQL e o Monitoring', () => {
  const cfg = { project: 'proj-staging', instance: 'ekoai-pg', idleMinutes: 60 };
  const client = (routes) => {
    const f = fakeFetch(routes);
    return { ...f, power: powerClient(cfg, { fetchImpl: f.impl, token: async () => 'tok', now: () => NOW }) };
  };

  it('lê a política de ativação', async () => {
    const { power, calls } = client([['/instances/ekoai-pg', 200, { settings: { activationPolicy: 'NEVER' } }]]);
    expect(await power.policy()).toBe('NEVER');
    expect(calls[0].url).toBe('https://sqladmin.googleapis.com/v1/projects/proj-staging/instances/ekoai-pg');
    expect(calls[0].headers.authorization).toBe('Bearer tok');
  });

  it('muda a política com PATCH só no campo activationPolicy', async () => {
    const { power, calls } = client([['/instances/ekoai-pg', 200, {}]]);
    await power.setPolicy('ALWAYS');
    expect(calls[0].method).toBe('PATCH');
    expect(JSON.parse(calls[0].body)).toEqual({ settings: { activationPolicy: 'ALWAYS' } });
  });

  it('a última operação é a UPDATE mais recente; backup e outras não contam', async () => {
    const { power } = client([[
      '/operations',
      200,
      { items: [
        { operationType: 'BACKUP_VOLUME', status: 'DONE', startTime: '2026-10-22T19:59:00Z' },
        { operationType: 'UPDATE', status: 'DONE', startTime: '2026-10-22T19:00:00Z' },
        { operationType: 'UPDATE', status: 'RUNNING', startTime: '2026-10-22T19:44:27Z' },
      ] },
    ]]);
    expect(await power.lastUpdate()).toEqual({ startedAtMs: Date.parse('2026-10-22T19:44:27Z'), status: 'RUNNING', failed: false });
  });

  it('operação com erro vem marcada como falha; sem operação, nulo', async () => {
    const failed = client([['/operations', 200, { items: [{ operationType: 'UPDATE', status: 'DONE', startTime: '2026-10-22T19:00:00Z', error: { errors: [{ code: 'x' }] } }] }]]);
    expect((await failed.power.lastUpdate()).failed).toBe(true);
    const none = client([['/operations', 200, {}]]);
    expect(await none.power.lastUpdate()).toBeNull();
  });

  it('soma as requisições de gente da janela', async () => {
    const { power, calls } = client([
      [`/metricDescriptors/${ACTIVITY_METRIC}`, 200, {}],
      ['/timeSeries', 200, { timeSeries: [{ points: [{ value: { int64Value: '4' } }, { value: { int64Value: '3' } }] }] }],
    ]);
    expect(await power.userRequests(60)).toBe(7);
    const url = new URL(calls[1].url);
    expect(url.searchParams.get('filter')).toBe(`metric.type="${ACTIVITY_METRIC}"`);
    expect(url.searchParams.get('aggregation.alignmentPeriod')).toBe('3600s');
    expect(url.searchParams.get('interval.endTime')).toBe(new Date(NOW).toISOString());
  });

  it('sem série na janela são zero requisições', async () => {
    const { power } = client([[`/metricDescriptors/${ACTIVITY_METRIC}`, 200, {}], ['/timeSeries', 200, {}]]);
    expect(await power.userRequests(60)).toBe(0);
  });

  it('métrica ausente é erro, nunca zero: sem ela o banco não desliga', async () => {
    const { power } = client([[`/metricDescriptors/${ACTIVITY_METRIC}`, 404, { error: { message: 'Metric not found' } }]]);
    await expect(power.userRequests(60)).rejects.toThrow(/Google Cloud 404/);
  });

  it('erro da API sobe com o código e sem expor mais que o necessário', async () => {
    const { power } = client([['/instances/ekoai-pg', 403, { error: { message: 'Permission denied on resource' } }]]);
    await expect(power.policy()).rejects.toThrow('Google Cloud 403: Permission denied on resource');
  });
});

describe('limite de pedidos para ligar', () => {
  beforeEach(() => resetWakeThrottle());

  it('o segundo pedido dentro de 2 minutos espera', () => {
    expect(canWakeNow(NOW)).toBe(true);
    markWake(NOW);
    expect(canWakeNow(NOW + 30_000)).toBe(false);
    expect(canWakeNow(NOW + WAKE_MIN_GAP_MS)).toBe(true);
  });
});

describe('wake-gate: o layout pergunta se o banco dorme', () => {
  const saved = { ...process.env };
  beforeEach(() => resetWakeGate());
  afterEach(() => { process.env = { ...saved }; });

  it('fora do staging nunca barra e nem toca no banco', async () => {
    delete process.env.WAKE_ENABLED;
    const probe = vi.fn();
    expect(await environmentAsleep(probe, NOW)).toBe(false);
    expect(probe).not.toHaveBeenCalled();
  });

  it('no staging, banco fora barra e banco de pé libera', async () => {
    process.env.WAKE_ENABLED = 'true';
    expect(await environmentAsleep(async () => false, NOW)).toBe(true);
    resetWakeGate();
    expect(await environmentAsleep(async () => true, NOW)).toBe(false);
  });

  it('guarda o resultado: de pé por 30 s, fora por 3 s', async () => {
    process.env.WAKE_ENABLED = 'true';
    const up = vi.fn(async () => true);
    await environmentAsleep(up, NOW);
    await environmentAsleep(up, NOW + 29_000);
    expect(up).toHaveBeenCalledTimes(1);
    await environmentAsleep(up, NOW + 31_000);
    expect(up).toHaveBeenCalledTimes(2);

    resetWakeGate();
    const down = vi.fn(async () => false);
    await environmentAsleep(down, NOW);
    await environmentAsleep(down, NOW + 2_000);
    expect(down).toHaveBeenCalledTimes(1);
    await environmentAsleep(down, NOW + 4_000);
    expect(down).toHaveBeenCalledTimes(2);
  });
});
