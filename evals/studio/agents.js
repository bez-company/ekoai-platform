// agents.js: os agentes do estúdio de posts. Cada um tem um papel só, um prompt e um formato de saída:
//   strategist   marketing: lê o pedido simples e propõe rotas criativas, cada uma num território diferente
//   director     diretor criativo (o crítico das ideias): escolhe a rota e a afia
//   copywriter   só o texto: título, apoio, textos da peça, legenda
//   artDirector  conceito visual, paleta, tipografia e briefing das imagens por IA
//   designer     escreve o HTML/CSS da peça (1080 x 1350) com as imagens prontas
//   critic       olha o PNG e dá nota dura por dimensão, com as correções em ordem
//   polisher     embeleza: aplica as correções e o acabamento sem mudar a ideia nem o texto
//   reviewer     portão final: o texto da imagem é o aprovado, sem erro, sem fato inventado, sem defeito de IA
// Português nas instruções e na copy; prompt de imagem em inglês (o modelo responde melhor).

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ask, askJson, MODELS } from './llm.js';
import { FONT_MENU } from './render.js';

// Peças de referência (PNG + nota do que funciona nelas) em .context/studio/exemplars/. Ficam fora do git porque
// vêm de marcas reais; sem a pasta, o designer trabalha sem referência. Servem de régua de acabamento, não de modelo.
const EXEMPLARS_DIR = join(import.meta.dirname, '../../.context/studio/exemplars');
let exemplarCache = null;
export function loadExemplars() {
  if (exemplarCache) return exemplarCache;
  exemplarCache = [];
  if (existsSync(join(EXEMPLARS_DIR, 'notes.json'))) {
    const notes = JSON.parse(readFileSync(join(EXEMPLARS_DIR, 'notes.json'), 'utf8'));
    for (const file of readdirSync(EXEMPLARS_DIR).filter((f) => f.endsWith('.png'))) {
      const name = file.replace('.png', '');
      exemplarCache.push({ name, note: notes[name] ?? '', bytes: readFileSync(join(EXEMPLARS_DIR, file)) });
    }
  }
  return exemplarCache;
}

const WEIGHT_NAMES = { 400: 'regular', 600: 'semibold', 700: 'bold' };
export const fontMenuText = () =>
  Object.entries(FONT_MENU)
    .map(([family, weights]) => `${family} (${weights.sort().map((w) => WEIGHT_NAMES[w] ?? w).join(', ')})`)
    .join('; ');

const scale = (n) => ['muito baixa', 'baixa', 'média', 'alta', 'muito alta'][Math.max(1, Math.min(5, n)) - 1];

// Tudo o que os agentes sabem da empresa, no mesmo bloco para todos.
export function brandBlock(company) {
  const p = company.profile;
  const lines = [
    `Empresa: ${company.name}${company.handle ? ` (@${company.handle})` : ''}`,
    `Nicho: ${p.niche}. Oferta: ${p.offering}. Região: ${p.region}.`,
    `Público: ${p.audience}.`,
    `Dores do público: ${(p.pains ?? []).join('; ') || 'não informadas'}.`,
    `Diferenciais: ${(p.differentiators ?? []).join('; ') || 'não informados'}.`,
    `Voz: ${company.voice}. Formalidade ${scale(p.voiceFormal)}, tecnicidade ${scale(p.voiceTechnical)}, seriedade ${scale(p.voiceSerious)}.`,
    `FATOS (única base para afirmar qualquer coisa concreta: número, prazo, preço, resultado, cliente): ${company.facts.join(' | ')}`,
    `Nunca afirmar: ${company.never.join('; ') || 'nada específico'}.`,
    `Palavras proibidas: ${(p.bannedWords ?? []).join(', ') || 'nenhuma'}.`,
    `Chamada para ação padrão: ${p.ctaDefault === 'whatsapp' ? 'chamar no WhatsApp' : p.ctaDefault === 'dm' ? 'mandar uma DM' : 'link na bio'}.`,
  ];
  const s = company.studio ?? {};
  lines.push(`Cores da marca: principal ${p.colorPrimary}, de destaque ${p.colorAccent}${s.palette ? `. Paleta completa: ${Object.entries(s.palette).map(([k, v]) => `${k} ${v}`).join(', ')}` : ''}.`);
  lines.push(`Fontes da marca: títulos ${p.fontHeading}, texto ${p.fontBody}.`);
  if (s.visualLanguage) lines.push(`Linguagem visual da marca: ${s.visualLanguage}`);
  if (company.logo) {
    const ratio = (company.logo.width / company.logo.height).toFixed(2);
    lines.push(`Logo: ${company.logoLooks ?? 'cadastrado'}. Proporção largura/altura ${ratio}. Use <img src="{{logo:on-light}}"> quando o logo cair sobre fundo claro e <img src="{{logo:on-dark}}"> quando cair sobre fundo escuro ${company.studio?.logos ? '(a versão tem a cor certa para o contraste; o render confere)' : '(existe uma versão só do arquivo: ponha o logo onde ele tenha contraste com o que está atrás)'}.`);
  } else {
    lines.push('Logo: a conta não tem. Assine com o nome da empresa em texto, no corpo da fonte da marca.');
  }
  return lines.join('\n');
}

const TEXT_RULES = `Regras de texto (valem para tudo o que for escrito):
- Português do Brasil com acentuação correta. Sentence case (só a inicial maiúscula e nomes próprios), nunca Title Case.
- Frase curta e concreta. Sem clichê de marketing (soluções completas, o melhor da região, transforme seu negócio, venha conferir, você merece), sem promessa de resultado, sem "garantia", sem exclamação em série, sem emoji na imagem.
- Sem travessão nem meia-risca como pontuação (use vírgula, ponto ou dois-pontos).
- Número, prazo, preço, nome e resultado só se estiverem nos FATOS ou no pedido. Na dúvida, não afirme.
- Dado de exemplo em mockup (nome, nota, valor, contagem) não pode parecer fato da empresa: sem número, sem nome de pessoa; use rótulos e palavras ("Atleta", "Excelente"), nunca "2 gols" ou "J. S.".`;

// ───────────────────────── marketing ─────────────────────────
export async function strategist({ company, request, territories, model = MODELS.smart, ledger }) {
  const list = territories.map((t, i) => `${i + 1}. ${t.id}: ${t.brief}`).join('\n');
  const prompt = `Você é o estrategista de marketing de uma agência de social media. Recebe um pedido simples de um cliente e transforma em ideias que parem o dedo de quem rola o feed do Instagram.

${brandBlock(company)}

PEDIDO DO CLIENTE (palavra por palavra): "${request}"

Faça isto:
1. Leia o pedido: o que a pessoa realmente quer comunicar e para quem.
2. Ache a tensão humana por trás dele (o desejo, o medo, o hábito ou a contradição que faz alguém se reconhecer). Um bom post nasce de uma tensão, não de uma descrição.
3. Proponha UMA rota criativa para cada território abaixo. Cada rota é uma ideia diferente, não a mesma ideia vestida de formas diferentes: o conceito, o gancho (a frase ou a imagem que para o scroll) e por que funciona para este público.

TERRITÓRIOS:
${list}

${TEXT_RULES}

Responda só um JSON:
{
 "read": "o que o cliente quer, em uma frase",
 "objective": "educar | gerar desejo | provar autoridade | engajar | converter | acolher | convidar",
 "insight": "a tensão humana, em uma frase",
 "routes": [
  { "territory": "<id do território>", "bigIdea": "a ideia em 1 a 2 frases", "hook": "o gancho, na voz da marca", "visual": "o que se vê, em 1 frase", "why": "por que funciona", "fit": 1 a 5 (quanto este território serve a este pedido) }
 ]
}`;
  return askJson({ model, prompt, temperature: 1, ledger, step: 'marketing' });
}

// ───────────────────────── diretor criativo ─────────────────────────
export async function director({ request, strategy, recent, recentTitles = [], company, model = MODELS.smart, ledger }) {
  const routes = strategy.routes.map((r, i) => `${i + 1}. [${r.territory}] ${r.bigIdea}\n   gancho: ${r.hook}\n   visual: ${r.visual}`).join('\n');
  const prompt = `Você é o diretor criativo, o crítico mais exigente da agência. Odeia post genérico: o formato "etiqueta + título + subtítulo + logo + foto de fundo" que toda ferramenta de IA entrega. Escolhe a rota mais corajosa que ainda serve ao pedido e à marca.

Empresa: ${company.name} (${company.profile.niche}), voz ${company.voice}.
Pedido: "${request}"
Tensão: ${strategy.insight}

Rotas:
${routes}

Territórios já usados nos posts recentes desta conta (evite repetir o mesmo jeito): ${recent.length ? recent.join(', ') : 'nenhum'}.
Títulos recentes da conta (reprove a rota cujo gancho repita ou lembre algum deles): ${recentTitles.length ? recentTitles.map((t) => `"${t}"`).join('; ') : 'nenhum'}.

Critérios, em ordem: (1) serve ao pedido e à marca sem inventar nada; (2) uma ideia que alguém comentaria ou salvaria; (3) variedade em relação aos posts recentes; (4) viável em uma peça só de 1080 x 1350.
Escolha UMA e afie: diga o que torna a execução memorável e o que evitar para não cair no genérico.

Responda só um JSON: { "choice": <número da rota>, "why": "1 frase", "sharpen": "instruções de execução em 2 a 3 frases", "avoid": ["armadilhas específicas desta rota"] }`;
  const out = await askJson({ model, prompt, temperature: 0.4, ledger, step: 'diretor' });
  const index = Math.max(1, Math.min(strategy.routes.length, Number(out.choice) || 1)) - 1;
  return { index, route: strategy.routes[index], why: out.why, sharpen: out.sharpen, avoid: out.avoid ?? [] };
}

// ───────────────────────── redator ─────────────────────────
export async function copywriter({ company, request, route, sharpen, territory, feedback = [], previous = null, recentTitles = [], model = MODELS.smart, ledger }) {
  const fix = feedback.length
    ? `\nO REVISOR REPROVOU A VERSÃO ANTERIOR. Corrija só o que ele apontou e mantenha o resto:\n${feedback.map((f) => `- ${f.message}`).join('\n')}\nVersão anterior: ${JSON.stringify(previous)}\n`
    : '';
  const prompt = `Você é o redator da agência: só escreve, nunca desenha. Escreve como a marca fala e corta toda palavra que não trabalha. O texto da imagem é o que a pessoa lê em dois segundos; a legenda é onde mora o resto.

${brandBlock(company)}

PEDIDO: "${request}"
ROTA ESCOLHIDA (${route.territory}): ${route.bigIdea}
Gancho de partida: ${route.hook}
Direção do diretor criativo: ${sharpen}

O território pede este tipo de peça (escreva textos que caibam nele): ${territory.brief}
${recentTitles.length ? `\nTítulos recentes desta conta (NÃO repita nem escreva algo parecido; mude o ângulo e as palavras): ${recentTitles.map((t) => `"${t}"`).join('; ')}\n` : ''}
Escreva:
- headline: o texto principal da imagem. De 1 a 8 palavras. Específico e com tensão; nunca um rótulo ("Sobre nós", "Dicas") nem slogan vazio. Pense em 5 opções diferentes de ângulo, escolha a mais forte e devolva as 5 em "options".
- support: uma frase de apoio de até 14 palavras, ou null se a peça ficar mais forte sem ela (menos texto é melhor).
- extras: textos curtos que o território exige (passos, itens, anotações à mão, rótulos, um número com a legenda dele), cada um com até 8 palavras, no máximo 6. Lista vazia se o território não pedir.
- caption: a legenda do Instagram, texto puro (sem markdown), de 250 a 600 caracteres, que abre com um gancho, desenvolve com valor real e termina com a chamada para ação padrão da marca.
- hashtags: 5, minúsculas, sem acento, específicas do assunto.
- altText: descrição da imagem para acessibilidade, em uma frase.

${TEXT_RULES}
${fix}
Responda só um JSON: { "options": ["..."], "headline": "...", "support": "..." ou null, "extras": ["..."], "caption": "...", "hashtags": ["#..."], "altText": "..." }`;
  return askJson({ model, prompt, temperature: 0.9, ledger, step: 'redator' });
}

// ───────────────────────── direção de arte ─────────────────────────
export async function artDirector({ company, request, route, sharpen, avoid, territory, copy, ratio, ledger }) {
  const prompt = `Você é o diretor de arte. Traduz a ideia em uma peça visual de agência de verdade e escreve o briefing das imagens que a IA vai gerar. Não escreve HTML: define o conceito, a composição, a paleta, a tipografia e as imagens.

${brandBlock(company)}

PEDIDO: "${request}"
ROTA (${route.territory}): ${route.bigIdea}
Visual da rota: ${route.visual}
Direção do diretor criativo: ${sharpen}. Evitar: ${avoid.join('; ') || 'o genérico'}.
TERRITÓRIO: ${territory.brief}
Uso de imagem de IA neste território: ${territory.image} (none = sem imagem de IA, a peça é desenhada em código; hero = imagem de IA em escala grande; optional = só se melhorar; cutout = objeto sobre fundo liso para recortar).

TEXTOS APROVADOS (a imagem só pode conter estes, mais o @ e a assinatura da marca):
- headline: ${copy.headline}
- support: ${copy.support ?? '(nenhum)'}
- extras: ${JSON.stringify(copy.extras ?? [])}

Formato: ${ratio === '1:1' ? '1080 x 1080' : '1080 x 1350 (retrato 4:5)'}. Fontes que existem (use só estas): ${fontMenuText()}.

Defina:
- concept: a ideia visual em 2 frases, o que torna esta peça diferente das outras do feed.
- composition: onde fica o ponto focal, como o olho percorre a peça, a grade, a escala relativa dos elementos (ex.: "título ocupa 55% da altura, canto inferior esquerdo, 3x maior que o apoio"), e onde há respiro.
- palette: { "bg": "#hex", "ink": "#hex", "accent": "#hex", "extra": "#hex ou null" } usando as cores da marca como base; contraste texto/fundo de pelo menos 4.5:1.
- typography: { "display": "família", "body": "família", "accent": "família ou null", "treatment": "pesos, caixa, entrelinha, espaçamento" }. Tracking apertado e entrelinha 0.9 a 1.05 em títulos grandes.
- details: 3 a 5 detalhes de acabamento que dão a sensação de peça feita à mão (grão, sombra de papel, fita, linha fina, marca de registro, sublinhado desenhado, textura).
- logo: { "tone": "on-light" (o logo cai sobre fundo claro) ou "on-dark" (cai sobre fundo escuro), "place": "onde e em que tamanho" }.
- assets: lista de 0 a 2 imagens de IA, conforme o território. Cada uma: { "id": "hero", "role": "para que serve na peça", "aspect": "4:5" | "1:1" | "16:9" | "9:16", "prompt": "prompt em inglês" }.
  O prompt de imagem é o que decide se a peça é surreal ou banal: descreva sujeito, ação, escala, câmera e lente, luz, materiais, paleta, atmosfera e ONDE fica o espaço livre para o texto. Prefira fotografia editorial com imperfeições reais (textura, poeira, grão) a ilustração polida de banco de imagem. Escreva um conceito específico e inesperado, não um clichê visual (nada de apertos de mão, lâmpadas, foguetes, setas de crescimento, pessoas apontando para telas). Sem texto, letras, números, logos nem marca d'água na imagem. Sem rostos de crianças.

Responda só um JSON: { "concept": "...", "composition": "...", "palette": {...}, "typography": {...}, "details": ["..."], "logo": {...}, "assets": [...] }`;
  return askJson({ model: MODELS.smart, prompt, temperature: 0.9, ledger, step: 'arte' });
}

// ───────────────────────── designer ─────────────────────────
const HTML_RULES = (ratio) => `Regras do HTML (a peça é renderizada num Chrome e vira PNG, sem JavaScript):
- Um documento completo. <body style="margin:0;width:1080px;height:${ratio === '1:1' ? 1080 : 1350}px;position:relative;overflow:hidden">. Unidades em px. CSS inline em <style>. SVG inline, filtros, máscaras, gradientes, blend modes e transforms são bem-vindos.
- Fontes: só as da lista, com os pesos que existem (peso que não existe vira negrito falso, feio). Sem itálico (não há arquivo). Declare font-family pelo nome exato.
- Imagens: <img src="{{asset:ID}}"> para as imagens geradas e <img src="{{logo:on-light}}"> (logo sobre fundo claro) ou <img src="{{logo:on-dark}}"> (logo sobre fundo escuro) para o logo. Escolha pela cor do que está ATRÁS do logo; o render mede e reprova versão errada. Nenhuma outra imagem nem URL externa.
- TEXTO: use somente os textos aprovados, palavra por palavra (pode quebrar linha, trocar caixa e aplicar cor em uma palavra). Não invente rótulo, número, nome, marca, URL nem frase. Pode repetir o @ da marca e a assinatura.
- Legibilidade no celular: nenhum texto abaixo de 26px; título principal com pelo menos 72px; contraste de 4.5:1 sobre o que estiver por baixo (use véu, cor chapada ou área calma da imagem).
- Margem de segurança de 64px em todas as bordas para texto e logo. Só fundos, imagens e formas decorativas podem sangrar; se um texto grande sangra de propósito, ponha data-bleed no elemento.
- O logo aparece pequeno mas legível, bem assentado (altura de 56 a 96px, largura mínima de 140px), nunca esticado, nunca recolorido, sem caixa branca em volta. Se a conta tem logo, ele aparece uma vez.
- Setas, círculos e anotações à mão nunca cruzam nem tocam texto: deixe 24px de folga e desenhe a seta contornando.
- Nada de JavaScript, <link>, @import, animações.`;

const DESIGN_CRAFT = `O que separa peça de agência de peça de template:
- Um ponto focal só. Contraste de escala forte: o elemento principal é de 3 a 6 vezes maior que o de apoio.
- Hierarquia de no máximo dois níveis de texto, mais um acento (anotação à mão, número, etiqueta).
- Respiro generoso. Alinhamento a uma grade real (margens iguais, bordas esquerdas coincidentes). Nada centralizado por preguiça.
- Tipografia como imagem: tracking apertado e entrelinha 0.9 a 1.05 nos títulos grandes, quebras de linha com intenção (nunca uma palavra órfã), uma palavra em destaque no máximo.
- Cor com proporção desigual (60% base, 30% apoio, 10% destaque), tirada da paleta da marca. Sem gradiente genérico roxo-azul, sem blobs, sem vidro fosco.
- Profundidade e acabamento: sombras suaves e coerentes com uma luz só, grão sutil (SVG feTurbulence com baixa opacidade), linhas finas, sobreposição de camadas, pequenos detalhes impressos. Detalhe serve à ideia; decoração gratuita é defeito.
- A peça inteira precisa funcionar em 3 segundos num celular, como miniatura.
- Evite: etiqueta em pílula + título + subtítulo + logo + foto de fundo (a fórmula que estamos abandonando), ícones de banco de imagem, emoji, texto com sombra, bordas arredondadas em tudo, cartões idênticos repetidos.`;

function parseHtmlReply(text) {
  const notes = /===NOTES===([\s\S]*?)(?====REGEN===|===HTML===)/.exec(text)?.[1]?.trim() ?? '';
  const regenRaw = /===REGEN===([\s\S]*?)===HTML===/.exec(text)?.[1]?.trim() ?? '';
  const htmlRaw = /===HTML===([\s\S]*)$/.exec(text)?.[1] ?? text;
  const html = htmlRaw.replace(/^\s*```(?:html)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  let regen = [];
  if (regenRaw) {
    try {
      const parsed = JSON.parse(regenRaw.replace(/```json\n?|```/g, '').trim());
      regen = Array.isArray(parsed) ? parsed : [];
    } catch {
      regen = [];
    }
  }
  if (!/<html[\s>]/i.test(html) && !/<body[\s>]/i.test(html)) throw new Error('O designer não devolveu um documento HTML.');
  return { notes, regen, html };
}

export async function designer({ company, request, copy, art, territory, ratio, images, feedback = null, temperature = 0.9, thinking = 'medium', step = 'designer', ledger }) {
  const refs = loadExemplars();
  const prompt = `Você é o designer da agência. Implementa a direção de arte em HTML/CSS com acabamento de estúdio. Você enxerga as imagens geradas (anexadas) e compõe em volta delas.

${brandBlock(company)}

PEDIDO: "${request}"
TERRITÓRIO: ${territory.brief}

DIREÇÃO DE ARTE
- Conceito: ${art.concept}
- Composição: ${art.composition}
- Paleta: ${JSON.stringify(art.palette)}
- Tipografia: ${JSON.stringify(art.typography)}
- Acabamento: ${(art.details ?? []).join('; ')}
- Logo: ${JSON.stringify(art.logo)}
- Imagens prontas (ids para usar em {{asset:ID}}): ${images.length ? images.map((i) => `${i.id} (${i.role})`).join('; ') : 'nenhuma, a peça é desenhada em código'}

TEXTOS APROVADOS
- headline: ${copy.headline}
- support: ${copy.support ?? '(nenhum)'}
- extras: ${JSON.stringify(copy.extras ?? [])}
- assinatura: ${company.handle ? `@${company.handle}` : company.name}

${HTML_RULES(ratio)}

${DESIGN_CRAFT}
${refs.length ? `\nREFERÊNCIAS DE NÍVEL (anexadas depois das imagens geradas): peças de outras marcas que o cliente aprovou com nota máxima. Use como régua de acabamento: escala, respiro, tipografia, ritmo. NÃO copie layout, texto, marca nem elementos; a sua peça é de outra marca e de outra ideia.\n${refs.map((r) => `- ${r.name}: ${r.note}`).join('\n')}\n` : ''}${feedback ? `\nCORREÇÕES OBRIGATÓRIAS (a versão anterior falhou nisto; o HTML anterior está abaixo, parta dele):\n${feedback}\n` : ''}
Formato da resposta (sem mais nada):
===NOTES===
2 a 4 linhas: a decisão de design mais importante e o que você fez para a peça não parecer template.
===HTML===
<!doctype html>...`;
  const inputs = [...images.map((i) => ({ bytes: i.png, label: `Imagem gerada "${i.id}":` })), ...refs.map((r) => ({ bytes: r.bytes, label: `Referência de nível "${r.name}":` }))];
  const { text } = await ask({ model: MODELS.smart, prompt, images: inputs, temperature, thinking, ledger, step });
  return parseHtmlReply(text);
}

// ───────────────────────── crítico ─────────────────────────
export const DIMENSIONS = {
  conceito: 'a ideia visual é clara, específica e tem um gancho (uma peça que alguém comentaria)',
  hierarquia: 'o olho sabe onde começar e para onde ir; um ponto focal; contraste de escala',
  tipografia: 'escolha, escala, entrelinha, tracking, quebras de linha, alinhamento',
  composicao: 'grade, respiro, equilíbrio, uso do quadro inteiro, nada espremido nem flutuando sem razão',
  acabamento: 'profundidade, luz, textura, detalhes, nitidez; parece feito por um designer, não montado por um script',
  originalidade: 'foge do template de IA (etiqueta + título + subtítulo + logo + foto de fundo) e do clichê visual',
  marca: 'cores, fontes, voz e logo da marca; reconhecível como desta empresa',
  legibilidade: 'lê-se em 3 segundos na miniatura do celular; contraste e corpo suficientes',
  texto: 'o texto da imagem é específico, curto, natural em português, sem clichê',
};

export async function critic({ company, request, copy, territory, png, audit, round, previous = null, ledger }) {
  const prompt = `Você é o crítico da agência: o diretor de arte mais duro que existe. Seu trabalho é impedir que post medíocre chegue ao cliente. Não elogie por cortesia; cada nota precisa ser defensável olhando a imagem.

Marca: ${company.name} (${company.profile.niche}), cores ${company.profile.colorPrimary} e ${company.profile.colorAccent}, voz ${company.voice}.
Pedido do cliente: "${request}"
Território criativo da peça: ${territory.name}
Textos aprovados: headline "${copy.headline}"${copy.support ? `; apoio "${copy.support}"` : ''}${copy.extras?.length ? `; extras ${JSON.stringify(copy.extras)}` : ''}
Medições do render (alertas objetivos): ${audit.length ? audit.map((a) => `${a.rule}: ${a.detail}`).join(' | ') : 'nenhum'}
Esta é a rodada ${round} de crítica.${previous ? `
A peça anterior (segunda imagem) foi corrigida a partir destas correções: ${previous.fixes.map((f) => f.fix).join(' | ')}. Se a nova versão piorou em algo (colisão, corte, perda de força, excesso de efeito), diga em "regressao" e dê notas honestas: polir demais também estraga.` : ''}

Escala (seja severo e use a faixa toda):
- 3 = o post padrão de ferramenta de IA: etiqueta, título, subtítulo, logo, @ e foto de fundo.
- 5 = limpo e correto, mas anônimo: serviria para qualquer empresa.
- 7 = bom trabalho profissional, com uma ideia clara e acabamento sólido.
- 8 = o tipo de peça que uma boa agência apresentaria ao cliente sem corar.
- 9 a 10 = referência: premiável, memorável, com execução impecável.

Dê nota de 0 a 10 para cada dimensão:
${Object.entries(DIMENSIONS).map(([k, v]) => `- ${k}: ${v}`).join('\n')}

Depois:
- slop: lista dos sinais de "feito por IA genérica" que você vê (composição centralizada por padrão, pílula de etiqueta, ícone de banco de imagem, gradiente, sombra de texto, texto pequeno demais, mão ou rosto deformado, texto ilegível na imagem etc.). Vazia se não houver.
- fixes: no máximo 5 correções, da mais importante para a menos, cada uma concreta e executável no HTML/CSS ("o título tem 96px; suba para 200px e recorte em 3 linhas", não "melhorar a hierarquia"). Cada uma com "severity": "alta" | "media" | "baixa" e, se o problema for a imagem gerada (não o layout), "target": "asset" com o id e o que mudar no prompt.
- verdict: "ship" (pode ir ao cliente), "revise" (conserto de layout e acabamento resolve) ou "restart" (a ideia ou a imagem não se salva).

Responda só um JSON: { "scores": { "conceito": n, ... }, "slop": ["..."], "regressao": "o que piorou em relação à anterior, ou null", "fixes": [ { "severity": "...", "fix": "...", "target": "layout" | "asset", "assetId": "..." } ], "verdict": "...", "summary": "2 frases honestas" }`;
  const images = [{ bytes: png, label: 'A peça (1080 de largura):' }, ...(previous ? [{ bytes: previous.png, label: 'A versão anterior:' }] : [])];
  return askJson({ model: MODELS.smart, prompt, images, temperature: 0.2, thinking: 'low', ledger, step: 'critico' });
}

// Nota única: a média das dimensões, com o conceito e a originalidade valendo o dobro (é onde o post padrão perde).
export function totalScore(scores) {
  const weight = { conceito: 2, originalidade: 2 };
  let sum = 0;
  let w = 0;
  for (const key of Object.keys(DIMENSIONS)) {
    const v = Number(scores?.[key]);
    if (!Number.isFinite(v)) continue;
    sum += v * (weight[key] ?? 1);
    w += weight[key] ?? 1;
  }
  return w ? Math.round((sum / w) * 10) / 10 : 0;
}

// ───────────────────────── embelezador ─────────────────────────
export async function polisher({ company, copy, art, ratio, html, png, fixes, audit = [], images, ledger }) {
  const prompt = `Você é o artista de acabamento da agência. Recebe uma peça pronta e a crítica do diretor de arte, e a deixa melhor sem mudar a ideia nem o texto. Você enxerga a peça renderizada (primeira imagem) e as imagens de origem.

${brandBlock(company)}

Conceito a preservar: ${art.concept}
Textos aprovados (não mude nenhuma palavra): headline "${copy.headline}"; apoio ${copy.support ? `"${copy.support}"` : 'nenhum'}; extras ${JSON.stringify(copy.extras ?? [])}.

CORREÇÕES DO CRÍTICO (aplique todas, a primeira é a mais importante):
${fixes.map((f, i) => `${i + 1}. [${f.severity}] ${f.fix}`).join('\n') || 'nenhuma específica: eleve o acabamento geral.'}

Medições do render atual (conserte se houver): ${audit.length ? audit.map((a) => `${a.rule}: ${a.detail}`).join(' | ') : 'nenhum alerta'}.

Método: cirúrgico. Altere SÓ o que as correções e as medições pedem; todo o resto do HTML fica idêntico, caractere por caractere. Não troque a fonte, a paleta nem a composição. Cada correção vira um ajuste pequeno e verificável (um valor de entrelinha, uma cor, uma posição). Depois delas, no máximo um acabamento sutil (grão, sombra de papel, linha fina) se servir à ideia. Efeito demais (sombra em texto, brilho, sobreposição de letras) estraga: se algo está bom, deixe quieto. Polir não é reescrever.
Se uma imagem gerada é o problema (e só nesse caso), peça uma nova em REGEN com o id e um prompt em inglês melhorado; senão REGEN fica [].

${HTML_RULES(ratio)}

HTML atual:
${html}

Formato da resposta (sem mais nada):
===NOTES===
o que mudou, em 2 a 3 linhas.
===REGEN===
[] ou [{"id":"hero","prompt":"..."}]
===HTML===
<!doctype html>...`;
  const imgs = [{ bytes: png, label: 'Peça renderizada agora:' }, ...images.map((i) => ({ bytes: i.png, label: `Imagem de origem "${i.id}":` }))];
  const { text } = await ask({ model: MODELS.smart, prompt, images: imgs, temperature: 0.5, thinking: 'low', ledger, step: 'embelezador' });
  return parseHtmlReply(text);
}

// ───────────────────────── revisor (portão final) ─────────────────────────
export async function reviewer({ company, copy, png, model = MODELS.smart, ledger }) {
  const prompt = `Você é o revisor final: lê a peça como um leitor cético, palavra por palavra, antes de ela ir ao cliente. Compare a imagem com o que foi aprovado.

Textos aprovados para a imagem: headline "${copy.headline}"; apoio ${copy.support ? `"${copy.support}"` : 'nenhum'}; extras ${JSON.stringify(copy.extras ?? [])}; assinatura ${company.handle ? `@${company.handle}` : company.name}.
Fatos da empresa: ${company.facts.join(' | ')}

Confira:
1. text_drift: algum texto da imagem é diferente do aprovado (palavra trocada, faltando, acento errado, letra cortada) ou existe texto que não foi aprovado (rótulo, número, nome, URL inventados)? Liste cada um.
2. ai_artifact: a imagem tem defeito de geração de IA (mão ou dedo deformado, rosto torto, texto ilegível ou inventado dentro da foto, objeto derretido, logo falso)?
3. logo: o logo aparece correto (não distorcido, não recolorido, não duplicado)? Se a conta não tem logo, a assinatura é só o nome em texto.
4. legibilidade: algum texto está cortado, colado na borda, ilegível por contraste ou pequeno demais para o celular?
5. fato: a peça afirma algo concreto (número, prazo, resultado) que não está nos fatos?

Responda só um JSON: { "ok": true | false, "issues": [ { "rule": "text_drift" | "ai_artifact" | "logo" | "legibilidade" | "fato", "detail": "o que viu", "fix": "como corrigir no HTML" } ] }
Seja objetivo: só reprove por defeito que um cliente notaria.`;
  return askJson({ model, prompt, images: [{ bytes: png, label: 'A peça:' }], temperature: 0, thinking: 'low', ledger, step: 'revisor' });
}
