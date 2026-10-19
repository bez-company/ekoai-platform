// log.ts: log estruturado (uma linha JSON por evento), lido pelo Cloud Logging, que usa `severity`
// e `message` para classificar e mostrar a linha. Campos que podem carregar dado pessoal ou
// segredo saem mascarados antes de serem gravados.

type Level = 'info' | 'warn' | 'error';

const SEVERITY: Record<Level, string> = { info: 'INFO', warn: 'WARNING', error: 'ERROR' };

const SENSITIVE = /(token|secret|password|senha|authorization|cookie|key|email)/i;

export function scrub(value: unknown, depth = 0): unknown {
  if (depth > 4 || value == null) return value;
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  if (typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE.test(k) ? '[mascarado]' : scrub(v, depth + 1);
  }
  return out;
}

export function log(level: Level, scope: string, message: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ severity: SEVERITY[level], level, scope, message, ...(scrub(fields) as object), at: new Date().toISOString() });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.info(line);
}

export function logError(scope: string, e: unknown, fields: Record<string, unknown> = {}): void {
  const err = e instanceof Error ? { error: e.message, name: e.name, stack: e.stack?.split('\n').slice(0, 5).join('\n') } : { error: String(e) };
  log('error', scope, 'falha', { ...fields, ...err });
}
