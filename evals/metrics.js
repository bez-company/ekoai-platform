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

// O que a plataforma declarou como "não aplicado" (chaves como `elements.logo`) contra o que a pessoa esperava:
// instrução que a conta não consegue cumprir tem que aparecer, e só ela.
export function compareNotApplied(expectedKeys, got) {
  const have = new Set(got.map((n) => n.key));
  const want = new Set(expectedKeys);
  const missing = [...want].filter((k) => !have.has(k));
  const extra = [...have].filter((k) => !want.has(k));
  const problems = [...missing.map((k) => `não declarou ${k} como não aplicado`), ...extra.map((k) => `declarou ${k} como não aplicado sem precisar`)];
  return { pass: problems.length === 0, reason: problems.join('; ') };
}

const plain = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const LINK_BIO = /link\s+(?:na|da|do|no)\s+bio/i;
// Chamada para ação no fim da legenda: um verbo de convite perto de um canal ou de um link.
const CTA_TAIL = /(?:chame|chama|fale|mande|manda|envie|clique|acesse|agende|solicite|pe[cç]a|encomende|garanta|reserve|visite|siga)[^.!?\n]{0,60}(?:whats|zap|direct|\bdm\b|mensagem|link|bio|contato|perfil)/i;

// Checagens por código da legenda e das hashtags (eval da legenda, BEZ-373): a cidade nas hashtags, "link na bio" que
// ninguém escolheu e chamada final numa conta que a omitiu.
export function captionChecks({ copy, profile }) {
  const tags = (copy.hashtags ?? []).map(plain);
  const caption = copy.caption ?? '';
  const city = plain((profile.region ?? '').split(',')[0]).replace(/[^a-z0-9]/g, '');
  const wide = profile.reach === 'national' || profile.reach === 'international' || profile.reach == null;
  const cityTags = city ? tags.filter((t) => t.includes(city)) : [];
  const tail = caption.slice(-200);
  const checks = [
    { id: 'cod-link-na-bio', pass: profile.ctaDefault === 'link_bio' || !LINK_BIO.test(caption), reason: '"link na bio" na legenda, e a conta não escolheu essa chamada.' },
    { id: 'cod-sem-link-inventado', pass: profile.ctaDefault === 'link_bio' || !/\blink\b/i.test(caption), reason: 'A legenda cita "link" e a conta não tem esse canal como chamada (nem o link existe).' },
    { id: 'cod-hashtag-sem-ano', pass: !tags.some((t) => /\d{4}/.test(t) && !/nbr\d{4}/.test(t)), reason: 'Hashtag com ano (#natal2024): envelhece e erra o ano.' },
    { id: 'cod-hashtags', pass: tags.length >= 3 && tags.length <= 8 && (copy.hashtags ?? []).every((h) => h === h.toLowerCase() && h === plain(h)), reason: `Hashtags: ${tags.length} (o pedido é de 3 a 8, minúsculas, sem acento).` },
  ];
  if (wide) checks.push({ id: 'cod-hashtag-cidade', pass: cityTags.length === 0, reason: `Hashtag da cidade (${cityTags.map((t) => `#${t}`).join(', ')}) numa conta que fala ao país ou ao mundo.` });
  if (!profile.ctaDefault) checks.push({ id: 'cod-sem-chamada', pass: !CTA_TAIL.test(tail), reason: 'A legenda fecha com chamada para ação numa conta que a omitiu.' });
  return checks;
}
