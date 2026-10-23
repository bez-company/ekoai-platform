// metrics.js: checagens por código, sem modelo, sobre o resultado de uma geração. Cada uma devolve
// { id, pass, reason }. Entram na nota de ofício ao lado das exigências julgadas.

import { blocking } from '../platform/src/lib/design/review.ts';

const DASH = /[–—]/;
const EMOJI = /\p{Extended_Pictographic}/u;

export function codeChecks({ copy, imageTexts, textIssues, layoutIssues }) {
  const drawn = imageTexts.join(' \n ');
  const hard = blocking;
  const tags = copy.hashtags ?? [];
  const lowered = tags.every((h) => h === h.toLowerCase() && !/[̀-ͯ]/.test(h.normalize('NFD')));
  return [
    { id: 'cod-sem-travessao', pass: !DASH.test(drawn) && !DASH.test(copy.caption), reason: 'Travessão (— ou –) no texto da imagem ou na legenda.' },
    { id: 'cod-sem-emoji-na-imagem', pass: !EMOJI.test(drawn), reason: 'Emoji no texto desenhado na imagem.' },
    { id: 'cod-hashtags', pass: tags.length >= 3 && tags.length <= 8 && lowered, reason: `Hashtags: ${tags.length} (o pedido é de 3 a 8, minúsculas, sem acento).` },
    { id: 'cod-revisor-limpo', pass: hard(textIssues).length === 0, reason: `O revisor de texto ainda reprovava o resultado final: ${hard(textIssues).map((i) => i.rule).join(', ')}.` },
    { id: 'cod-layout-limpo', pass: hard(layoutIssues).length === 0, reason: `O revisor de layout reprovava o PNG final: ${hard(layoutIssues).map((i) => i.rule).join(', ')}.` },
  ];
}

const looseText = (s) => s.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();

// O leitor de instruções contra o que uma pessoa esperava do pedido (`directives` do caso). Regras: chave
// ausente na expectativa = o leitor não pode anotar (invenção); '*' = qualquer valor; lista = qualquer um dela;
// `optional` lista chaves que ele pode anotar ou não. Devolve { pass, reason }.
export function compareDirectives(expected, got) {
  const optional = new Set(expected.optional ?? []);
  const problems = [];
  const same = (want, have) => (want === '*' ? have != null : Array.isArray(want) ? want.includes(have) : want === have);

  for (const key of Object.keys(got)) {
    if (key in expected || optional.has(key)) continue;
    // `elements` pode vir só com elementos marcados como opcionais (elements.title)
    const extra = key === 'elements' ? Object.keys(got.elements).filter((el) => !optional.has(`elements.${el}`)) : [key];
    if (extra.length) problems.push(`anotou ${key} sem a pessoa pedir`);
  }
  for (const [key, want] of Object.entries(expected)) {
    if (key === 'optional') continue;
    const have = got[key];
    if (have == null) {
      if (!optional.has(key)) problems.push(`não anotou ${key}`);
    } else if (key === 'elements') {
      for (const [el, place] of Object.entries(want)) if (!same(place, have[el])) problems.push(`elemento ${el}: esperado ${JSON.stringify(place)}, veio ${JSON.stringify(have[el] ?? null)}`);
      for (const el of Object.keys(have)) if (!(el in want) && !optional.has('elements') && !optional.has(`elements.${el}`)) problems.push(`elemento ${el} anotado sem a pessoa pedir`);
    } else if (key === 'exactTexts') {
      if (JSON.stringify(want.map(looseText)) !== JSON.stringify(have.map(looseText))) problems.push(`texto literal: esperado ${JSON.stringify(want)}, veio ${JSON.stringify(have)}`);
    } else if (!same(want, have)) {
      problems.push(`${key}: esperado ${JSON.stringify(want)}, veio ${JSON.stringify(have)}`);
    }
  }
  return { pass: problems.length === 0, reason: problems.join('; ') };
}
