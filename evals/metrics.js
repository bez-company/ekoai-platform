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
