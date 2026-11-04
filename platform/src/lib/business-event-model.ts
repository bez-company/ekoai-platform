// business-event-model.ts: resultados comerciais com origem (SPEC 038, BEZ-551). Puro, sem I/O: valida o registro na
// fronteira e resume por origem. A regra do plano: curtida não é lead, e a Ekoai não sabe sozinha se a venda veio do post.
// Por isso a origem é sempre escolhida pela pessoa, e o resumo nunca soma as três como "resultado da campanha".

export const BUSINESS_KINDS = ['contact', 'quote', 'order', 'sale'] as const;
export type BusinessKind = (typeof BUSINESS_KINDS)[number];
export const ORIGINS = ['observed', 'declared', 'unknown'] as const;
export type Origin = (typeof ORIGINS)[number];

export const KIND_LABEL: Record<BusinessKind, string> = { contact: 'Contato', quote: 'Orçamento', order: 'Pedido', sale: 'Venda' };
export const ORIGIN_LABEL: Record<Origin, string> = { observed: 'Pelo link', declared: 'Cliente disse', unknown: 'Não sei' };
export const ORIGIN_DETAIL: Record<Origin, { title: string; detail: string }> = {
  observed: { title: 'Veio pelo link do post', detail: 'Chegou pelo link com o código da Ekoai (você viu no site, no WhatsApp ou no seu sistema)' },
  declared: { title: 'O cliente disse', detail: 'O cliente contou que viu no Instagram ou no post' },
  unknown: { title: 'Não sei', detail: 'Aconteceu durante a campanha, sem ligação conhecida com um post' },
};
export const DISCLAIMER = 'É o que você registrou. A Ekoai não sabe sozinha se a venda veio do post.';

export const NOTE_MAX = 200;
export const VALUE_MAX = 10_000_000;
const PAST_DAYS = 365;

export type BusinessEvent = {
  id: string;
  kind: BusinessKind;
  occurredOn: string; // AAAA-MM-DD
  valueBrl: number | null;
  origin: Origin;
  campaignId: string | null;
  postId: string | null;
  note: string | null;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
};

export function eventFromRow(r: Record<string, unknown>): BusinessEvent {
  const day = r.occurred_on instanceof Date ? r.occurred_on.toISOString().slice(0, 10) : String(r.occurred_on).slice(0, 10);
  return {
    id: String(r.id),
    kind: r.kind as BusinessKind,
    occurredOn: day,
    valueBrl: r.value_brl === null || r.value_brl === undefined ? null : Number(r.value_brl),
    origin: r.origin as Origin,
    campaignId: (r.campaign_id as string | null) ?? null,
    postId: (r.post_id as string | null) ?? null,
    note: (r.note as string | null) ?? null,
    createdBy: (r.created_by as string | null) ?? null,
    createdByName: (r.created_by_name as string | null) ?? null,
    createdAt: new Date(r.created_at as string).toISOString(),
  };
}

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string; field?: string };
export type BusinessEventInput = { kind: BusinessKind; occurred_on: string; value_brl: number | null; origin: Origin; campaign_id: string | null; post_id: string | null; note: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const PHONE = /(?:\d[\s().-]*){8,}/;

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

// Valor em reais: número ou texto como "R$ 1.234,56" e "89,90".
export function parseBrl(raw: unknown): number | null | undefined {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? Math.round(raw * 100) / 100 : undefined;
  if (typeof raw !== 'string') return undefined;
  const cleaned = raw.replace(/R\$\s*/i, '').trim().replace(/\./g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return undefined;
  return Math.round(Number(cleaned) * 100) / 100;
}

export function parseBusinessEvent(body: unknown, today: string): Parsed<BusinessEventInput> {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  if (!(BUSINESS_KINDS as readonly string[]).includes(b.kind as string)) return { ok: false, error: 'Diga o que aconteceu: contato, orçamento, pedido ou venda.', field: 'kind' };
  const kind = b.kind as BusinessKind;
  if (!(ORIGINS as readonly string[]).includes(b.origin as string)) return { ok: false, error: 'Diga de onde veio: pelo link do post, o cliente disse ou não sei.', field: 'origin' };
  const day = typeof b.occurred_on === 'string' ? b.occurred_on.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(`${day}T12:00:00Z`))) return { ok: false, error: 'Use uma data válida.', field: 'occurred_on' };
  if (day > today) return { ok: false, error: 'A data não pode ser no futuro. Registre depois que acontecer.', field: 'occurred_on' };
  if (day < addDays(today, -PAST_DAYS)) return { ok: false, error: 'Registre resultados do último ano.', field: 'occurred_on' };
  const value = parseBrl(b.value_brl);
  if (value === undefined || (value !== null && (value < 0 || value > VALUE_MAX))) return { ok: false, error: 'Use um valor em reais, como 89,90.', field: 'value_brl' };
  if (kind === 'contact' && value !== null) return { ok: false, error: 'Contato não tem valor. Registre o valor no orçamento, no pedido ou na venda.', field: 'value_brl' };
  const note = typeof b.note === 'string' ? b.note.trim() : '';
  if (note.length > NOTE_MAX) return { ok: false, error: `Observação com até ${NOTE_MAX} caracteres.`, field: 'note' };
  if (EMAIL.test(note) || PHONE.test(note)) return { ok: false, error: 'Tire o e-mail ou o telefone do cliente da observação.', field: 'note' };
  const id = (v: unknown) => (typeof v === 'string' && UUID.test(v) ? v : null);
  if (b.campaign_id && !id(b.campaign_id)) return { ok: false, error: 'Campanha não encontrada. Recarregue a página.' };
  if (b.post_id && !id(b.post_id)) return { ok: false, error: 'Post não encontrado. Recarregue a página.' };
  return { ok: true, value: { kind, occurred_on: day, value_brl: value, origin: b.origin as Origin, campaign_id: id(b.campaign_id), post_id: id(b.post_id), note: note || null } };
}

export type OriginSummary = { origin: Origin; label: string; count: number; detail: string };

const brl = (n: number) => `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
export const fmtBrl = brl;

// Uma caixa por origem, sempre as três, com o que cada uma reúne ("1 venda e 1 orçamento", "R$ 267").
export function summarizeByOrigin(events: readonly Pick<BusinessEvent, 'kind' | 'origin' | 'valueBrl'>[]): OriginSummary[] {
  return ORIGINS.map((origin) => {
    const list = events.filter((e) => e.origin === origin);
    const parts = BUSINESS_KINDS.map((k) => [k, list.filter((e) => e.kind === k).length] as const)
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `${n} ${n === 1 ? KIND_LABEL[k].toLowerCase() : `${KIND_LABEL[k].toLowerCase()}s`}`);
    const total = list.reduce((sum, e) => sum + (e.valueBrl ?? 0), 0);
    const kinds = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} e ${parts.at(-1)}` : parts[0] ?? 'nada registrado';
    return { origin, label: ORIGIN_LABEL[origin], count: list.length, detail: total > 0 ? `${kinds}, ${brl(total)}` : kinds };
  });
}
