// directives-apply.ts: o código obedece as instruções do pedido (SPEC 020, ADR 0022). Puro, sem I/O. Três passos,
// usados pelo generatePost e pelo espelho do eval: planejar antes do redator (qual família, qual tipo de post, se
// há foto, o que o redator deve saber), compor depois (o texto da imagem, os fundos, as posições) e revisar o
// resultado. O modelo escreve só o que a pessoa não ditou. Instrução que não dá para cumprir NUNCA some em
// silêncio: vira "Não aplicado" com o motivo, e o post sai com o que coube.

import type { Directives, Element, Place } from './directives';
import type { Issue } from './design/review';
import type { Layout, LogoCorner, Placements, PostKind, Texts } from './design/model';
import { defaultLayout } from './design/model';

export type Situation = {
  kind: PostKind | null; // o tipo escolhido na tela (null = o agente escolhe)
  hasLogo: boolean;
  hasHandle: boolean;
  brandName: string | null; // o nome da empresa na conta
};

export type NotApplied = { key: string; what: string; why: string };

export type Plan = {
  brandCard: boolean; // família `marca`
  familyBackground: Directives['background'] | null; // fundo pedido sem cartão: vale nas famílias de lista e de título
  kind: PostKind | null; // o tipo que o redator recebe (o cartão de marca nunca tem foto)
  skipVisual: boolean; // não chama o modelo de imagem
  itemsCount: number | null;
  avoid: string[];
  exactTexts: string[];
  textOnly: boolean;
  notApplied: NotApplied[];
};

// O máximo de itens que uma imagem de lista leva (a família lista-numerada tem 4 posições).
export const MAX_ITEMS = 4;

const CORNERS: readonly string[] = ['tl', 'tr', 'bl', 'br'];
const isCorner = (p: string): p is LogoCorner => CORNERS.includes(p);

const ELEMENT_TEXT: Record<Element, string> = { logo: 'O logo', name: 'O nome da empresa', handle: 'O @', title: 'O texto principal' };
const PLACE_TEXT: Record<Place, string> = {
  tl: 'canto superior esquerdo',
  tc: 'topo, no centro',
  tr: 'canto superior direito',
  ml: 'meio, à esquerda',
  c: 'centro',
  mr: 'meio, à direita',
  bl: 'canto inferior esquerdo',
  bc: 'base, no centro',
  br: 'canto inferior direito',
};
const BG_TEXT = { dark: 'Fundo escuro', light: 'Fundo claro', brand: 'Fundo na cor da marca' } as const;

export type Described = { key: string; text: string };

// Cada instrução em uma frase, com a chave que o "Não aplicado" usa para apontar a qual ela se refere.
export function describeEach(d: Directives): Described[] {
  const out: Described[] = [];
  if (d.background) out.push({ key: 'background', text: BG_TEXT[d.background] });
  for (const [el, where] of Object.entries(d.elements ?? {}) as [Element, Place | 'off'][]) out.push({ key: `elements.${el}`, text: where === 'off' ? `${ELEMENT_TEXT[el]} fora da imagem` : `${ELEMENT_TEXT[el]}: ${PLACE_TEXT[where]}` });
  if (d.exactTexts?.length) out.push({ key: 'exactTexts', text: `Texto exato: ${d.exactTexts.map((t) => `"${t}"`).join(', ')}` });
  if (d.textOnly) out.push({ key: 'textOnly', text: 'Mais nada de texto na imagem' });
  if (d.itemsCount) out.push({ key: 'itemsCount', text: `${d.itemsCount} itens` });
  if (d.noPhoto) out.push({ key: 'noPhoto', text: 'Sem foto' });
  if (d.avoid?.length) out.push({ key: 'avoid', text: `Não colocar: ${d.avoid.join(', ')}` });
  return out;
}

// ── 1. Planejar ──────────────────────────────────────────────────────────────

export function planDirectives(d: Directives, s: Situation): Plan {
  const el = d.elements ?? {};
  const notApplied: NotApplied[] = [];
  const skip = (key: string, what: string, why: string) => notApplied.push({ key, what, why });

  const photoPost = s.kind === 'atmosfera' && !d.noPhoto && !d.background;
  const wantsName = el.name !== undefined && el.name !== 'off';
  const logoOffCorner = !!el.logo && el.logo !== 'off' && !isCorner(el.logo);
  // Posição pedida de nome, @, título ou logo fora dos cantos, ou "sem foto" num post de atmosfera: só o cartão de marca desenha.
  const positionTrigger = wantsName || el.handle !== undefined || el.title !== undefined || logoOffCorner || (!!d.noPhoto && s.kind === 'atmosfera');
  // A pessoa não deixou texto livre para o redator (frase exata ou "mais nada"): o fundo pedido vira cartão de marca.
  // Com assunto livre ou lista, o fundo vale nas famílias de sempre (um cartão sem texto jogaria o conteúdo fora).
  const contentFreeExact = !!d.textOnly && (d.exactTexts?.length ?? 0) > 0;
  const contentFree = !!d.textOnly || (d.exactTexts?.length ?? 0) > 0;
  const wantsComposition = positionTrigger || (!!d.background && contentFree && !d.itemsCount);
  const brandCard = wantsComposition && !photoPost;
  const familyBackground = !brandCard && !photoPost && d.background ? d.background : null;
  if (photoPost && wantsComposition) {
    const why = 'Um post com foto não tem posição livre para isso. Peça fundo liso para ter o cartão de marca.';
    if (wantsName) skip('elements.name', `${ELEMENT_TEXT.name}`, why);
    if (logoOffCorner) skip('elements.logo', ELEMENT_TEXT.logo, 'Sobre a foto o logo só vai nos cantos.');
    if (el.handle !== undefined && el.handle !== 'off') skip('elements.handle', ELEMENT_TEXT.handle, 'Sobre a foto o @ fica no canto oposto ao do logo.');
    if (el.handle === 'off') skip('elements.handle', ELEMENT_TEXT.handle, 'O @ aparece em todo post com foto.');
    if (el.title !== undefined && !d.textOnly) skip('elements.title', ELEMENT_TEXT.title, why);
  }

  if (brandCard) {
    if (el.logo && el.logo !== 'off' && !s.hasLogo) skip('elements.logo', ELEMENT_TEXT.logo, 'A conta não tem logo cadastrado. Envie o logo no perfil da empresa.');
    if (el.handle && el.handle !== 'off' && !s.hasHandle) skip('elements.handle', ELEMENT_TEXT.handle, 'A conta não tem @ cadastrado no perfil.');
    if (wantsName && !s.brandName) skip('elements.name', ELEMENT_TEXT.name, 'A conta não tem nome cadastrado.');
    if (d.itemsCount) skip('itemsCount', `${d.itemsCount} itens`, 'O cartão de marca não tem lista.');
    if ((d.exactTexts?.length ?? 0) > 1) skip('exactTexts', 'Mais de um texto exato', 'O cartão de marca tem uma frase só; vale a primeira.');
  } else if (photoPost && d.itemsCount) {
    skip('itemsCount', `${d.itemsCount} itens`, 'Post com foto não tem lista.');
  } else if ((d.itemsCount ?? 0) > MAX_ITEMS) {
    skip('itemsCount', `${d.itemsCount} itens`, `A lista leva no máximo ${MAX_ITEMS} itens por imagem. O post saiu com ${MAX_ITEMS}.`);
  }

  return {
    brandCard,
    familyBackground,
    // Frase exata com "mais nada" e tipo em aberto: o agente não pode escolher foto de fundo ("só isso" é só isso).
    kind: brandCard || (familyBackground && s.kind === 'atmosfera') || (s.kind === null && d.textOnly && contentFreeExact) ? 'informativo' : s.kind,
    skipVisual: brandCard || !!d.noPhoto || (!!familyBackground && s.kind === 'atmosfera'),
    itemsCount: brandCard || photoPost || !d.itemsCount ? null : Math.min(MAX_ITEMS, d.itemsCount),
    avoid: d.avoid ?? [],
    exactTexts: d.exactTexts ?? [],
    textOnly: !!d.textOnly,
    notApplied,
  };
}

// O que o prompt do redator precisa saber do plano (agents.ts).
export type WriterHints = { brandCard: boolean; itemsCount: number | null; avoid: string[]; exactTexts: string[]; textOnly: boolean };
export const writerHints = (p: Plan): WriterHints => ({ brandCard: p.brandCard, itemsCount: p.itemsCount, avoid: p.avoid, exactTexts: p.exactTexts, textOnly: p.textOnly });

// ── 2. Compor ────────────────────────────────────────────────────────────────

export type DesignPieces = {
  layout: Layout;
  texts: Texts;
  background?: Directives['background'];
  placements?: Placements;
  brandName?: string;
  logoCorner?: LogoCorner;
  logoHidden?: boolean;
  applied: Described[];
  notApplied: NotApplied[];
};

type CopyTexts = { kind: PostKind; texts: Texts };

// O design do post com as instruções por cima do que o redator devolveu. Texto literal entra sem passar pelo
// modelo e sem corte; `textOnly` apaga selo, subtítulo e itens (e o título, se a pessoa não ditou nenhum).
export function composeDesign(d: Directives, plan: Plan, copy: CopyTexts, s: Situation): DesignPieces {
  const el = d.elements ?? {};
  const notApplied = [...plan.notApplied];
  const exact = plan.exactTexts;
  let texts: Texts;
  const out: Partial<DesignPieces> = {};

  if (plan.brandCard) {
    const wantsTitle = el.title !== undefined && el.title !== 'off';
    const title = exact[0] ?? (wantsTitle && !plan.textOnly ? copy.texts.title : '');
    texts = { title };
    out.background = d.background ?? 'dark';
    const placements: Placements = {};
    for (const [k, v] of Object.entries(el) as [Element, Place | 'off'][]) {
      if (k === 'logo' && !s.hasLogo) continue;
      if (k === 'handle' && !s.hasHandle) continue;
      if (k === 'name' && !s.brandName) continue;
      placements[k] = v;
    }
    // Frase ditada sem posição: no centro. Sem nada dito, o título não aparece.
    if (title && !placements.title) placements.title = 'c';
    if (Object.keys(placements).length) out.placements = placements;
    if (s.brandName && el.name !== 'off' && el.name !== undefined) out.brandName = s.brandName;
  } else {
    const base = copy.texts;
    const title = exact[0] ?? base.title;
    const sub = exact[1];
    const rest = exact.slice(2);
    if (rest.length === 1) notApplied.push({ key: 'exactTexts', what: `Texto exato: "${rest[0]}"`, why: 'Um item sozinho não forma lista; o texto ficou de fora.' });
    const items = rest.length >= 2 ? rest : undefined;
    if (plan.textOnly) {
      // Só o que a pessoa ditou. Sem texto ditado, num post com foto a imagem fica sem título; no resto, fica o título do redator.
      const photo = copy.kind === 'atmosfera';
      texts = { title: exact.length || !photo ? title : '', ...(sub ? { sub } : {}), ...(items ? { items } : {}) };
    } else {
      texts = { ...base, title, ...(sub ? { sub } : {}), ...(items ? { items } : exact.length > 2 ? { items: undefined } : {}) };
    }
    if (plan.familyBackground) out.background = plan.familyBackground;
    if (el.logo === 'off') out.logoHidden = true;
    else if (el.logo && isCorner(el.logo) && s.hasLogo) out.logoCorner = el.logo;
    else if (el.logo && isCorner(el.logo)) notApplied.push({ key: 'elements.logo', what: ELEMENT_TEXT.logo, why: 'A conta não tem logo cadastrado. Envie o logo no perfil da empresa.' });
    if (el.name === 'off') {
      // As outras famílias não escrevem o nome da empresa: nada a tirar.
    }
  }

  const layout: Layout = plan.brandCard ? 'marca' : defaultLayout(copy.kind, texts);
  const skipped = new Set(notApplied.map((n) => n.key));
  // A chave exactTexts "aplicada" só vale se o texto exato foi usado: no cartão de marca, o primeiro.
  const applied = describeEach(d).filter((x) => !skipped.has(x.key) || (x.key === 'exactTexts' && exact.length > 0));
  return { layout, texts, ...out, applied, notApplied };
}

// O que a tela Aprovar lista (SPEC 020, entrega d): cada instrução, na ordem do pedido, com Aplicado ou Não aplicado e
// o motivo. Uma instrução aplicada só em parte (mais de um texto exato num cartão) ganha uma linha extra do que ficou de fora.
export type DirectiveItem = { text: string; ok: boolean; why?: string };

export function directiveItems(d: Directives, pieces: Pick<DesignPieces, 'applied' | 'notApplied'>): DirectiveItem[] {
  const applied = new Set(pieces.applied.map((a) => a.key));
  const skipped = new Map(pieces.notApplied.map((n) => [n.key, n]));
  const items = describeEach(d).map((x): DirectiveItem => {
    const n = skipped.get(x.key);
    return applied.has(x.key) || !n ? { text: x.text, ok: true } : { text: x.text, ok: false, why: n.why };
  });
  const partial = pieces.notApplied.filter((n) => applied.has(n.key)).map((n): DirectiveItem => ({ text: n.what, ok: false, why: n.why }));
  return [...items, ...partial];
}

// ── 3. Revisar ───────────────────────────────────────────────────────────────

const loose = (s: string) => s.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();

// Na volta do redator: a quantidade de itens pedida.
export function reviewCount(plan: Plan, copy: { texts: Texts }): Issue[] {
  if (!plan.itemsCount) return [];
  const got = copy.texts.items?.length ?? 0;
  if (got === plan.itemsCount) return [];
  const message = `A pessoa pediu ${plan.itemsCount} itens e o texto trouxe ${got}. Devolva exatamente ${plan.itemsCount} itens em texts.items.`;
  return [{ rule: 'directive_count', detail: `${got}/${plan.itemsCount}`, message, where: 'image' }];
}

// Os textos ditados que a imagem de fato leva: no cartão de marca só o primeiro; nas outras famílias, título,
// subtítulo e a lista (um item sozinho não forma lista e fica de fora).
export function usedExactTexts(plan: Plan): string[] {
  const e = plan.exactTexts;
  if (plan.brandCard) return e.slice(0, 1);
  return e.slice(2).length === 1 ? e.slice(0, 2) : e;
}

// No post composto: o texto literal tem que estar na imagem e, com "mais nada", nada além do ditado.
export function reviewComposed(d: Directives, plan: Plan, pieces: Pick<DesignPieces, 'texts' | 'brandName' | 'notApplied'>): Issue[] {
  const issues: Issue[] = [];
  const t = pieces.texts;
  const drawn = [t.kicker, t.title, t.sub, ...(t.items ?? [])].filter((x): x is string => !!x);
  const used = usedExactTexts(plan);
  for (const text of used) {
    if (!drawn.some((x) => loose(x) === loose(text))) issues.push({ rule: 'directive_text_missing', detail: text, message: `O texto "${text}" que a pessoa pediu não está na imagem.`, where: 'image' });
  }
  if (plan.textOnly) {
    const allowed = new Set(used.map(loose));
    const extra = drawn.filter((x) => !allowed.has(loose(x)));
    // Sem texto ditado, o único texto permitido é o título que a própria instrução pediu em algum lugar.
    const tolerated = plan.exactTexts.length === 0 && plan.brandCard && d.elements?.title !== undefined && d.elements.title !== 'off' ? 1 : 0;
    if (extra.length > tolerated) issues.push({ rule: 'directive_extra_text', detail: extra.join(' | ').slice(0, 120), message: `A pessoa pediu "mais nada" na imagem e ela traz texto a mais: ${extra.map((x) => `"${x}"`).join(', ')}.`, where: 'image' });
  }
  return issues;
}
