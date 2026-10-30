// parse.ts: o contrato de saída de cada agente do estúdio (SPEC 030, decisão 8). Puro. O que o modelo devolve nunca alimenta o próximo
// agente sem passar por aqui: formato, tamanhos e enumerações conferidos, e falha com o motivo (o pipeline repete uma vez).

import { FONTS } from '../design/fonts';
import { DIMENSIONS } from './prompts';
import type { ArtAsset, ArtDirection, Critique, DirectorPick, Fix, HtmlReply, Review, ReviewIssue, Route, Strategy, StudioCopy } from './model';

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() && v.trim().length <= max ? v.trim() : null);
const HEX = /^#[0-9a-fA-F]{6}$/;

// O modelo às vezes embrulha o objeto num array de um item.
export const unwrap = (v: unknown): unknown => (Array.isArray(v) && v.length === 1 && obj(v[0]) ? v[0] : v);

export const COPY_LIMITS = { headline: 120, support: 160, extra: 90, extras: 6, caption: 2200, captionMin: 60, hashtags: 30, altText: 1000 };

export function parseStrategy(raw: unknown, territories: string[]): Parsed<Strategy> {
  const o = obj(unwrap(raw));
  if (!o) return fail('A estratégia não é um objeto.');
  const routes: Route[] = [];
  for (const r of Array.isArray(o.routes) ? o.routes : []) {
    const x = obj(r);
    const territory = str(x?.territory, 60);
    const bigIdea = str(x?.bigIdea, 600);
    const hook = str(x?.hook, 300);
    if (!x || !territory || !territories.includes(territory) || !bigIdea || !hook) continue;
    routes.push({ territory, bigIdea, hook, visual: str(x.visual, 400) ?? '', ...(str(x.why, 500) ? { why: str(x.why, 500) as string } : {}), ...(Number.isFinite(Number(x.fit)) ? { fit: Number(x.fit) } : {}) });
  }
  if (!routes.length) return fail('Nenhuma rota válida (território, ideia e gancho).');
  return { ok: true, value: { read: str(o.read, 400) ?? '', objective: str(o.objective, 60) ?? '', insight: str(o.insight, 400) ?? '', routes } };
}

export function parseDirector(raw: unknown, routes: Route[]): Parsed<DirectorPick> {
  const o = obj(unwrap(raw));
  if (!o) return fail('A escolha do diretor não é um objeto.');
  const choice = Number(o.choice);
  const index = Number.isInteger(choice) && choice >= 1 && choice <= routes.length ? choice - 1 : 0;
  return { ok: true, value: { index, route: routes[index], why: str(o.why, 600) ?? '', sharpen: str(o.sharpen, 900) ?? '', avoid: (Array.isArray(o.avoid) ? o.avoid : []).map((a) => str(a, 300)).filter((a): a is string => !!a).slice(0, 6) } };
}

// Rótulo de público do tipo "todo empreendedor que não sabe programar": classifica a pessoa pelo que ela não sabe ou não tem (BEZ-504).
const AUDIENCE_LABEL = /\bto(?:do|da|dos|das)s?\s+(?:o\s+|a\s+|os\s+|as\s+)?[\p{L}-]+(?:\s+[\p{L}-]+){0,2}\s+que\s+n[aã]o\s+(?:sabe|sabem|entende|entendem|tem|têm|consegue|conseguem|conhece|conhecem|usa|usam)\b/iu;
export const audienceLabel = (text: string): string | null => AUDIENCE_LABEL.exec(text)?.[0] ?? null;

export function parseCopy(raw: unknown): Parsed<StudioCopy> {
  const o = obj(unwrap(raw));
  if (!o) return fail('O texto não é um objeto.');
  const headline = str(o.headline, COPY_LIMITS.headline);
  if (!headline) return fail(`O título é obrigatório e vai até ${COPY_LIMITS.headline} caracteres.`);
  const support = o.support == null ? null : str(o.support, COPY_LIMITS.support);
  if (o.support != null && !support) return fail(`O apoio vai até ${COPY_LIMITS.support} caracteres, ou null.`);
  const extras = (Array.isArray(o.extras) ? o.extras : []).map((e) => str(e, COPY_LIMITS.extra)).filter((e): e is string => !!e);
  if (extras.length > COPY_LIMITS.extras) return fail(`No máximo ${COPY_LIMITS.extras} textos extras, de até ${COPY_LIMITS.extra} caracteres.`);
  const caption = typeof o.caption === 'string' ? o.caption.trim() : '';
  if (caption.length < COPY_LIMITS.captionMin || caption.length > COPY_LIMITS.caption) return fail(`A legenda tem de ${COPY_LIMITS.captionMin} a ${COPY_LIMITS.caption} caracteres.`);
  const hashtags = (Array.isArray(o.hashtags) ? o.hashtags : []).map((h) => (typeof h === 'string' ? h.trim() : '')).filter((h) => /^#\S{1,60}$/.test(h)).slice(0, COPY_LIMITS.hashtags);
  const labeled = [headline, support ?? '', ...extras, caption].map(audienceLabel).find((m) => m);
  if (labeled) return fail(`"${labeled}" rotula o público pelo que ele não sabe ou não tem. Fale com a pessoa, sem classificá-la nem generalizar ("todo X que não...").`);
  const options = (Array.isArray(o.options) ? o.options : []).map((x) => str(x, COPY_LIMITS.headline)).filter((x): x is string => !!x).slice(0, 8);
  return { ok: true, value: { ...(options.length ? { options } : {}), headline, support, extras, caption, hashtags, altText: str(o.altText, COPY_LIMITS.altText) ?? '' } };
}

const ASPECTS = ['4:5', '1:1', '16:9', '9:16'] as const;

export function parseArt(raw: unknown, defaults: { fontHeading: string; fontBody: string }): Parsed<ArtDirection> {
  const o = obj(unwrap(raw));
  if (!o) return fail('A direção de arte não é um objeto.');
  const concept = str(o.concept, 800);
  const composition = str(o.composition, 1000);
  if (!concept || !composition) return fail('Faltam o conceito e a composição.');
  const p = obj(o.palette);
  if (!p || !HEX.test(String(p.bg)) || !HEX.test(String(p.ink)) || !HEX.test(String(p.accent))) return fail('A paleta precisa de bg, ink e accent em #RRGGBB.');
  const t = obj(o.typography) ?? {};
  // Fonte fora da lista curada cai na da marca em vez de reprovar: o designer só pode usar as da lista.
  const family = (v: unknown, fallback: string): string => (typeof v === 'string' && v in FONTS ? v : fallback);
  const logo = obj(o.logo);
  const assets: ArtAsset[] = [];
  for (const a of Array.isArray(o.assets) ? o.assets.slice(0, 2) : []) {
    const x = obj(a);
    const id = typeof x?.id === 'string' && /^[\w-]{1,30}$/.test(x.id) ? x.id : null;
    const prompt = str(x?.prompt, 1500);
    if (!x || !id || !prompt || prompt.length < 20) continue;
    assets.push({ id, role: str(x.role, 200) ?? '', aspect: (ASPECTS as readonly string[]).includes(String(x.aspect)) ? (x.aspect as ArtAsset['aspect']) : '4:5', prompt });
  }
  return {
    ok: true,
    value: {
      concept,
      composition,
      palette: { bg: String(p.bg), ink: String(p.ink), accent: String(p.accent), extra: HEX.test(String(p.extra)) ? String(p.extra) : null },
      typography: { display: family(t.display, defaults.fontHeading), body: family(t.body, defaults.fontBody), accent: typeof t.accent === 'string' && t.accent in FONTS ? t.accent : null, ...(str(t.treatment, 300) ? { treatment: str(t.treatment, 300) as string } : {}) },
      details: (Array.isArray(o.details) ? o.details : []).map((d) => str(d, 300)).filter((d): d is string => !!d).slice(0, 6),
      logo: { tone: logo?.tone === 'on-dark' ? 'on-dark' : 'on-light', place: str(logo?.place, 300) ?? '' },
      assets,
    },
  };
}

export function parseCritique(raw: unknown): Parsed<Critique> {
  const o = obj(unwrap(raw));
  const s = obj(o?.scores);
  if (!o || !s) return fail('A crítica não tem notas.');
  const scores: Record<string, number> = {};
  for (const k of Object.keys(DIMENSIONS)) {
    const n = Number(s[k]);
    if (Number.isFinite(n) && n >= 0 && n <= 10) scores[k] = n;
  }
  if (Object.keys(scores).length < 5) return fail('A crítica precisa de notas de 0 a 10 em pelo menos 5 dimensões.');
  const fixes: Fix[] = [];
  for (const f of Array.isArray(o.fixes) ? o.fixes.slice(0, 5) : []) {
    const x = obj(f);
    const fix = str(x?.fix, 800);
    if (!x || !fix) continue;
    fixes.push({ severity: x.severity === 'alta' || x.severity === 'baixa' ? x.severity : 'media', fix, target: x.target === 'asset' ? 'asset' : 'layout', ...(typeof x.assetId === 'string' ? { assetId: x.assetId } : {}) });
  }
  const verdict = o.verdict === 'ship' || o.verdict === 'restart' ? o.verdict : 'revise';
  return { ok: true, value: { scores, slop: (Array.isArray(o.slop) ? o.slop : []).map((x) => str(x, 300)).filter((x): x is string => !!x), regression: str(o.regressao, 600), fixes, verdict, summary: str(o.summary, 600) ?? '' } };
}

// Nota única: a média das dimensões, com o conceito e a originalidade valendo o dobro (é onde o post padrão perde).
export function totalScore(scores: Record<string, number>): number {
  const weight: Record<string, number> = { conceito: 2, originalidade: 2 };
  let sum = 0;
  let w = 0;
  for (const key of Object.keys(DIMENSIONS)) {
    const v = Number(scores[key]);
    if (!Number.isFinite(v)) continue;
    sum += v * (weight[key] ?? 1);
    w += weight[key] ?? 1;
  }
  return w ? Math.round((sum / w) * 10) / 10 : 0;
}

const REVIEW_RULES = ['text_drift', 'ai_artifact', 'logo', 'legibilidade', 'fato'] as const;

export function parseReview(raw: unknown): Parsed<Review> {
  const o = obj(unwrap(raw));
  if (!o || typeof o.ok !== 'boolean') return fail('A revisão precisa dizer se está ok.');
  const issues: ReviewIssue[] = [];
  for (const i of Array.isArray(o.issues) ? o.issues : []) {
    const x = obj(i);
    const detail = str(x?.detail, 600);
    if (!x || !detail || !(REVIEW_RULES as readonly string[]).includes(String(x.rule))) continue;
    issues.push({ rule: x.rule as ReviewIssue['rule'], detail, fix: str(x.fix, 600) ?? '' });
  }
  // Reprovar sem dizer o que está errado não leva a conserto: vale como aprovado.
  return { ok: true, value: { ok: o.ok || issues.length === 0, issues } };
}

// A resposta do designer e do embelezador: notas, pedidos de imagem nova e o HTML (nunca dentro de JSON).
export function parseHtmlReply(text: string): Parsed<HtmlReply> {
  const notes = /===NOTES===([\s\S]*?)(?====REGEN===|===HTML===)/.exec(text)?.[1]?.trim() ?? '';
  const regenRaw = /===REGEN===([\s\S]*?)===HTML===/.exec(text)?.[1]?.trim() ?? '';
  const htmlRaw = /===HTML===([\s\S]*)$/.exec(text)?.[1] ?? text;
  const html = htmlRaw.replace(/^\s*```(?:html)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  let regen: HtmlReply['regen'] = [];
  if (regenRaw) {
    try {
      const parsed: unknown = JSON.parse(regenRaw.replace(/```json\n?|```/g, '').trim());
      regen = (Array.isArray(parsed) ? parsed : []).flatMap((r) => {
        const x = obj(r);
        const id = typeof x?.id === 'string' ? x.id : null;
        const prompt = str(x?.prompt, 1500);
        return id && prompt ? [{ id, prompt }] : [];
      });
    } catch {
      regen = [];
    }
  }
  if (!/<html[\s>]/i.test(html) && !/<body[\s>]/i.test(html)) return fail('O designer não devolveu um documento HTML.');
  return { ok: true, value: { notes, regen, html } };
}
