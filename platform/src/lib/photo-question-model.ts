// photo-question-model.ts: foto anexada no Criar post (SPEC 017 decisão 7, BEZ-237). Puro, sem I/O.
// Quando a pessoa anexa uma foto do banco, a Ekoai pergunta só o que ficou ambíguo, no máximo 2
// perguntas com resposta de um clique:
//   1. "Como usar a foto?" (só se o pedido não disse): como está, de fundo, no layout da marca ou
//      só como inspiração;
//   2. "O que escrever?" (só se o pedido não diz o que o post fala): 2 ou 3 sugestões tiradas da foto
//      pela visão, mais "Escrever eu".
// A decisão 7 ainda espera o Matheus (perguntas curtas, como aqui, ou chat aberto).
//
// O uso decide a geração: "como está" e "de fundo"/"no layout" usam a foto no lugar do visual por IA
// e não contam no limite do plano; "inspiração" gera outra imagem a partir dela e conta.

export const PHOTO_USAGES = ['as_is', 'background', 'layout', 'inspiration'] as const;
export type PhotoUsage = (typeof PHOTO_USAGES)[number];

export const USAGE_LABEL: Record<PhotoUsage, string> = {
  as_is: 'Como está, só a legenda',
  background: 'De fundo, com um título por cima',
  layout: 'Dentro do layout da marca',
  inspiration: 'Só como inspiração para outra imagem',
};

export const SUGGESTION_MAX = 120;
export const OWN_TEXT = 'own';

export function isPhotoUsage(value: unknown): value is PhotoUsage {
  return typeof value === 'string' && (PHOTO_USAGES as readonly string[]).includes(value);
}

// O uso que conta no limite do plano: só o que chama o modelo de imagem.
export function usageCallsImageModel(usage: PhotoUsage): boolean {
  return usage === 'inspiration';
}

// O uso que põe a foto da pessoa no post (e por isso exige autorização de uso de imagem e marca a
// foto como usada quando o post sai).
export function usageShowsPhoto(usage: PhotoUsage): boolean {
  return usage !== 'inspiration';
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const USAGE_PATTERNS: [PhotoUsage, RegExp][] = [
  ['inspiration', /\b(inspira\w*|referencia|parecid[ao]|no estilo d[aoe])\b/],
  ['as_is', /\b(como esta|sem texto|sem titulo|so (a )?legenda|so com (a )?legenda|do jeito que esta)\b/],
  ['layout', /\b(layout|modelo da marca|cara da marca|moldura|template)\b/],
  ['background', /\b(de fundo|no fundo|fundo|titulo por cima|texto por cima)\b/],
];

// O pedido já diz como usar a foto? ("tenho uma foto de natureza, use de fundo" = de fundo)
export function usageFromIdea(idea: string): PhotoUsage | null {
  const text = norm(idea);
  for (const [usage, re] of USAGE_PATTERNS) if (re.test(text)) return usage;
  return null;
}

// Palavras que falam da foto ou do uso, não do assunto do post.
const NOISE = new Set(
  'a o as os um uma de da do das dos e em no na nos nas com sem para pra por que essa esse esta este isso isto minha meu foto fotos imagem use usar usa coloca colocar poe por fundo titulo cima layout marca modelo como esta so legenda inspiracao referencia tenho aqui post faz fazer quero'.split(' '),
);

// O pedido diz o que o post fala? Três palavras de assunto bastam ("abrimos domingo às 9h" diz).
export function ideaSaysWhatToWrite(idea: string): boolean {
  const words = norm(idea).split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !NOISE.has(w));
  return words.length >= 3;
}

export type QuestionOption = { value: string; label: string };
export type PhotoQuestion = { id: 'usage' | 'text'; text: string; options: QuestionOption[] };
export type PhotoQuestions = { questions: PhotoQuestion[]; inferredUsage: PhotoUsage | null; describe: boolean };

// Quais perguntas fazer. `suggestions` vem da visão (pode vir vazio se a visão falhou).
export function buildQuestions(idea: string, suggestions: string[]): PhotoQuestions {
  const inferredUsage = usageFromIdea(idea);
  const questions: PhotoQuestion[] = [];
  if (!inferredUsage) {
    questions.push({ id: 'usage', text: 'Como usar a foto?', options: PHOTO_USAGES.map((u) => ({ value: u, label: USAGE_LABEL[u] })) });
  }
  if (!ideaSaysWhatToWrite(idea)) {
    questions.push({
      id: 'text',
      text: 'O que escrever?',
      options: [...suggestions.slice(0, 3).map((s, i) => ({ value: `s${i + 1}`, label: s })), { value: OWN_TEXT, label: 'Escrever eu' }],
    });
  }
  return { questions, inferredUsage, describe: questions.some((q) => q.id === 'text') };
}

export function suggestionsPrompt(input: { niche: string | null; idea: string }): string {
  return [
    'Você ajuda uma pequena empresa brasileira a postar no Instagram a partir de uma foto dela.',
    input.niche ? `Ramo: ${input.niche}.` : '',
    input.idea ? `O que a pessoa disse: ${input.idea}` : '',
    `Olhe a foto e proponha 3 ideias curtas do que o post pode dizer (até ${SUGGESTION_MAX} caracteres cada), concretas e tiradas do que aparece na foto. Português do Brasil, sentence case, sem travessão, sem preço, prazo nem nome de pessoa.`,
    'Responda só com JSON: {"suggestions": [string, string, string]}.',
  ].filter(Boolean).join('\n');
}

export function parseSuggestions(json: unknown): string[] {
  const list = json && typeof json === 'object' && Array.isArray((json as { suggestions?: unknown }).suggestions) ? (json as { suggestions: unknown[] }).suggestions : [];
  const out: string[] = [];
  for (const s of list) {
    if (typeof s !== 'string') continue;
    const text = s.trim().replace(/\s+/g, ' ').replace(/[–—]/g, ',');
    if (text && !out.includes(text)) out.push(text.slice(0, SUGGESTION_MAX));
  }
  return out.slice(0, 3);
}

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string; field?: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseQuestionRequest(body: unknown): Parsed<{ assetId: string; idea: string }> {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  if (typeof b.assetId !== 'string' || !UUID.test(b.assetId)) return { ok: false, error: 'Escolha uma foto do banco de imagens.', field: 'assetId' };
  const idea = typeof b.idea === 'string' ? b.idea.trim().replace(/\s+/g, ' ').slice(0, 500) : '';
  return { ok: true, value: { assetId: b.assetId, idea } };
}

// A foto no pedido de post: as duas juntas ou nenhuma.
export function parsePhotoChoice(body: Record<string, unknown>): Parsed<{ assetId: string; usage: PhotoUsage } | null> {
  const hasAsset = body.asset_id != null && body.asset_id !== '';
  const hasUsage = body.photo_usage != null && body.photo_usage !== '';
  if (!hasAsset && !hasUsage) return { ok: true, value: null };
  if (typeof body.asset_id !== 'string' || !UUID.test(body.asset_id)) return { ok: false, error: 'Escolha uma foto do banco de imagens.', field: 'asset_id' };
  if (!isPhotoUsage(body.photo_usage)) return { ok: false, error: 'Diga como usar a foto.', field: 'photo_usage' };
  return { ok: true, value: { assetId: body.asset_id, usage: body.photo_usage } };
}
