// price-model.ts: o preço de um post a partir do custo real (SPEC 031), a parte pura. O preço é o custo mais um percentual, com um mínimo por
// post e um arredondamento para cima. Quem vê o quê: o cliente só vê o PREÇO (nunca o custo nem a margem); o Console › Financeiro vê os dois.
// Os números (percentual, mínimo, margem-alvo) ficam no banco (`platform_pricing`), nunca no repositório, que é público.
// O desconto por conta (SPEC 032) fica em `account_price_discounts`: um percentual sobre o preço de lista, com período e motivo.

export type PricingConfig = { markupPercent: number; minimumPerPostBrl: number; roundUpToBrl: number; targetMarginPercent: number };

export const EMPTY_PRICING: PricingConfig = { markupPercent: 0, minimumPerPostBrl: 0, roundUpToBrl: 0, targetMarginPercent: 0 };

// Preço ainda não definido: a linha nasce zerada.
export const isPricingSet = (c: PricingConfig): boolean => c.markupPercent > 0 || c.minimumPerPostBrl > 0;

const cents = (n: number): number => Math.round(n * 100) / 100;

// Arredonda para cima no passo (R$ 0,05, R$ 0,10...). Passo 0 só tira o ruído de ponto flutuante.
function roundUp(value: number, step: number): number {
  if (step <= 0) return cents(value);
  return cents(Math.ceil(value / step - 1e-9) * step) + 0; // + 0 troca o -0 de um preço zerado por 0
}

// O preço de um post: o custo (em reais) mais o percentual, nunca abaixo do mínimo, arredondado para cima.
export function postPriceBrl(costBrl: number, c: PricingConfig): number {
  const withMarkup = costBrl * (1 + c.markupPercent / 100);
  return roundUp(Math.max(c.minimumPerPostBrl, withMarkup), c.roundUpToBrl);
}

// Custos de exemplo, em reais, para o console mostrar o preço e a margem antes de salvar: um post só de texto, um com imagem gerada por IA e um caro.
export const EXAMPLE_COSTS: { label: string; costBrl: number }[] = [
  { label: 'Post só de texto', costBrl: 0.04 },
  { label: 'Post com imagem gerada', costBrl: 0.41 },
  { label: 'Post caro (várias imagens)', costBrl: 1.2 },
];

export type Profit = { profitBrl: number; marginPercent: number };

// O lucro bruto (preço menos custo de IA, sem imposto nem taxa do gateway) e a margem sobre o preço.
export function profitOf(priceBrl: number, costBrl: number): Profit {
  const profitBrl = priceBrl - costBrl;
  return { profitBrl, marginPercent: priceBrl > 0 ? (profitBrl / priceBrl) * 100 : 0 };
}

export const isBelowTarget = (marginPercent: number, c: PricingConfig): boolean => c.targetMarginPercent > 0 && marginPercent < c.targetMarginPercent;

// O que o console recebe do formulário. Valida a faixa de cada número e devolve o erro em português.
type Parsed = { ok: true; value: PricingConfig } | { ok: false; error: string };

function field(raw: unknown, name: string, min: number, max: number): { ok: true; value: number } | { ok: false; error: string } {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw.trim().replace(',', '.')) : Number.NaN;
  if (!Number.isFinite(n) || n < min || n > max) return { ok: false, error: `${name}: use um número de ${min} a ${max}.` };
  return { ok: true, value: cents(n) };
}

export function parsePricing(body: unknown): Parsed {
  const o = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  if (!o) return { ok: false, error: 'Pedido inválido.' };
  const markup = field(o.markupPercent, 'Percentual sobre o custo', 0, 100000);
  if (!markup.ok) return markup;
  const minimum = field(o.minimumPerPostBrl, 'Preço mínimo por post', 0, 10000);
  if (!minimum.ok) return minimum;
  const step = field(o.roundUpToBrl, 'Arredondar para cima em', 0, 100);
  if (!step.ok) return step;
  const target = field(o.targetMarginPercent, 'Margem-alvo', 0, 99.99);
  if (!target.ok) return target;
  return { ok: true, value: { markupPercent: markup.value, minimumPerPostBrl: minimum.value, roundUpToBrl: step.value, targetMarginPercent: target.value } };
}

// Desconto por conta (SPEC 032). Os dias são AAAA-MM-DD em UTC, o mesmo recorte do mês da fatura.
export type Discount = { discountPercent: number; startsOn: string; endsOn: string | null };

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isDay(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const m = DAY.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === value;
}

export const dayOf = (date: Date): string => date.toISOString().slice(0, 10);

export const dayBefore = (day: string): string => dayOf(new Date(Date.parse(`${day}T00:00:00Z`) - 86_400_000));

// O desconto que valia num dia: começou até esse dia e ainda não tinha terminado. Com mais de um, vale o que começou por último.
export function discountOn<T extends Discount>(list: readonly T[], day: string): T | null {
  const live = list.filter((d) => d.startsOn <= day && (d.endsOn === null || d.endsOn >= day));
  return live.reduce<T | null>((best, d) => (best === null || d.startsOn > best.startsOn ? d : best), null);
}

// O preço da conta: o preço de lista menos o desconto, arredondado para cima no mesmo passo. Sem desconto, é o preço de lista.
export function postPriceWithDiscountBrl(costBrl: number, c: PricingConfig, discountPercent: number): number {
  const list = postPriceBrl(costBrl, c);
  return discountPercent > 0 ? roundUp(list * (1 - discountPercent / 100), c.roundUpToBrl) : list;
}

export type DiscountInput = { discountPercent: number; reason: string; endsOn: string | null };
type ParsedDiscount = { ok: true; value: DiscountInput } | { ok: false; error: string };

// O que o console manda ao aplicar um desconto. O motivo é obrigatório e o fim, se houver, não pode ser antes de hoje.
export function parseDiscount(body: unknown, today: string): ParsedDiscount {
  const o = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  if (!o) return { ok: false, error: 'Pedido inválido.' };
  const percent = field(o.discountPercent, 'Desconto', 0.01, 100);
  if (!percent.ok) return percent;
  const reason = typeof o.reason === 'string' ? o.reason.trim() : '';
  if (reason.length < 3 || reason.length > 200) return { ok: false, error: 'Motivo: escreva de 3 a 200 caracteres.' };
  const rawEnd = typeof o.endsOn === 'string' ? o.endsOn.trim() : o.endsOn;
  if (rawEnd === undefined || rawEnd === null || rawEnd === '') return { ok: true, value: { discountPercent: percent.value, reason, endsOn: null } };
  if (!isDay(rawEnd)) return { ok: false, error: 'Vence em: use uma data válida.' };
  if (rawEnd < today) return { ok: false, error: 'Vence em: escolha hoje ou uma data futura.' };
  return { ok: true, value: { discountPercent: percent.value, reason, endsOn: rawEnd } };
}
