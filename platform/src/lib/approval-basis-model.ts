// approval-basis-model.ts: a base da aprovação (SPEC 035, BEZ-543). Puro, sem I/O. Na aprovação, guarda em
// `scheduled_posts.approval_basis` os fatos e a oferta da campanha que o post afirma; antes de publicar, diz o que mudou
// desde então. Um fato entra na base quando um número dele aparece no post ou quando o texto inteiro dele aparece: regra por
// código, sem modelo. Fato do tipo "nunca afirmar" não entra (a conferência já confere a lista de hoje).

import { factStanding, type CompanyFact } from './company-facts-model';
import { numbersIn } from './design/review';

export type ApprovalBasis = {
  at: string; // ISO da aprovação
  facts: { id: string; text: string }[];
  campaign: { id: string; offering: string | null } | null;
};

export type BasisRule = 'fact_removed' | 'fact_changed' | 'fact_off' | 'offering_changed';
export type BasisBlock = { rule: BasisRule; message: string; numbers: string[] };

const FACTS_MAX = 50;
const TEXT_MAX = 280;

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

export function basisFor(input: { texts: string[]; facts: readonly CompanyFact[]; campaign: { id: string; offering: string | null } | null; at: string }): ApprovalBasis {
  const text = input.texts.join(' \n ');
  const said = new Set(numbersIn(text));
  const flat = norm(text);
  const facts = input.facts
    .filter((f) => f.kind === 'fact' && f.active && (numbersIn(f.text).some((n) => said.has(n)) || (norm(f.text).length > 0 && flat.includes(norm(f.text)))))
    .slice(0, FACTS_MAX)
    .map((f) => ({ id: f.id, text: f.text }));
  return { at: input.at, facts, campaign: input.campaign };
}

// Fronteira: a base vem do banco (jsonb). Forma errada vira "sem base", que cai na regra por número do BEZ-275.
export function parseApprovalBasis(raw: unknown): ApprovalBasis | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.at !== 'string' || !Array.isArray(r.facts)) return null;
  const facts: ApprovalBasis['facts'] = [];
  for (const f of r.facts.slice(0, FACTS_MAX)) {
    const x = f as Record<string, unknown> | null;
    if (!x || typeof x.id !== 'string' || typeof x.text !== 'string') return null;
    facts.push({ id: x.id, text: x.text.slice(0, TEXT_MAX) });
  }
  let campaign: ApprovalBasis['campaign'] = null;
  if (r.campaign !== null && r.campaign !== undefined) {
    const c = r.campaign as Record<string, unknown>;
    if (typeof c !== 'object' || typeof c.id !== 'string' || (c.offering !== null && typeof c.offering !== 'string')) return null;
    campaign = { id: c.id, offering: (c.offering as string | null) ?? null };
  }
  return { at: r.at, facts, campaign };
}

// O que mudou desde a aprovação. `numbers` = os números que o motivo já explica, para a regra por número não repetir o aviso.
export function basisBlocks(input: { basis: ApprovalBasis; texts: string[]; facts: readonly CompanyFact[]; campaign: { id: string; offering: string | null } | null; today: string }): BasisBlock[] {
  const blocks: BasisBlock[] = [];
  const byId = new Map(input.facts.map((f) => [f.id, f]));
  for (const was of input.basis.facts) {
    const now = byId.get(was.id);
    const numbers = numbersIn(was.text);
    if (!now) {
      blocks.push({ rule: 'fact_removed', numbers, message: `O fato "${was.text}" foi apagado depois que o post foi aprovado.` });
      continue;
    }
    if (norm(now.text) !== norm(was.text)) {
      blocks.push({ rule: 'fact_changed', numbers, message: `O fato mudou depois que o post foi aprovado: era "${was.text}", agora é "${now.text}". Atualize o post.` });
      continue;
    }
    const { state } = factStanding(now, input.today);
    if (state !== 'valid' && state !== 'soon') {
      const why = state === 'off' ? 'foi desligado' : state === 'expired' ? 'venceu' : state === 'rejected' ? 'foi recusado' : 'voltou para revisão';
      blocks.push({ rule: 'fact_off', numbers, message: `O fato "${was.text}" ${why} depois que o post foi aprovado.` });
    }
  }
  const before = input.basis.campaign;
  const current = input.campaign;
  if (before?.offering && current && current.id === before.id && norm(current.offering ?? '') !== norm(before.offering)) {
    const said = new Set(numbersIn(input.texts.join(' \n ')));
    const numbers = numbersIn(before.offering).filter((n) => said.has(n));
    if (numbers.length) {
      const after = current.offering ? `agora é "${current.offering}"` : 'agora a campanha não tem oferta';
      blocks.push({ rule: 'offering_changed', numbers, message: `A oferta da campanha mudou depois que o post foi aprovado: era "${before.offering}", ${after}. Atualize o post.` });
    }
  }
  return blocks;
}
