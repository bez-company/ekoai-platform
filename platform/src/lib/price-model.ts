// price-model.ts: o preço de um post a partir do custo real (SPEC 031), a parte pura. O preço é o custo mais um percentual, com um mínimo por
// post e um arredondamento para cima. Quem vê o quê: o cliente só vê o PREÇO (nunca o custo nem a margem); o Console › Financeiro vê os dois.
// Os números (percentual, mínimo, margem-alvo) ficam no banco (`platform_pricing`), nunca no repositório, que é público.

export type PricingConfig = { markupPercent: number; minimumPerPostBrl: number; roundUpToBrl: number; targetMarginPercent: number };

export const EMPTY_PRICING: PricingConfig = { markupPercent: 0, minimumPerPostBrl: 0, roundUpToBrl: 0, targetMarginPercent: 0 };

// Preço ainda não definido: a linha nasce zerada.
export const isPricingSet = (c: PricingConfig): boolean => c.markupPercent > 0 || c.minimumPerPostBrl > 0;

const cents = (n: number): number => Math.round(n * 100) / 100;

// Arredonda para cima no passo (R$ 0,05, R$ 0,10...). Passo 0 só tira o ruído de ponto flutuante.
function roundUp(value: number, step: number): number {
  if (step <= 0) return cents(value);
  return cents(Math.ceil(value / step - 1e-9) * step);
}

// O preço de um post: o custo (em reais) mais o percentual, nunca abaixo do mínimo, arredondado para cima.
export function postPriceBrl(costBrl: number, c: PricingConfig): number {
  const withMarkup = costBrl * (1 + c.markupPercent / 100);
  return roundUp(Math.max(c.minimumPerPostBrl, withMarkup), c.roundUpToBrl);
}

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
