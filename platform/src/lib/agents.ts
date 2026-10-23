// agents.ts: os agentes da geração (SPEC 012, decisão 4), na parte pura: o prompt que vai ao modelo
// e a validação do que volta. Estrategista, redator e diretor de arte saem numa chamada só, em JSON;
// o revisor é por regra (design/review.ts) e devolve o motivo ao modelo, até 2 voltas. Sem I/O.

import type { CompanyProfile } from './company-profile-model';
import type { Issue } from './design/review';
import type { PostKind } from './generation-model';
import type { WriterHints } from './directives-apply';

export type CopyInput = {
  idea: string;
  kind: PostKind | null; // null = o estrategista escolhe
  goal?: string | null; // o objetivo do post em uma frase (SPEC 017 decisão 6)
  profile: CompanyProfile;
  facts: string[];
  never: string[];
  rules: string[]; // regras ativas do Aprendizado
  feedback?: Issue[]; // achados da volta anterior
  previous?: Copy | null; // o texto recusado
  direction?: number; // 1 = a primeira; acima disso, "outra direção" pedida pela pessoa
  campaign?: CopyCampaign | null; // a campanha do pedido (SPEC 018): só o que a pessoa escreveu nela
  directives?: WriterHints | null; // o que a pessoa ditou sobre a imagem (SPEC 020): o código obedece, o redator só escreve o resto
};

// O que a campanha diz ao redator. A oferta vale como afirmada só para este post; as restrições entram como
// "nunca diga". Meta e números de acompanhamento nunca vão ao modelo.
export type CopyCampaign = { name: string; objective: string | null; offering: string | null; audience: string | null; cta: string | null; restrictions: string[] };

export type Copy = {
  kind: PostKind;
  angle: string;
  texts: { kicker?: string; title: string; sub?: string; items?: string[] };
  caption: string;
  hashtags: string[];
  visualPrompt: string | null; // só no post de atmosfera
  altText: string; // texto alternativo do redator (BEZ-203); vazio quando ele não mandou: a geração escolhe a sobra
};

export const LIMITS = { kicker: 32, title: 64, sub: 100, item: 56, items: 4, caption: 2200, hashtags: 30, visualPrompt: 700, angle: 120, altText: 1000 };

function voiceLine(p: CompanyProfile): string {
  const scale = (v: number | null, low: string, high: string) => (v == null ? null : v <= 2 ? low : v >= 4 ? high : `entre ${low} e ${high}`);
  return [scale(p.voiceFormal, 'formal', 'descontraído'), scale(p.voiceTechnical, 'técnico', 'simples'), scale(p.voiceSerious, 'sério', 'bem-humorado')].filter(Boolean).join(', ') || 'direto e simples';
}

const CTA_TEXT: Record<string, string> = { link_bio: 'convide a pessoa ao link da bio', whatsapp: 'convide a pessoa a chamar no WhatsApp', dm: 'convide a pessoa a mandar mensagem direta' };

export function buildCopyPrompt(input: CopyInput): string {
  const p = input.profile;
  const lines: string[] = [];
  lines.push('Você é a equipe de conteúdo de uma pequena empresa brasileira no Instagram: estrategista, redator e diretor de arte. Responda SÓ com um objeto JSON, em português do Brasil, com acentos corretos.');
  lines.push('');
  lines.push('## A empresa');
  lines.push(`- Nicho: ${p.niche}`);
  lines.push(`- O que vende: ${p.offering}`);
  lines.push(`- Para quem: ${p.audience}`);
  if (p.region) lines.push(`- Região: ${p.region}`);
  if (p.differentiators.length) lines.push(`- Diferenciais: ${p.differentiators.join('; ')}`);
  if (p.pains.length) lines.push(`- Dores do público: ${p.pains.join('; ')}`);
  lines.push(`- Jeito de falar: ${voiceLine(p)}`);
  const cta = input.campaign?.cta ?? p.ctaDefault;
  if (cta && CTA_TEXT[cta]) lines.push(`- Chamada padrão: ${CTA_TEXT[cta]}`);
  if (input.campaign) {
    const c = input.campaign;
    lines.push('');
    lines.push(`## A campanha deste post: ${c.name}`);
    if (c.objective) lines.push(`- Resultado que a empresa quer: ${c.objective}`);
    if (c.offering) lines.push(`- O que entra nos posts (vale como afirmado só para esta campanha): ${c.offering}`);
    if (c.audience) lines.push(`- Para quem: ${c.audience}`);
    if (c.restrictions.length) lines.push(`- Nunca diga nesta campanha: ${c.restrictions.join('; ')}`);
    lines.push('- Sirva ao resultado da campanha sem inventar oferta, preço, prazo, desconto nem meta.');
  }
  lines.push('');
  lines.push('## O que a empresa pode afirmar (fatos, com fonte). Número, preço, prazo ou funcionalidade só saem se estiverem aqui ou na ideia do pedido (o que a pessoa escreveu vale).');
  lines.push(input.facts.length ? input.facts.map((f) => `- ${f}`).join('\n') : '- (nenhum fato cadastrado: não use número, preço nem prazo)');
  if (input.never.length) {
    lines.push('');
    lines.push('## O que a empresa NUNCA afirma');
    lines.push(input.never.map((f) => `- ${f}`).join('\n'));
  }
  if (p.bannedWords.length) {
    lines.push('');
    lines.push(`## Palavras proibidas: ${p.bannedWords.join(', ')}`);
  }
  if (input.rules.length) {
    lines.push('');
    lines.push('## Regras aprendidas com esta conta');
    lines.push(input.rules.map((r) => `- ${r}`).join('\n'));
  }
  lines.push('');
  lines.push('## O pedido');
  lines.push(`- Ideia: ${input.idea}`);
  if (input.goal) lines.push(`- Objetivo do post: ${input.goal}`);
  lines.push(input.kind ? `- Tipo do post: ${input.kind}` : '- Tipo do post: escolha entre "informativo" (o texto manda: dica, dado, passo a passo) e "atmosfera" (a imagem manda: bastidor, produto, clima da marca)');
  const dir = input.directives;
  if (dir?.brandCard) lines.push('- A imagem será um cartão de marca liso, sem foto, montado pelo código: tipo "informativo", sem items nem sub, visual_prompt null. Escreva a legenda e um texts.title curto; a pessoa decide o que vai na imagem.');
  if (dir?.exactTexts.length) lines.push(`- A pessoa ditou o texto da imagem: ${dir.exactTexts.map((t) => `"${t}"`).join(', ')}. Ele entra na imagem como está. Devolva essas mesmas frases em texts.title (e sub, items, nessa ordem) e escreva a legenda a partir delas.`);
  else if (dir?.textOnly && !dir.brandCard) lines.push('- A pessoa quer só o essencial na imagem: sem selo, subtítulo nem itens.');
  if (dir?.itemsCount) lines.push(`- items: EXATAMENTE ${dir.itemsCount} itens (a pessoa pediu ${dir.itemsCount}).`);
  if (dir?.avoid.length) lines.push(`- A pessoa pediu para NÃO colocar: ${dir.avoid.join('; ')}. Vale para a imagem e para a legenda.`);
  if ((input.direction ?? 1) > 1) lines.push(`- Direção ${input.direction}: a pessoa pediu OUTRA direção. Escolha um ângulo, um gancho e (no atmosfera) uma cena diferentes das óbvias para este tema; evite repetir a abordagem mais comum.`);
  lines.push('');
  lines.push('## Regras do texto');
  lines.push('- Frase curta, voz ativa, sentence case (só a primeira letra maiúscula). Nada de travessão (— ou –): use vírgula, ponto ou dois-pontos.');
  lines.push('- Nada de "imperdível", "garantido", "melhor da cidade", superlativo vazio, jargão de IA nem clichê de vendedor.');
  lines.push('- Sem emoji no texto da imagem. Na legenda, no máximo 2, e só se combinar com o jeito de falar.');
  lines.push(`- title: até ${LIMITS.title} caracteres, o gancho. kicker: até ${LIMITS.kicker} caracteres, um selo curto (ex.: "Dica da casa"). sub: até ${LIMITS.sub} caracteres, opcional.`);
  lines.push(`- items: de 2 a ${LIMITS.items} itens curtos (até ${LIMITS.item} caracteres cada), só no informativo em lista. Em "atmosfera", sem items e sem sub.`);
  lines.push(`- caption: a legenda, até 900 caracteres, com a chamada no fim. hashtags: de 3 a 8, sem o #, minúsculas, sem acento.`);
  lines.push('- visual_prompt: só em "atmosfera". Em inglês, descreve a foto para um modelo de imagem: cena, luz, materiais, ângulo. SEM texto, letras, logo, marca d\'água, rosto de criança ou pessoa identificável. No informativo, null.');
  lines.push('- angle: uma frase com o ângulo escolhido (para a equipe ver por que).');
  lines.push('- alt_text: o texto alternativo da imagem, para quem usa leitor de tela. Em português, de 1 a 3 frases (até 600 caracteres): o que a imagem mostra e o texto escrito nela. Sem hashtag, sem link, sem chamada para ação e sem "imagem de" no começo.');
  if (input.feedback?.length) {
    lines.push('');
    lines.push('## A versão anterior foi recusada pelo revisor. Corrija SÓ o que está abaixo, copie o resto igual e não acrescente fato, prazo nem número novo:');
    lines.push(input.feedback.map((i) => `- ${i.where === 'image' ? 'Na imagem' : 'Na legenda'}: ${i.message}`).join('\n'));
    if (input.previous) lines.push(`Versão anterior: ${JSON.stringify({ texts: input.previous.texts, caption: input.previous.caption, hashtags: input.previous.hashtags })}`);
  }
  lines.push('');
  lines.push('## Formato da resposta (JSON)');
  lines.push('{"kind":"informativo|atmosfera","angle":"...","texts":{"kicker":"...","title":"...","sub":"...","items":["...","..."]},"caption":"...","hashtags":["..."],"visual_prompt":null,"alt_text":"..."}');
  return lines.join('\n');
}

type Parsed = { ok: true; value: Copy } | { ok: false; error: string };

function str(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().replace(/\s+/g, ' ');
  return s ? s.slice(0, max) : null;
}

// O que volta do modelo, no formato que o resto do motor espera. Corta o que passa do limite em
// vez de recusar: o revisor por regra decide se o texto cabe na imagem.
export function parseCopy(json: unknown, requested: PostKind | null): Parsed {
  const o = json && typeof json === 'object' && !Array.isArray(json) ? (json as Record<string, unknown>) : null;
  if (!o) return { ok: false, error: 'O modelo não devolveu um objeto.' };
  const kind: PostKind = requested ?? (o.kind === 'atmosfera' ? 'atmosfera' : 'informativo');
  const texts = o.texts && typeof o.texts === 'object' ? (o.texts as Record<string, unknown>) : {};
  const title = str(texts.title, LIMITS.title);
  if (!title) return { ok: false, error: 'O modelo não devolveu o título.' };
  const caption = typeof o.caption === 'string' ? o.caption.trim().slice(0, LIMITS.caption) : '';
  if (!caption) return { ok: false, error: 'O modelo não devolveu a legenda.' };
  const hashtags = (Array.isArray(o.hashtags) ? o.hashtags : [])
    .map((h) => String(h).trim().replace(/^#/, '').toLowerCase().replace(/[^\p{L}\p{N}_]/gu, ''))
    .filter((h, i, arr) => h && arr.indexOf(h) === i)
    .slice(0, LIMITS.hashtags);
  const items = kind === 'informativo' && Array.isArray(texts.items) ? texts.items.map((x) => str(x, LIMITS.item)).filter((x): x is string => !!x).slice(0, LIMITS.items) : [];
  const copy: Copy = {
    kind,
    angle: str(o.angle, LIMITS.angle) ?? '',
    texts: {
      title,
      ...(str(texts.kicker, LIMITS.kicker) ? { kicker: str(texts.kicker, LIMITS.kicker)! } : {}),
      ...(kind === 'informativo' && str(texts.sub, LIMITS.sub) ? { sub: str(texts.sub, LIMITS.sub)! } : {}),
      ...(items.length >= 2 ? { items } : {}),
    },
    caption,
    hashtags,
    visualPrompt: kind === 'atmosfera' ? str(o.visual_prompt, LIMITS.visualPrompt) : null,
    altText: '',
  };
  copy.altText = cleanAltText(o.alt_text) ?? '';
  if (kind === 'atmosfera' && !copy.visualPrompt) return { ok: false, error: 'O modelo não descreveu o visual do post de atmosfera.' };
  return { ok: true, value: copy };
}

// Texto alternativo (BEZ-203): o que o Instagram lê para quem usa leitor de tela. O que vem do modelo é
// limpo (sem hashtag, link nem travessão) e cortado em 1000 caracteres, o teto da API; sem nada
// aproveitável, sai do texto que está na imagem.
export function cleanAltText(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const text = raw
    .replace(/https?:\/\/\S+/g, '')
    .replace(/#[\p{L}\p{N}_]+/gu, '')
    .replace(/\s*[\u2013\u2014]\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .trim();
  if (text.length < 3) return null;
  if (text.length <= LIMITS.altText) return text;
  const cut = text.slice(0, LIMITS.altText);
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), LIMITS.altText - 40)).replace(/[,;:]$/, '').trim();
}

export function altTextFromTexts(texts: Copy['texts']): string {
  const parts = [texts.kicker, texts.title, texts.sub, ...(texts.items ?? [])].filter((x): x is string => !!x).map((x) => x.replace(/[.!?]+$/, ''));
  return cleanAltText(`Arte do post com o texto: ${parts.join('. ')}.`) ?? texts.title;
}

// O texto alternativo final: o do redator; sem ele, a descrição da foto (quando a foto vai sem texto
// por cima) ou o texto que está na arte. Com palavra proibida da empresa, volta para o texto da arte, que
// já passou pelo revisor.
export function finalAltText(input: { fromWriter: string; photoDescription?: string | null; texts: Copy['texts']; banned: string[] }): string {
  const chosen = input.fromWriter || cleanAltText(input.photoDescription) || altTextFromTexts(input.texts);
  const low = chosen.toLowerCase();
  return input.banned.some((w) => w.trim() && low.includes(w.trim().toLowerCase())) ? altTextFromTexts(input.texts) : chosen;
}

// O pedido ao modelo de imagem: a descrição do agente mais o que vale sempre (nada de texto, logo
// nem rosto). Fica no código, não no prompt do redator, para o modelo não "esquecer".
export const VISUAL_SUFFIX = 'Photographic, natural light, high quality, subtle, with empty space in the lower third for text. No text, no letters, no typography, no logo, no watermark, no brand, no children faces, no identifiable person.';

export function visualPromptFor(copy: Copy): string {
  return `${copy.visualPrompt ?? ''} ${VISUAL_SUFFIX}`.trim();
}

// A volta do revisor (BEZ-296): o modelo reescreve tudo e traz o que ninguém pediu (fato da base,
// prazo inventado), e "corrija só" no prompt não segura. Com os achados só na legenda, o texto da imagem
// da rodada anterior fica como estava; só na imagem, fica a legenda. Nos dois lados, vale a volta inteira.
export function keepWhatPassed(previous: Copy, next: Copy, feedback: Issue[]): Copy {
  if (feedback.some((i) => i.rule === 'format')) return next;
  const sides = new Set(feedback.map((i) => i.where));
  if (sides.size !== 1) return next;
  if (sides.has('caption')) return { ...next, kind: previous.kind, angle: previous.angle, texts: previous.texts, visualPrompt: previous.visualPrompt, altText: previous.altText };
  return { ...next, caption: previous.caption, hashtags: previous.hashtags };
}

export function imageTextsOf(copy: Copy): string[] {
  const t = copy.texts;
  return [t.kicker, t.title, t.sub, ...(t.items ?? [])].filter((x): x is string => !!x);
}

// Atalhos de ajuste da legenda (SPEC 012, decisão 2): uma chamada curta, só sobre a legenda. O texto
// da imagem não muda (seria outra renderização); o limite do mês não é tocado.
export const REWRITE_MODES = ['shorter', 'casual', 'formal', 'cta'] as const;
export type RewriteMode = (typeof REWRITE_MODES)[number];

export function isRewriteMode(value: unknown): value is RewriteMode {
  return typeof value === 'string' && (REWRITE_MODES as readonly string[]).includes(value);
}

const REWRITE_ASK: Record<RewriteMode, string> = {
  shorter: 'Encurte a legenda: metade do tamanho, mantendo a ideia central e a chamada final.',
  casual: 'Deixe a legenda mais descontraída e próxima, como quem conversa com um cliente, sem perder a informação.',
  formal: 'Deixe a legenda mais formal e direta, sem perder a informação nem virar texto de manual.',
  cta: 'Troque a chamada final por outra, diferente da atual, coerente com a empresa.',
};

export function buildRewritePrompt(input: { mode: RewriteMode; caption: string; hashtags: string[]; profile: CompanyProfile; facts: string[]; never: string[] }): string {
  const p = input.profile;
  const lines = [
    'Você é o redator de uma pequena empresa brasileira no Instagram. Responda SÓ com um objeto JSON, em português do Brasil, com acentos corretos.',
    '',
    `## A empresa: ${p.offering}. Para quem: ${p.audience}. Jeito de falar: ${voiceLine(p)}.${p.ctaDefault && CTA_TEXT[p.ctaDefault] ? ` Chamada padrão: ${CTA_TEXT[p.ctaDefault]}.` : ''}`,
    `## Pode afirmar: ${input.facts.length ? input.facts.join('; ') : 'nenhum número, preço ou prazo'}`,
    input.never.length ? `## Nunca afirma: ${input.never.join('; ')}` : '',
    p.bannedWords.length ? `## Palavras proibidas: ${p.bannedWords.join(', ')}` : '',
    '',
    `## Pedido: ${REWRITE_ASK[input.mode]}`,
    '- Sem travessão (— ou –). Sem "imperdível", "garantido" nem superlativo vazio. Mantenha ou troque as hashtags só se fizer sentido (3 a 8, sem o #).',
    '',
    `## Legenda atual:\n${input.caption}`,
    `## Hashtags atuais: ${input.hashtags.join(', ')}`,
    '',
    '## Formato da resposta (JSON)',
    '{"caption":"...","hashtags":["..."]}',
  ];
  return lines.filter((l) => l !== '').join('\n');
}

export function parseRewrite(json: unknown): { ok: true; caption: string; hashtags: string[] } | { ok: false; error: string } {
  const o = json && typeof json === 'object' && !Array.isArray(json) ? (json as Record<string, unknown>) : null;
  const caption = typeof o?.caption === 'string' ? o.caption.trim().slice(0, LIMITS.caption) : '';
  if (!caption) return { ok: false, error: 'O modelo não devolveu a legenda.' };
  const hashtags = (Array.isArray(o?.hashtags) ? o!.hashtags : [])
    .map((h) => String(h).trim().replace(/^#/, '').toLowerCase().replace(/[^\p{L}\p{N}_]/gu, ''))
    .filter((h, i, arr) => h && arr.indexOf(h) === i)
    .slice(0, LIMITS.hashtags);
  return { ok: true, caption, hashtags };
}
