// off-topic-facts.ts: três checagens do texto que o eval mostrou que o prompt sozinho não segura. (1) Fato solto da base enchendo a imagem. Medido no eval: num post sobre outro assunto, o redator
// completa a lista ou o subtítulo com um fato da base que não tem nada a ver (o horário da fornada num post sobre
// durabilidade do pão). "Use só o que serve ao pedido" no prompt não segura; aqui o código devolve o motivo ao
// redator. Puro. O fato é "do assunto" se divide ao menos uma raiz de palavra com o pedido, o ângulo ou o título.

import type { Issue } from './design/review';

const STOP = new Set(
  ['para', 'por', 'com', 'sem', 'que', 'uma', 'uns', 'umas', 'mais', 'muito', 'muita', 'nosso', 'nossa', 'nossos', 'nossas', 'seu', 'sua', 'seus', 'suas', 'como', 'quando', 'onde', 'esse', 'essa', 'isso', 'este', 'esta', 'isto', 'ser', 'tem', 'faz', 'fazemos', 'post', 'sobre', 'todo', 'toda', 'todos', 'todas', 'dia', 'dias', 'pelo', 'pela', 'das', 'dos', 'nas', 'nos', 'ele', 'ela', 'ate', 'aos', 'mas', 'ou', 'foi', 'sao', 'uso', 'vez', 'cada'].map((w) => w),
);

function stems(text: string): string[] {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !/^\d+$/.test(w) && !STOP.has(w))
    .map((w) => w.slice(0, 5));
}

export type OffTopicInput = { imageTexts: string[]; facts: string[]; topic: string };

// Uma linha da imagem que repete um fato da base (60% das raízes do fato) sem nenhuma raiz em comum com o assunto.
// Pedido sem assunto suficiente (menos de 3 raízes) não é julgado: não há do que fugir.
export function offTopicFacts(input: OffTopicInput): Issue[] {
  const topic = new Set(stems(input.topic));
  if (topic.size < 3) return [];
  const issues: Issue[] = [];
  for (const fact of input.facts) {
    const f = [...new Set(stems(fact))];
    if (f.length < 2) continue;
    const line = input.imageTexts.find((t) => {
      const ts = new Set(stems(t));
      return f.filter((x) => ts.has(x)).length / f.length >= 0.6;
    });
    if (!line) continue;
    if (f.some((x) => topic.has(x))) continue;
    issues.push({ rule: 'off_topic_fact', detail: fact, message: `A linha "${line}" repete um fato da base que não tem a ver com o assunto do post. Tire essa linha ou troque por algo do assunto.`, where: 'image' });
  }
  return issues;
}

// (2) Data, horário ou valor que a pessoa escreveu no pedido e o post deixou de fora ("12 de novembro" sumiu do convite).
// Só conta número de 2 ou mais dígitos, ou com unidade colada (13h, 30%, 45min): "3 dicas" é quantidade, não dado.
export function requestNumbersMissing(input: { request: string; imageTexts: string[]; caption: string }): Issue[] {
  const wanted = new Set<string>();
  for (const m of input.request.matchAll(/(\d+(?:[.,]\d+)?)\s?(h|hs|min|%)?/gi)) {
    const digits = m[1].replace(/[.,]\d+$/, '');
    if (digits.length >= 2 || m[2]) wanted.add(m[1]);
  }
  const shown = `${input.imageTexts.join(' ')} ${input.caption}`;
  const issues: Issue[] = [];
  for (const n of wanted) {
    if (new RegExp(`(^|[^\\d])${n.replace(/[.,]/g, '[.,]')}([^\\d]|$)`).test(shown)) continue;
    issues.push({ rule: 'request_number_missing', detail: n, message: `O pedido traz "${n}" e o post não: ponha esse número na imagem ou na legenda, do jeito que a pessoa escreveu.`, where: 'image' });
  }
  return issues;
}

// (3) Clichê de vendedor e de IA, por regra: "transformando a espera em um momento de pausa" passou do prompt três vezes.
const CLICHES: RegExp[] = [/\btransform(ar|ando|e|em|ou|amos)\b/i, /\bdescubra\b/i, /\bmergulh(e|ar|em)\b/i, /\bexperi[eê]ncia [uú]nica\b/i, /\bo segredo (é|está)(?![\p{L}])/iu, /\bno mundo de hoje\b/i];

export function clicheIssues(input: { imageTexts: string[]; caption: string }): Issue[] {
  const issues: Issue[] = [];
  for (const [where, text] of [['image', input.imageTexts.join(' \n ')], ['caption', input.caption]] as const) {
    for (const rx of CLICHES) {
      const m = rx.exec(text);
      if (m) issues.push({ rule: 'cliche', detail: m[0].toLowerCase(), message: `"${m[0]}" é clichê de vendedor ou de IA. Diga de outro jeito, mais simples e concreto.`, where });
    }
  }
  return issues;
}
