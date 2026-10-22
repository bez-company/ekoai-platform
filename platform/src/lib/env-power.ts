// env-power.ts: liga e desliga o Cloud SQL do staging sob demanda (SPEC 016). Só age quando
// WAKE_ENABLED=true, que só o Terraform do staging define: produção nunca passa por aqui.
// A lógica de decisão é pura (statusOf, sleepDecision); o resto fala com a API do Cloud SQL e do
// Cloud Monitoring pela credencial da conta de serviço do app (ADC), sem chave no repositório.

import pg from 'pg';
import { GoogleAuth } from 'google-auth-library';

export type PowerConfig = { project: string; instance: string; idleMinutes: number };

// Medido em 22/10/2026: ligar o ekoai-pg do staging levou 888 s até a plataforma responder.
export const WAKE_ESTIMATE_S = 15 * 60;
// Passou disso ligando, algo travou: a tela oferece tentar de novo.
export const WAKE_GIVE_UP_S = 30 * 60;
// Intervalo mínimo entre dois pedidos de ligar: dois cliques seguidos não viram duas chamadas.
export const WAKE_MIN_GAP_MS = 2 * 60_000;

// Contador de requisições de gente (log-based metric do Terraform): fora live, health, cron e ambiente.
export const ACTIVITY_METRIC = 'logging.googleapis.com/user/ekoai_user_requests';

export function powerEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.WAKE_ENABLED === 'true';
}

// Valida na entrada: ligado sem projeto ou instância é erro de deploy, e falha cedo e claro.
export function powerConfig(env: Record<string, string | undefined> = process.env): PowerConfig | null {
  if (!powerEnabled(env)) return null;
  const project = env.WAKE_SQL_PROJECT;
  const instance = env.WAKE_SQL_INSTANCE;
  if (!project || !instance) throw new Error('WAKE_SQL_PROJECT e WAKE_SQL_INSTANCE são obrigatórias com WAKE_ENABLED=true.');
  const idle = Number(env.WAKE_IDLE_MINUTES ?? 60);
  if (!Number.isFinite(idle) || idle < 15) throw new Error('WAKE_IDLE_MINUTES precisa ser um número a partir de 15.');
  return { project, instance, idleMinutes: idle };
}

export type EnvState = 'ready' | 'starting' | 'sleeping' | 'error';
export type EnvStatus = { state: EnvState; elapsedS: number | null; estimateS: number; message: string | null };

export type LastOperation = { startedAtMs: number; status: string; failed: boolean } | null;

export function statusOf(input: { dbReachable: boolean; policy: string | null; lastOp: LastOperation; nowMs: number; apiError?: string }): EnvStatus {
  const base = { estimateS: WAKE_ESTIMATE_S };
  if (input.dbReachable) return { state: 'ready', elapsedS: null, message: null, ...base };
  if (input.apiError) return { state: 'error', elapsedS: null, message: input.apiError, ...base };
  if (input.policy === 'NEVER') return { state: 'sleeping', elapsedS: null, message: null, ...base };
  if (input.policy !== 'ALWAYS') return { state: 'error', elapsedS: null, message: 'Não consegui ler o estado do banco.', ...base };
  if (input.lastOp?.failed) return { state: 'error', elapsedS: null, message: 'O Google Cloud recusou o pedido de ligar o banco.', ...base };
  const elapsedS = input.lastOp ? Math.max(0, Math.round((input.nowMs - input.lastOp.startedAtMs) / 1000)) : null;
  if (elapsedS !== null && elapsedS > WAKE_GIVE_UP_S) return { state: 'error', elapsedS, message: 'O banco não respondeu em 30 minutos. Nada foi alterado.', ...base };
  return { state: 'starting', elapsedS, message: null, ...base };
}

export type SleepDecision = { stop: boolean; reason: string };

// Desliga só o que está ligado há mais que a janela de ociosidade, sem nenhuma requisição de gente nela
// e sem post agendado esperando para sair (o publish-due precisa do banco no horário).
export function sleepDecision(input: { policy: string | null; lastOpStartMs: number | null; requests: number; pendingPublishes: boolean; nowMs: number; idleMinutes: number }): SleepDecision {
  if (input.policy !== 'ALWAYS') return { stop: false, reason: 'o banco já está desligado' };
  if (input.lastOpStartMs !== null && input.nowMs - input.lastOpStartMs < input.idleMinutes * 60_000) {
    return { stop: false, reason: `o banco foi ligado há menos de ${input.idleMinutes} min` };
  }
  if (input.requests > 0) return { stop: false, reason: `${input.requests} requisições nos últimos ${input.idleMinutes} min` };
  if (input.pendingPublishes) return { stop: false, reason: 'há post agendado esperando para publicar' };
  return { stop: true, reason: `sem requisições nos últimos ${input.idleMinutes} min` };
}

// O banco responde? Cliente próprio e curto, fora do pool: com o banco parado, o pool ficaria com
// tentativas de conexão penduradas e atrasaria a volta.
export async function probeDb(connectionString: string | undefined, timeoutMs = 2000): Promise<boolean> {
  if (!connectionString) return false;
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: timeoutMs, query_timeout: timeoutMs });
  client.on('error', () => undefined);
  try {
    await client.connect();
    await client.query('select 1');
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

type Fetch = typeof fetch;
type Deps = { fetchImpl?: Fetch; token?: () => Promise<string>; now?: () => number };

let auth: GoogleAuth | null = null;
async function adcToken(): Promise<string> {
  auth ??= new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  if (!token.token) throw new Error('Sem credencial do Google Cloud (ADC).');
  return token.token;
}

export function powerClient(config: PowerConfig, deps: Deps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const token = deps.token ?? adcToken;
  const now = deps.now ?? Date.now;
  const sql = `https://sqladmin.googleapis.com/v1/projects/${config.project}/instances/${config.instance}`;

  async function call(url: string, init: RequestInit = {}): Promise<Record<string, any>> {
    const res = await fetchImpl(url, {
      ...init,
      headers: { authorization: `Bearer ${await token()}`, 'x-goog-user-project': config.project, 'content-type': 'application/json' },
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, any>;
    if (!res.ok) throw new Error(`Google Cloud ${res.status}: ${String(data?.error?.message ?? 'sem detalhe').slice(0, 160)}`);
    return data;
  }

  return {
    async policy(): Promise<string | null> {
      const data = await call(sql);
      return typeof data?.settings?.activationPolicy === 'string' ? data.settings.activationPolicy : null;
    },

    // A última operação de UPDATE da instância é a que ligou ou desligou o banco.
    async lastUpdate(): Promise<LastOperation> {
      const data = await call(`https://sqladmin.googleapis.com/v1/projects/${config.project}/operations?instance=${config.instance}&maxResults=20`);
      const ops = (Array.isArray(data.items) ? data.items : []).filter((o: Record<string, any>) => o.operationType === 'UPDATE');
      const stamp = (o: Record<string, any>) => Date.parse(o.startTime ?? o.insertTime ?? '') || 0;
      const last = ops.sort((a: Record<string, any>, b: Record<string, any>) => stamp(b) - stamp(a))[0];
      if (!last) return null;
      return { startedAtMs: stamp(last), status: String(last.status ?? ''), failed: Array.isArray(last.error?.errors) && last.error.errors.length > 0 };
    },

    async setPolicy(policy: 'ALWAYS' | 'NEVER'): Promise<void> {
      await call(sql, { method: 'PATCH', body: JSON.stringify({ settings: { activationPolicy: policy } }) });
    },

    // Requisições de gente na janela. Métrica ausente é erro, não zero: sem ela, nunca se desliga.
    async userRequests(minutes: number): Promise<number> {
      const base = `https://monitoring.googleapis.com/v3/projects/${config.project}`;
      await call(`${base}/metricDescriptors/${ACTIVITY_METRIC}`);
      const end = new Date(now());
      const start = new Date(end.getTime() - minutes * 60_000);
      const q = new URLSearchParams({
        filter: `metric.type="${ACTIVITY_METRIC}"`,
        'interval.startTime': start.toISOString(),
        'interval.endTime': end.toISOString(),
        'aggregation.alignmentPeriod': `${minutes * 60}s`,
        'aggregation.perSeriesAligner': 'ALIGN_SUM',
        'aggregation.crossSeriesReducer': 'REDUCE_SUM',
      });
      const data = await call(`${base}/timeSeries?${q.toString()}`);
      const series = Array.isArray(data.timeSeries) ? data.timeSeries : [];
      return series.reduce((sum: number, s: Record<string, any>) => sum + (s.points ?? []).reduce((n: number, p: Record<string, any>) => n + Number(p.value?.int64Value ?? 0), 0), 0);
    },
  };
}

// Um pedido de ligar por vez: guarda a hora do último na memória da instância.
let lastWakeAt = 0;
export function canWakeNow(nowMs: number): boolean {
  return nowMs - lastWakeAt >= WAKE_MIN_GAP_MS;
}
export function markWake(nowMs: number): void {
  lastWakeAt = nowMs;
}
export function resetWakeThrottle(): void {
  lastWakeAt = 0;
}
