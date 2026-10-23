// rules-model.ts: a regra de marca que nasce de edições parecidas (SPEC 019, decisões 11 a 14). Puro, sem I/O.
// Duas partes: (1) olhar os posts editados e decidir o que vira proposta; (2) aplicar as regras ativas ao
// design de um post novo sem nunca piorá-lo. Só mudança categórica é elegível; texto livre nunca vira regra,
// e a explicação sai de template, não de modelo.

import { diffDesigns, type DiffContext, type DiffEntry } from './diff';
import { compatibleLayouts, defaultCorner, type Layout, type LogoCorner, type PostKind, type StoredDesign } from './model';

// Quantos posts diferentes repetem a mesma mudança, em quantos dias, e quanto esperar depois de dispensar.
export const RULE_THRESHOLD = 3;
export const RULE_WINDOW_DAYS = 30;
export const DISMISS_COOLDOWN_DAYS = 60;
const DAY_MS = 86_400_000;

export const RULE_FIELDS = ['layout', 'logoCorner', 'logoHidden', 'texts.sub', 'texts.kicker', 'colors.title', 'colors.sub'] as const;
export type RuleField = (typeof RULE_FIELDS)[number];
export type RuleScope = 'any' | PostKind;
export type RuleValue = string | boolean;
export type RuleStatus = 'proposed' | 'active' | 'off' | 'dismissed';

// Layout e cor dependem do tipo do post (o fundo muda com a família): essas regras sempre têm um tipo.
const KIND_SCOPED: ReadonlySet<RuleField> = new Set(['layout', 'colors.title', 'colors.sub']);

export type DesignRule = { id: string; field: RuleField; scope: RuleScope; value: RuleValue; status: RuleStatus; decidedAt: string | null; evidence: { posts?: number; first_at?: string; last_at?: string } | null };
export type Candidate = { field: RuleField; scope: RuleScope; value: RuleValue; key: string };

const keyOf = (scope: RuleScope, field: RuleField, value: RuleValue) => `${scope}|${field}|${String(value)}`;

// A mudança líquida de um post (v1 contra a versão em uso) que pode virar regra. Vazio quando o post voltou
// ao que era, ou quando só o texto livre mudou.
export function candidatesOf(initial: StoredDesign, current: StoredDesign, ctx: DiffContext): Candidate[] {
  const out: Candidate[] = [];
  for (const e of diffDesigns(initial, current, ctx)) {
    const c = candidateOf(e, ctx.kind);
    if (c) out.push(c);
  }
  return out;
}

function candidateOf(e: DiffEntry, kind: PostKind): Candidate | null {
  const field = e.field as RuleField;
  if (!(RULE_FIELDS as readonly string[]).includes(field)) return null;
  const scope: RuleScope = KIND_SCOPED.has(field) ? kind : 'any';
  let value: RuleValue;
  if (field === 'texts.sub' || field === 'texts.kicker') {
    if (e.op !== 'remove') return null; // reescrever o texto é texto livre
    value = true;
  } else if (field === 'logoHidden') {
    if (e.after !== true) return null;
    value = true;
  } else {
    if (typeof e.after !== 'string') return null; // cor que voltou à da marca não é regra
    value = e.after;
  }
  return { field, scope, value, key: keyOf(scope, field, value) };
}

export type EditedPost = { designId: string; initial: StoredDesign; current: StoredDesign; ctx: DiffContext; lastEditAt: string; revisionIds: string[] };
export type Proposal = { field: RuleField; scope: RuleScope; value: RuleValue; ruleKey: string; posts: number; firstAt: string; lastAt: string; revisionIds: string[]; explanation: string };

const LAYOUT_NAME: Record<Layout, string> = { 'lista-numerada': 'lista numerada', 'titulo-destaque': 'título em destaque', 'foto-titulo': 'foto com título', 'foto-janela': 'foto na janela', 'foto-arco': 'foto no arco' };
const CORNER_NAME: Record<LogoCorner, string> = { tl: 'superior esquerdo', tr: 'superior direito', bl: 'inferior esquerdo', br: 'inferior direito' };
const KIND_PLURAL: Record<PostKind, string> = { informativo: 'informativos', atmosfera: 'de atmosfera' };

// "Logo no canto inferior direito": o nome curto da regra, para a lista e para o aviso.
export function ruleTitle(r: Pick<DesignRule, 'field' | 'scope' | 'value'>): string {
  switch (r.field) {
    case 'logoCorner': return `Logo no canto ${CORNER_NAME[r.value as LogoCorner] ?? 'escolhido'}`;
    case 'logoHidden': return 'Posts sem o logo';
    case 'texts.sub': return 'Sem subtítulo na imagem';
    case 'texts.kicker': return 'Sem selo na imagem';
    case 'layout': return `Layout ${LAYOUT_NAME[r.value as Layout] ?? 'escolhido'} nos posts ${KIND_PLURAL[r.scope as PostKind] ?? ''}`.trim();
    case 'colors.title': return `Título na cor ${String(r.value)} nos posts ${KIND_PLURAL[r.scope as PostKind] ?? ''}`.trim();
    case 'colors.sub': return `Subtítulo na cor ${String(r.value)} nos posts ${KIND_PLURAL[r.scope as PostKind] ?? ''}`.trim();
  }
}

// A explicação que a pessoa lê ao decidir. Template, até 200 caracteres.
export function explanationFor(c: Pick<Candidate, 'field' | 'scope' | 'value'>, posts: number): string {
  const n = `em ${posts} posts nos últimos ${RULE_WINDOW_DAYS} dias`;
  switch (c.field) {
    case 'logoCorner': return `Você moveu o logo para o canto ${CORNER_NAME[c.value as LogoCorner] ?? 'escolhido'} ${n}. Usar este canto nos próximos posts?`;
    case 'logoHidden': return `Você escondeu o logo ${n}. Gerar os próximos posts sem o logo?`;
    case 'texts.sub': return `Você tirou o subtítulo da imagem ${n}. Gerar os próximos posts sem subtítulo?`;
    case 'texts.kicker': return `Você tirou o selo da imagem ${n}. Gerar os próximos posts sem selo?`;
    case 'layout': return `Você trocou o layout para ${LAYOUT_NAME[c.value as Layout] ?? 'outro'} ${n}, nos posts ${KIND_PLURAL[c.scope as PostKind] ?? ''}. Usar este layout nos próximos?`.replace(' ,', ',');
    case 'colors.title': return `Você mudou a cor do título para ${String(c.value)} ${n}, nos posts ${KIND_PLURAL[c.scope as PostKind] ?? ''}. Usar esta cor nos próximos?`;
    case 'colors.sub': return `Você mudou a cor do subtítulo para ${String(c.value)} ${n}, nos posts ${KIND_PLURAL[c.scope as PostKind] ?? ''}. Usar esta cor nos próximos?`;
  }
}

const parse = (iso: string) => Date.parse(iso);

// O que vira proposta agora. Conta posts DIFERENTES com a mesma mudança líquida, dentro da janela. Regra que já
// existe (proposta, ativa ou desligada) não se repete; dispensada só volta depois de 60 dias e de mais 3 posts
// editados depois da dispensa.
export function findProposals(posts: readonly EditedPost[], existing: readonly DesignRule[], now: Date): Proposal[] {
  const since = now.getTime() - RULE_WINDOW_DAYS * DAY_MS;
  const byKey = new Map<string, { c: Candidate; posts: EditedPost[] }>();
  for (const p of posts) {
    const at = parse(p.lastEditAt);
    if (!Number.isFinite(at) || at < since || at > now.getTime()) continue;
    for (const c of candidatesOf(p.initial, p.current, p.ctx)) {
      const slot = byKey.get(c.key) ?? { c, posts: [] };
      if (!slot.posts.some((x) => x.designId === p.designId)) slot.posts.push(p); // post diferente: o mesmo design conta uma vez
      byKey.set(c.key, slot);
    }
  }
  const known = new Map(existing.map((r) => [keyOf(r.scope, r.field, r.value), r]));
  const out: Proposal[] = [];
  for (const [key, { c, posts: list }] of byKey) {
    const old = known.get(key);
    let counted = list;
    if (old) {
      if (old.status !== 'dismissed' || !old.decidedAt) continue;
      const decided = parse(old.decidedAt);
      if (now.getTime() - decided < DISMISS_COOLDOWN_DAYS * DAY_MS) continue;
      counted = list.filter((p) => parse(p.lastEditAt) > decided);
    }
    if (counted.length < RULE_THRESHOLD) continue;
    const times = counted.map((p) => parse(p.lastEditAt)).sort((a, b) => a - b);
    out.push({
      field: c.field,
      scope: c.scope,
      value: c.value,
      ruleKey: key,
      posts: counted.length,
      firstAt: new Date(times[0]).toISOString(),
      lastAt: new Date(times[times.length - 1]).toISOString(),
      revisionIds: counted.flatMap((p) => p.revisionIds).slice(0, 10),
      explanation: explanationFor(c, counted.length),
    });
  }
  return out;
}

// ── Aplicar ─────────────────────────────────────────────────────────────────

export type ApplyContext = { kind: PostKind; hasVisual: boolean };

// A regra sobre um design; nulo quando não se aplica a este post (outro tipo, layout que não serve, nada a mudar).
export function applyRule(design: StoredDesign, rule: Pick<DesignRule, 'field' | 'scope' | 'value'>, ctx: ApplyContext): StoredDesign | null {
  if (rule.scope !== 'any' && rule.scope !== ctx.kind) return null;
  switch (rule.field) {
    case 'layout': {
      if (design.layout === rule.value) return null;
      if (!compatibleLayouts(ctx.kind, design.texts, ctx.hasVisual).includes(rule.value as Layout)) return null;
      return { ...design, layout: rule.value as Layout };
    }
    case 'logoCorner': {
      const corner = (design.logoCorner ?? defaultCorner(design.layout)) === rule.value;
      return corner ? null : { ...design, logoCorner: rule.value as LogoCorner };
    }
    case 'logoHidden': return design.logoHidden ? null : { ...design, logoHidden: true };
    case 'texts.sub': return design.texts.sub ? { ...design, texts: { ...design.texts, sub: undefined } } : null;
    case 'texts.kicker': return design.texts.kicker ? { ...design, texts: { ...design.texts, kicker: undefined } } : null;
    case 'colors.title': return design.colors?.title === rule.value ? null : { ...design, colors: { ...design.colors, title: String(rule.value) } };
    case 'colors.sub': return design.colors?.sub === rule.value ? null : { ...design, colors: { ...design.colors, sub: String(rule.value) } };
  }
}

export type Applied = { design: StoredDesign; applied: string[]; skipped: Array<{ id: string; reason: 'not_applicable' | 'would_worsen' }> };

// As regras ativas, uma a uma. `blockers` devolve as regras do revisor que travam o design; a regra que cria um
// achado novo (que o post não tinha antes) é pulada naquele post: a regra nunca piora o post.
export function applyRules(design: StoredDesign, rules: readonly DesignRule[], ctx: ApplyContext, blockers: (d: StoredDesign) => string[]): Applied {
  let cur = design;
  let baseline = new Set(blockers(cur));
  const applied: string[] = [];
  const skipped: Applied['skipped'] = [];
  for (const rule of rules) {
    if (rule.status !== 'active') continue;
    const next = applyRule(cur, rule, ctx);
    if (!next) {
      skipped.push({ id: rule.id, reason: 'not_applicable' });
      continue;
    }
    const found = blockers(next);
    if (found.some((r) => !baseline.has(r))) {
      skipped.push({ id: rule.id, reason: 'would_worsen' });
      continue;
    }
    cur = next;
    baseline = new Set(found);
    applied.push(rule.id);
  }
  return { design: cur, applied, skipped };
}
