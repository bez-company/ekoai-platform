// templater.js: transforma uma peça pronta do estúdio (HTML autoral) em um TEMPLATE com slots, para o caminho rápido
// (spike BEZ-447). O template mantém a composição, o acabamento e o layout; o texto vira {{slot:nome}}, as cores viram
// variáveis CSS e a marca (logo, fontes) vira marcador. Em produção só o preenchimento roda por pedido; o estúdio completo
// (agentes, crítico, embelezador) roda uma vez, aqui, para criar cada template.

import { ask, MODELS } from './llm.js';
import { fontMenuText } from './agents.js';

function parseTemplateReply(text) {
  const metaRaw = /===META===([\s\S]*?)===HTML===/.exec(text)?.[1]?.trim();
  const html = (/===HTML===([\s\S]*)$/.exec(text)?.[1] ?? '').replace(/^\s*```(?:html)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  if (!metaRaw || !/<html[\s>]|<body[\s>]/i.test(html)) throw new Error('O templater não devolveu META e HTML.');
  const meta = JSON.parse(metaRaw.replace(/```json\n?|```/g, '').trim());
  return { meta, html };
}

export async function makeTemplate({ html, texts, territory, ledger }) {
  const prompt = `Você transforma uma peça de Instagram pronta (HTML) em um TEMPLATE reutilizável com slots, mantendo a composição e o acabamento idênticos. O template será usado por outras marcas e outros assuntos, então não pode carregar conteúdo da peça original.

Textos visíveis da peça original (na ordem em que aparecem): ${JSON.stringify(texts)}
Território criativo: ${territory}

Faça:
1. Troque cada texto visível por um marcador {{slot:nome}}: headline (o texto principal), support (apoio), extra1, extra2... (os demais, em ordem). O @ da conta vira {{handle}}. Todo texto precisa virar slot; nada de frase fixa, número, nome ou marca no HTML. Dado de exemplo dentro de mockup (nome, nota, valor) também vira slot.
2. Cores: declare em :root as variáveis --bg, --ink, --accent e --muted (use os valores originais) e use var(--bg) etc. em TODO o CSS no lugar das cores da peça. Fontes: --display e --body (e --hand só se houver letra manuscrita) com os nomes originais, e use var(--display) etc. Fontes que existem: ${fontMenuText()}.
3. Logo continua {{logo:on-light}} ou {{logo:on-dark}}; imagem de IA continua {{asset:hero}} (ou o id que já existe). Se a peça usa imagem de IA, descreva em imageSlot o que a imagem precisa mostrar e ONDE fica o espaço livre para o texto; senão imageSlot é null.
4. Cada elemento com um slot de texto ganha data-fit="nome" e fica dentro de uma caixa de tamanho FIXO (width e height em px, overflow hidden) para que o texto se ajuste sozinho ao tamanho dos novos textos. Limites de caracteres em slots (max): estime pelo tamanho da caixa e do corpo.
5. Não mude composição, tipografia relativa, grade, sombras, texturas nem detalhes. Sem JavaScript.

Formato da resposta (sem mais nada):
===META===
{ "tone": "dark" | "light" (o fundo dominante), "needsImage": true|false, "imageSlot": "..." ou null, "slots": { "headline": { "max": 40 }, "support": { "max": 90 }, ... }, "logoTone": "on-light" | "on-dark" | null, "summary": "o que é esta composição, em 1 frase" }
===HTML===
<!doctype html>...

HTML original:
${html}`;
  const { text } = await ask({ model: MODELS.smart, prompt, temperature: 0.3, thinking: 'low', ledger, step: 'templater' });
  return parseTemplateReply(text);
}

// Segunda passada: o lint achou texto fixo fora dos slots (ou caixa que corta). Pede o conserto e devolve META e HTML.
export async function fixTemplate({ html, meta, leftovers, ledger }) {
  const prompt = `Este template de Instagram com slots ainda tem defeitos. Conserte SEM mudar composição, cores nem acabamento.

Textos fixos que sobraram no HTML e precisam virar slot (ou sair, se forem decoração de conteúdo): ${JSON.stringify(leftovers)}
Regras: todo texto visível é {{slot:nome}} (headline, support, extra1, extra2...) ou {{handle}}; nenhuma frase, rótulo, número ou nome fixo. Elemento de slot com data-fit dentro de caixa de tamanho fixo (overflow hidden). Atualize "slots" no META com os novos slots e limites de caracteres.

META atual: ${JSON.stringify(meta)}

Formato da resposta (sem mais nada):
===META===
{ "tone": "...", "needsImage": ..., "imageSlot": ..., "slots": {...}, "logoTone": ..., "summary": "..." }
===HTML===
<!doctype html>...

HTML atual:
${html}`;
  const { text } = await ask({ model: MODELS.smart, prompt, temperature: 0.2, thinking: 'low', ledger, step: 'templater-fix' });
  return parseTemplateReply(text);
}
