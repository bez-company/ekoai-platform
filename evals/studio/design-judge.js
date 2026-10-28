// design-judge.js: o juiz de design do eval do estúdio. É independente do crítico do pipeline (outra chamada, sem
// ver o histórico da peça) e mede o que o eval antigo não media: a qualidade do design em si. Dois modos:
//   score(png)      nota absoluta de 0 a 10 por dimensão, para uma peça
//   pairwise(a, b)  qual de duas peças do mesmo pedido é melhor, com a ordem sorteada para não viciar
//   distinct(pngs)  quão diferentes são entre si várias peças do mesmo pedido (variação)
// O juiz é um modelo: erra. Serve para a tendência; a decisão final é o olho de quem vai postar.

import { askJson, MODELS } from './llm.js';
import { DIMENSIONS } from './agents.js';

const JUDGE_MODEL = process.env.STUDIO_JUDGE_MODEL || MODELS.smart;

const SCALE = `Escala (use a faixa toda e seja severo):
- 3 = o post padrão de ferramenta de IA: etiqueta, título, subtítulo, logo, @ e foto de fundo.
- 5 = limpo e correto, mas anônimo: serviria para qualquer empresa.
- 7 = bom trabalho profissional, com ideia clara e acabamento sólido.
- 8 = uma boa agência apresentaria ao cliente sem corar.
- 9 a 10 = referência premiável.`;

function context({ company, request, caption }) {
  return `Marca: ${company.name} (${company.profile.niche}). Voz: ${company.voice}. Cores ${company.profile.colorPrimary} e ${company.profile.colorAccent}.
Fatos permitidos: ${company.facts.join(' | ')}
Pedido do cliente: "${request}"
${caption ? `Legenda que acompanha a peça: """${caption}"""` : ''}`;
}

export async function score({ company, request, caption, png, ledger }) {
  const prompt = `Você é jurado de design de social media. Vê uma peça de Instagram (1080 de largura) sem saber quem a fez e a avalia com rigor.

${context({ company, request, caption })}

${SCALE}

Dê nota de 0 a 10 para:
${Object.entries(DIMENSIONS).map(([k, v]) => `- ${k}: ${v}`).join('\n')}
- pedido: a peça cumpre o que o cliente pediu e fala do assunto certo
- legenda: a legenda é boa (gancho, valor, voz da marca, chamada para ação) e coerente com a imagem

E responda também:
- fatos_ok: true se a peça e a legenda NÃO afirmam número, prazo, preço, resultado ou nome fora dos fatos permitidos e do pedido; false se inventam.
- defeitos: lista curta de defeitos objetivos (texto cortado, ilegível, mão deformada, logo errado, erro de português, texto repetido...). Vazia se não houver.
- postaria: true se o dono da empresa postaria isto hoje sem editar nada.
- comentario: 2 frases honestas sobre o que a peça tem de melhor e de pior.

Responda só um JSON: { "scores": { "conceito": n, "hierarquia": n, "tipografia": n, "composicao": n, "acabamento": n, "originalidade": n, "marca": n, "legibilidade": n, "texto": n, "pedido": n, "legenda": n }, "fatos_ok": bool, "defeitos": ["..."], "postaria": bool, "comentario": "..." }`;
  return askJson({ model: JUDGE_MODEL, prompt, images: [{ bytes: png, label: 'A peça:' }], temperature: 0, ledger, step: 'juiz' });
}

// Compara duas peças do mesmo pedido. A ordem é sorteada aqui e desfeita na volta: `winner` é 'a', 'b' ou 'empate'
// no que o chamador passou como a e b.
export async function pairwise({ company, request, a, b, ledger, flip = Math.random() < 0.5 }) {
  const first = flip ? b : a;
  const second = flip ? a : b;
  const prompt = `Você é jurado de design de social media e compara duas peças de Instagram feitas para o mesmo pedido. Não sabe quem fez nenhuma. Escolha a melhor para a marca postar.

${context({ company, request, caption: null })}

${SCALE}

Compare em: ${Object.keys(DIMENSIONS).join(', ')}. Para cada dimensão diga qual venceu ("1", "2" ou "empate"). Depois dê o vencedor geral considerando o conjunto, com peso maior em conceito, originalidade e acabamento, e a razão em 2 frases.

Responda só um JSON: { "dimensions": { "conceito": "1|2|empate", ... }, "winner": "1" | "2" | "empate", "reason": "..." }`;
  const out = await askJson({
    model: JUDGE_MODEL,
    prompt,
    images: [{ bytes: first.png, label: 'Peça 1:' }, { bytes: second.png, label: 'Peça 2:' }],
    temperature: 0,
    ledger,
    step: 'juiz',
  });
  const back = (v) => (v === 'empate' ? 'empate' : (v === '1') === !flip ? 'a' : 'b');
  return { winner: back(String(out.winner)), dimensions: Object.fromEntries(Object.entries(out.dimensions ?? {}).map(([k, v]) => [k, back(String(v))])), reason: out.reason };
}

export async function distinct({ company, request, pngs, ledger }) {
  const prompt = `Você é diretor de arte e recebe ${pngs.length} peças de Instagram feitas pela mesma ferramenta para o MESMO pedido, em tentativas separadas. O cliente quer variedade: que cada tentativa traga um conceito e um layout realmente diferentes, não a mesma peça com cores trocadas.

${context({ company, request, caption: null })}

Dê:
- variedade: nota de 0 a 10 (0 = todas iguais; 5 = mesmo esqueleto com variações; 10 = ideias e composições claramente diferentes, mantendo a marca reconhecível).
- repetidas: pares de peças que parecem a mesma, como ["1 e 3"], ou lista vazia.
- reconhecivel: nota de 0 a 10 de quanto todas ainda parecem da mesma marca.
- comentario: 2 frases.

Responda só um JSON: { "variedade": n, "repetidas": ["..."], "reconhecivel": n, "comentario": "..." }`;
  return askJson({ model: JUDGE_MODEL, prompt, images: pngs.map((png, i) => ({ bytes: png, label: `Peça ${i + 1}:` })), temperature: 0, ledger, step: 'juiz' });
}
