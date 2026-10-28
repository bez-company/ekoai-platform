// fast.js: caminho rápido do estúdio (spike BEZ-447, SPEC 030). Em vez da cadeia de 9 agentes em série, duas chamadas:
//   1. plano: uma chamada que escolhe o território, escreve o texto e define a direção de arte (JSON único);
//   2. peça: uma chamada que escreve o HTML, enquanto a imagem por IA (se o território pede) é gerada em paralelo.
// Sem crítico, embelezador nem revisor por modelo: o que sobra de controle é o revisor por regra e as medições do render.
// Devolve também o tempo de cada fase, que é o que o spike mede.

import { clicheIssues } from '../../platform/src/lib/off-topic-facts.ts';
import { reviewText } from '../../platform/src/lib/design/review.ts';
import { brandBlock, designer, fontMenuText, TEXT_RULES } from './agents.js';
import { askJson, makeImage, MODELS, newLedger } from './llm.js';
import { renderHtml } from './render.js';
import { pickTerritories, TERRITORY_BY_ID } from './territories.js';

function logosOf(company) {
  const own = company.studio?.logos;
  if (own) return { 'on-light': own.light, 'on-dark': own.dark };
  if (!company.logo) return {};
  return { 'on-light': company.logo.dataUri, 'on-dark': company.logo.dataUri };
}

const planPrompt = ({ company, request, territories, recent, recentTitles }) => `Você é, numa chamada só, o estrategista, o redator e o diretor de arte de um estúdio de posts de Instagram. Recebe um pedido simples e devolve o plano completo da peça, rápido e sem rodeio.

${brandBlock(company)}

PEDIDO: "${request}"

TERRITÓRIOS POSSÍVEIS (escolha UM, o que mais serve ao pedido e à marca com uma ideia memorável):
${territories.map((t) => `- ${t.id}: ${t.brief} (imagem de IA: ${t.image})`).join('\n')}
Territórios usados nos posts recentes da conta (evite): ${recent.join(', ') || 'nenhum'}.
Títulos recentes (não repita nem lembre): ${recentTitles.map((t) => `"${t}"`).join('; ') || 'nenhum'}.

Faça: ache a tensão humana por trás do pedido; escolha o território; escreva o texto da peça; defina a direção de arte.
${TEXT_RULES}
Textos da imagem: headline de 1 a 8 palavras (específico, com tensão); support de até 14 palavras ou null; extras de até 6 textos curtos (até 8 palavras cada) se o território pedir, senão lista vazia. Legenda de 250 a 600 caracteres em texto puro, que abre com gancho e termina com a chamada para ação da marca.
Direção de arte: paleta {bg, ink, accent} (contraste de 4.5:1), tipografia {display, body, accent} só com estas fontes: ${fontMenuText()}; logo {tone: "on-light" ou "on-dark"}; composição em 1 a 2 frases (ponto focal, escala, onde há respiro); até 3 detalhes de acabamento. Imagens de IA: 0 ou 1, só se o território pedir, com prompt em inglês (sujeito, escala, câmera, luz, materiais, paleta, e onde fica o espaço livre para o texto); fotografia editorial com imperfeições reais, sem texto, letras, logos nem rosto reconhecível, sem criança.

Responda só um JSON:
{ "territory": "<id>", "concept": "a ideia visual em 2 frases", "headline": "...", "support": "..." ou null, "extras": ["..."], "caption": "...", "hashtags": ["#..."], "altText": "...", "palette": {"bg":"#hex","ink":"#hex","accent":"#hex"}, "typography": {"display":"...","body":"...","accent":"... ou null"}, "logo": {"tone":"on-light"|"on-dark","place":"..."}, "composition": "...", "details": ["..."], "assets": [ {"id":"hero","role":"...","aspect":"4:5","prompt":"..."} ] }`;

// `model`: 'fast' (Flash) ou 'smart' (Pro). `thinking`: 'minimal' | 'low' | 'medium' para o planejamento e o designer.
export async function makeFastPost({ company, request, ratio = '4:5', seed = 1, recent = [], recentTitles = [], model = 'fast', thinking = 'low', imageModel, parallel = false, onStage = () => {} }) {
  const ledger = newLedger();
  const timing = {};
  const t0 = Date.now();
  const mark = (name) => (timing[name] = (Date.now() - t0) / 1000);
  const llm = model === 'smart' ? MODELS.smart : MODELS.fast;
  const territories = pickTerritories({ count: 4, seed, recent });

  onStage('plano', territories.map((t) => t.id));
  const plan = await askJson({ model: llm, prompt: planPrompt({ company, request, territories, recent, recentTitles }), temperature: 1, thinking, ledger, step: 'plano' });
  mark('plano');
  const territory = TERRITORY_BY_ID[plan.territory] ?? territories[0];
  const copy = { headline: plan.headline, support: plan.support ?? null, extras: Array.isArray(plan.extras) ? plan.extras : [], caption: plan.caption, hashtags: plan.hashtags ?? [], altText: plan.altText };
  const art = { concept: plan.concept, composition: plan.composition, palette: plan.palette, typography: plan.typography, details: plan.details ?? [], logo: plan.logo, assets: plan.assets ?? [] };

  // Sequencial: a imagem sai antes e o designer a vê (melhor composição). Paralelo (`parallel`): o designer escreve o HTML
  // sem ver a imagem, enquanto ela é gerada; o tempo cai para o da fase mais lenta, à custa de composição às cegas.
  const wanted = art.assets.slice(0, 1).filter((a) => a?.prompt);
  const genImages = () =>
    Promise.all(
      wanted.map((a) =>
        makeImage({ model: imageModel || MODELS.image, prompt: `${a.prompt}\n\nEditorial quality, real materials and natural imperfections, no text, no letters, no numbers, no logos, no watermark, no frames.`, aspect: a.aspect ?? '4:5', ledger, step: 'imagem' })
          .then((r) => ({ id: a.id, role: a.role, png: r.png }))
          .catch(() => null),
      ),
    ).then((list) => list.filter(Boolean));
  const design = (images) => designer({ company, request, copy, art, territory, ratio, images, temperature: 0.8, thinking, step: 'designer', model: llm, ledger });
  let images;
  let draft;
  onStage('imagem e designer', { parallel });
  if (parallel) {
    [images, draft] = await Promise.all([genImages().then((r) => (mark('imagem'), r)), design(wanted.map((a) => ({ id: a.id, role: a.role })))]);
    mark('designer');
  } else {
    images = await genImages();
    mark('imagem');
    draft = await design(images);
    mark('designer');
  }
  const rendered = await renderHtml(draft.html, { ratio, assets: Object.fromEntries(images.map((i) => [i.id, i.png])), logos: logosOf(company) });
  mark('render');

  const imageTexts = [copy.headline, copy.support, ...copy.extras, company.handle ? `@${company.handle}` : null].filter(Boolean);
  const textIssues = [
    ...reviewText({ imageTexts, caption: copy.caption, hashtags: copy.hashtags, facts: company.facts, never: company.never, banned: company.profile.bannedWords ?? [], request }),
    ...clicheIssues({ imageTexts, caption: copy.caption }),
  ];
  return { png: rendered.png, html: draft.html, copy, territory: territory.id, layoutIssues: rendered.issues, textIssues: textIssues.map((i) => i.rule), timing, seconds: (Date.now() - t0) / 1000, costUsd: ledger.total, costByStep: ledger.steps };
}
