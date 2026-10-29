// signal-text.ts: o texto de um post como o avaliador de sinais o lê (SPEC 028, BEZ-441). Puro: serve ao servidor e à tela.
// O avaliador olha o texto sem a linha de hashtags; a tela edita o texto com elas no fim. Este módulo separa e junta as duas partes.

// Linha final que só tem hashtags (`#bolo #marilia`): é a que a tela junta ao texto na legenda.
const TAG_LINE = /^(?:\s*#[\p{L}\p{N}_]+)+\s*$/u;

export function splitHashtagLine(text: string): { body: string; tags: string } {
  const lines = text.replace(/\r\n?/g, '\n').trimEnd().split('\n');
  const last = lines[lines.length - 1] ?? '';
  if (lines.length > 1 && TAG_LINE.test(last)) return { body: lines.slice(0, -1).join('\n').trimEnd(), tags: last.trim() };
  return { body: lines.join('\n'), tags: '' };
}

// O texto novo (sem hashtags) volta ao lugar: com a linha de hashtags que a pessoa já tinha.
export function joinHashtagLine(body: string, tags: string): string {
  return tags ? `${body.trimEnd()}\n\n${tags}` : body;
}

export const hashtagsOf = (tags: string): string[] => (tags.match(/#[\p{L}\p{N}_]+/gu) ?? []).map((t) => t.slice(1).toLowerCase());

// O texto que o avaliador leu é o mesmo que está guardado? (ignora espaço e a linha de hashtags)
export const sameText = (a: string, b: string): boolean => splitHashtagLine(a).body.trim() === splitHashtagLine(b).body.trim();

export type SignalAction = { evaluate: true } | { apply: { criterionId: string; suggestion: string } };

// O pedido que a tela manda a /api/pendings/[id]/signal. Valida o formato na entrada.
export function parseSignalRequest(body: unknown): { ok: true; value: { text: string; action: SignalAction } } | { ok: false; error: string } {
  const o = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  if (!o) return { ok: false, error: 'Pedido inválido.' };
  const text = typeof o.text === 'string' ? o.text.replace(/\r\n?/g, '\n').trim() : '';
  if (!text) return { ok: false, error: 'O texto está vazio.' };
  if (text.length > 3500) return { ok: false, error: 'O texto é grande demais para avaliar.' };
  if (o.action === 'evaluate') return { ok: true, value: { text, action: { evaluate: true } } };
  if (o.action === 'apply') {
    const id = typeof o.criterionId === 'string' ? o.criterionId.slice(0, 40) : '';
    const suggestion = typeof o.suggestion === 'string' ? o.suggestion.replace(/\s+/g, ' ').trim().slice(0, 300) : '';
    if (!id || !suggestion) return { ok: false, error: 'Escolha uma sugestão para aplicar.' };
    return { ok: true, value: { text, action: { apply: { criterionId: id, suggestion } } } };
  }
  return { ok: false, error: 'Escolha avaliar ou aplicar.' };
}
