// review.ts: o revisor por regra (SPEC 012, decisão 4). Sem modelo. Confere o texto (palavra
// proibida, acento, número fora dos fatos, promessa, travessão) e o layout (fonte mínima, margem
// do feed, sobreposição, contraste). Cada achado tem a regra, o detalhe e a frase que a tela mostra.

import { contrast, fmtContrast, type Hex } from './color';
import { MARGIN, WIDTH } from './model';
import type { InactiveFact } from '../company-facts-model';

export type Issue = { rule: string; detail: string; message: string; where: 'image' | 'caption' };

export type TextBox = { id: string; x: number; y: number; w: number; h: number; size: number; color: Hex; bg: Hex; bold?: boolean };

// Palavras comuns que perdem o acento quando o modelo erra. Curta de propósito: pega o erro típico.
const SEM_ACENTO = ['nao', 'voce', 'tambem', 'solucao', 'solucoes', 'ate', 'ja', 'so', 'servico', 'servicos', 'producao', 'tecnologico', 'codigo', 'saude', 'familia', 'proximo', 'proxima', 'mes', 'horario'];

// Promessa de resultado: a empresa que "garante" (garantimos, garantia, garantido) ou o verbo seguido de
// resultado, cura, retorno e afins. "Você garante 30% de desconto" e "garanta o seu bolo" são condição
// comercial e passam.
const GUARANTEE = /garant(?:ia|id[oa]s?|imos|o|em)\b|garant(?:e|a|ir|am)\s+(?:o\s+|a\s+|os\s+|as\s+|seu\s+|sua\s+)?(?:resultados?|sucesso|cura|retorno|lucro|aprova[çc][ãa]o|vendas|seguidores|crescimento|satisfa[çc][ãa]o)/;

const MIN_SIZE: Record<string, number> = { title: 56, sub: 26, item: 26, kicker: 22, handle: 22 };
const EMOJI = /\p{Extended_Pictographic}/u;

export type TextReviewInput = {
  imageTexts: string[];
  caption: string;
  hashtags: string[];
  facts: string[];
  never: string[];
  banned: string[];
  // Fatos que não valem hoje (vencido, para revisar, recusado): número que só existe neles reprova.
  inactive?: InactiveFact[];
  // Número digitado na oferta da campanha do post: vale como afirmado só para ele (SPEC 018).
  allowed?: string[];
  // O pedido da pessoa, palavra por palavra. Número que ela mesma escreveu ali (30% de desconto, 13h, dia 12)
  // vale como afirmado neste post, comparado número a número. Fato vencido ou recusado continua barrando (ADR 0019).
  request?: string;
};

function numbersIn(text: string): string[] {
  // "1)" e "1." de lista não são claim; "R$ 36", "36%", "6 a 14" são.
  const cleaned = text.replace(/(^|\s)\d+[.)](?=\s)/g, ' ');
  return cleaned.match(/\d+(?:[.,]\d+)*/g) ?? [];
}

const STALE_LABEL = { expired: 'vencido', pending: 'ainda não confirmado', rejected: 'recusado' } as const;

function staleMessage(n: string, f: InactiveFact): string {
  const since = f.reason === 'expired' && f.validUntil ? ` em ${f.validUntil.slice(8, 10)}/${f.validUntil.slice(5, 7)}` : '';
  return `O número ${n} vem de um fato ${STALE_LABEL[f.reason]}${since}: "${f.text}". ${f.reason === 'rejected' ? 'Tire o número do post.' : 'Confirme ou atualize o fato para usá-lo.'}`;
}

export function reviewText(input: TextReviewInput): Issue[] {
  const issues: Issue[] = [];
  const image = input.imageTexts.join(' \n ');
  const all = `${image} \n ${input.caption}`.toLowerCase();
  const allowed = `${input.facts.join(' ')} ${(input.allowed ?? []).join(' ')} ${input.caption.match(/#\S+/g)?.join(' ') ?? ''}`;

  for (const word of input.banned) {
    const w = word.trim().toLowerCase();
    if (w && new RegExp(`(^|[^\\p{L}])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\p{L}]|$)`, 'u').test(all)) {
      issues.push({ rule: 'banned_word', detail: w, message: `A palavra "${w}" está na lista do que a marca nunca usa.`, where: image.toLowerCase().includes(w) ? 'image' : 'caption' });
    }
  }
  for (const w of SEM_ACENTO) {
    if (new RegExp(`(^|[^a-zà-ú])${w}([^a-zà-ú]|$)`).test(all)) issues.push({ rule: 'accent', detail: w, message: `"${w}" parece estar sem acento.`, where: image.toLowerCase().includes(w) ? 'image' : 'caption' });
  }
  const requested = new Set(input.request ? numbersIn(input.request) : []);
  for (const n of numbersIn(`${image} ${input.caption}`)) {
    if (allowed.includes(n)) continue;
    const where = image.includes(n) ? 'image' : 'caption';
    const stale = (input.inactive ?? []).find((f) => f.text.includes(n));
    if (requested.has(n) && !stale) continue;
    if (stale) issues.push({ rule: 'fact_not_valid', detail: n, message: staleMessage(n, stale), where });
    else issues.push({ rule: 'number_not_in_facts', detail: n, message: `O número ${n} não está na base de fatos da empresa.`, where });
  }
  if (GUARANTEE.test(all)) issues.push({ rule: 'never_claim', detail: 'garantia', message: 'Promessa de garantia: o post não pode prometer resultado.', where: /garant/.test(image.toLowerCase()) ? 'image' : 'caption' });
  for (const claim of input.never) {
    const c = claim.trim().toLowerCase();
    if (c && all.includes(c)) issues.push({ rule: 'never_claim', detail: c, message: `"${c}" está na lista do que a empresa nunca afirma.`, where: image.toLowerCase().includes(c) ? 'image' : 'caption' });
  }
  if (/[—–]/.test(`${image}${input.caption}`)) issues.push({ rule: 'dash', detail: '—', message: 'Travessão no texto: use vírgula, ponto ou dois-pontos.', where: /[—–]/.test(image) ? 'image' : 'caption' });
  if (EMOJI.test(image)) issues.push({ rule: 'emoji_in_image', detail: 'emoji', message: 'Emoji no texto da imagem não renderiza igual em todo lugar.', where: 'image' });
  if (input.caption.length > 2200) issues.push({ rule: 'caption_too_long', detail: String(input.caption.length), message: 'A legenda passa de 2.200 caracteres, o máximo do Instagram.', where: 'caption' });
  if (input.hashtags.length > 30) issues.push({ rule: 'too_many_hashtags', detail: String(input.hashtags.length), message: 'Mais de 30 hashtags: o Instagram não publica.', where: 'caption' });
  return issues;
}

// O nome do texto como a pessoa o conhece (a tela mostra a frase; o id da caixa é interno).
function nameOf(id: string): { subject: string; where: string } {
  const item = /^item(\d+)$/.exec(id);
  if (item) return { subject: `O item ${item[1]}`, where: `no item ${item[1]}` };
  const map: Record<string, { subject: string; where: string }> = {
    title: { subject: 'O título', where: 'no título' },
    sub: { subject: 'O subtítulo', where: 'no subtítulo' },
    kicker: { subject: 'O selo', where: 'no selo' },
    handle: { subject: 'O @ da conta', where: 'no @ da conta' },
  };
  return map[id] ?? { subject: `O texto "${id}"`, where: `no texto "${id}"` };
}

export function reviewLayout(boxes: TextBox[], height: number, overflow: string[] = []): Issue[] {
  const issues: Issue[] = [];
  for (const b of boxes) {
    const kind = b.id.replace(/\d+$/, '');
    const min = MIN_SIZE[kind] ?? 22;
    if (b.size < min) issues.push({ rule: 'font_size', detail: `${b.id} ${b.size}px`, message: `${nameOf(b.id).subject} ficou pequeno demais para o feed (${b.size}px, mínimo ${min}px).`, where: 'image' });
    if (b.x < MARGIN || b.y < MARGIN || b.x + b.w > WIDTH - MARGIN || b.y + b.h > height - MARGIN) {
      issues.push({ rule: 'safe_margin', detail: b.id, message: `${nameOf(b.id).subject} passa da margem de segurança do feed.`, where: 'image' });
    }
    const min_contrast = b.size >= 56 && b.bold ? 3 : 4.5;
    const ratio = contrast(b.color, b.bg);
    if (ratio < min_contrast) issues.push({ rule: 'contrast', detail: `${b.id} ${fmtContrast(ratio)}`, message: `Contraste baixo ${nameOf(b.id).where} (${fmtContrast(ratio)}, mínimo ${min_contrast === 3 ? '3:1' : '4,5:1'}). Escolha outra cor.`, where: 'image' });
  }
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i];
      const b = boxes[j];
      if (a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y) {
        issues.push({ rule: 'overlap', detail: `${a.id} x ${b.id}`, message: `${nameOf(a.id).subject} e ${nameOf(b.id).subject.toLowerCase()} estão um em cima do outro.`, where: 'image' });
      }
    }
  }
  for (const id of overflow) issues.push({ rule: 'text_too_long', detail: id, message: `${nameOf(id).subject} é longo demais para caber na imagem. Encurte.`, where: 'image' });
  return issues;
}

// O que trava a aprovação automática (o resto é aviso que a pessoa decide).
export const BLOCKING = new Set(['banned_word', 'never_claim', 'number_not_in_facts', 'fact_not_valid', 'contrast', 'overlap', 'text_too_long', 'caption_too_long', 'too_many_hashtags']);

export function blocking(issues: Issue[]): Issue[] {
  return issues.filter((i) => BLOCKING.has(i.rule));
}

// Depois de uma edição manual (SPEC 019, decisão 5): além do que já trava, margem de segurança e fonte
// mínima também travam o Confirmar. O motor sozinho nunca gera esses dois, mas quem edita o texto pode.
export const EDIT_BLOCKING = new Set([...BLOCKING, 'safe_margin', 'font_size']);

export function editBlocking(issues: Issue[]): Issue[] {
  return issues.filter((i) => EDIT_BLOCKING.has(i.rule));
}
