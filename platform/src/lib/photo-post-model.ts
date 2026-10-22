// photo-post-model.ts: publicar uma foto pronta, sem gerar imagem (SPEC 017 decisão 10, BEZ-236).
// Puro, sem I/O: a validação do pedido e o prompt da legenda que a Ekoai escreve olhando a foto.
// A legenda pela IA é uma chamada curta de texto com visão e não conta no limite do plano (só a
// geração de imagem conta).

import type { CompanyProfile } from './company-profile-model';
import { LIMITS } from './agents';
import { isPhotoRatio, type Focus, type PhotoRatio } from './design/photo';

export const PHOTO_IDEA_MAX = 300;

// `now`: publica na hora. `schedule`: entra no próximo horário livre (ou na fila, sem horário).
export const PHOTO_WHEN = ['now', 'schedule'] as const;
export type PhotoWhen = (typeof PHOTO_WHEN)[number];

export type PhotoPostInput = {
  assetId: string;
  ratio: PhotoRatio;
  focus: Focus;
  caption: string;
  hashtags: string[];
  when: PhotoWhen;
};

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string; field?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function cleanHashtags(value: unknown): string[] {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[\s,]+/) : [];
  return list
    .map((h) => String(h).trim().replace(/^#/, '').toLowerCase().replace(/[^\p{L}\p{N}_]/gu, ''))
    .filter((h, i, arr) => h && arr.indexOf(h) === i)
    .slice(0, LIMITS.hashtags);
}

function focusOf(value: unknown): Focus | null {
  if (value == null) return { x: 0.5, y: 0.5 };
  if (typeof value !== 'object' || Array.isArray(value)) return null;
  const { x, y } = value as Record<string, unknown>;
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  return { x, y };
}

export function parsePhotoPost(body: unknown): Parsed<PhotoPostInput> {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  if (typeof b.assetId !== 'string' || !UUID.test(b.assetId)) return { ok: false, error: 'Escolha uma foto do banco de imagens.', field: 'assetId' };
  const ratio = b.ratio == null || b.ratio === '' ? '4:5' : b.ratio;
  if (!isPhotoRatio(ratio)) return { ok: false, error: 'Escolha o formato retrato (4:5), quadrado (1:1) ou paisagem (1.91:1).', field: 'ratio' };
  const focus = focusOf(b.focus);
  if (!focus) return { ok: false, error: 'O ponto do corte está fora da foto. Ajuste o corte de novo.', field: 'focus' };
  const caption = typeof b.caption === 'string' ? b.caption.trim() : '';
  if (!caption) return { ok: false, error: 'Escreva a legenda ou peça para a Ekoai escrever.', field: 'caption' };
  if (caption.length > LIMITS.caption) return { ok: false, error: `A legenda passa de ${LIMITS.caption} caracteres, o limite do Instagram.`, field: 'caption' };
  if (!(PHOTO_WHEN as readonly unknown[]).includes(b.when)) return { ok: false, error: 'Escolha publicar agora ou agendar.', field: 'when' };
  return { ok: true, value: { assetId: b.assetId.toLowerCase(), ratio, focus, caption, hashtags: cleanHashtags(b.hashtags), when: b.when as PhotoWhen } };
}

// Pedido da legenda: a foto (por id) e, opcional, o que a pessoa quer dizer.
export function parsePhotoCaptionRequest(body: unknown): Parsed<{ assetId: string; idea: string | null }> {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  if (typeof b.assetId !== 'string' || !UUID.test(b.assetId)) return { ok: false, error: 'Escolha uma foto do banco de imagens.', field: 'assetId' };
  const idea = typeof b.idea === 'string' ? b.idea.trim().replace(/\s+/g, ' ') : '';
  if (idea.length > PHOTO_IDEA_MAX) return { ok: false, error: `Use até ${PHOTO_IDEA_MAX} caracteres.`, field: 'idea' };
  return { ok: true, value: { assetId: b.assetId.toLowerCase(), idea: idea || null } };
}

const CTA_TEXT: Record<string, string> = { link_bio: 'convide a pessoa ao link da bio', whatsapp: 'convide a pessoa a chamar no WhatsApp', dm: 'convide a pessoa a mandar mensagem direta' };

// A Ekoai olha a foto (vai junto na chamada) e escreve a legenda com a voz da empresa.
export function buildPhotoCaptionPrompt(input: { profile: CompanyProfile; facts: string[]; never: string[]; rules: string[]; description: string | null; idea: string | null }): string {
  const p = input.profile;
  const lines = [
    'Você é o redator de uma pequena empresa brasileira no Instagram. A foto do post vai junto desta mensagem: olhe a foto e escreva a legenda. Responda SÓ com um objeto JSON, em português do Brasil, com acentos corretos.',
    '',
    `## A empresa: ${p.niche}. O que vende: ${p.offering}. Para quem: ${p.audience}.${p.region ? ` Região: ${p.region}.` : ''}`,
    p.ctaDefault && CTA_TEXT[p.ctaDefault] ? `## Chamada padrão: ${CTA_TEXT[p.ctaDefault]}.` : '',
    `## Pode afirmar: ${input.facts.length ? input.facts.join('; ') : 'nenhum número, preço ou prazo'}`,
    input.never.length ? `## Nunca afirma: ${input.never.join('; ')}` : '',
    p.bannedWords.length ? `## Palavras proibidas: ${p.bannedWords.join(', ')}` : '',
    input.rules.length ? `## Regras aprendidas com esta conta:\n${input.rules.map((r) => `- ${r}`).join('\n')}` : '',
    input.description ? `## O que a foto mostra (descrição do banco de imagens): ${input.description}` : '',
    input.idea ? `## O que a pessoa quer dizer: ${input.idea}` : '## A pessoa não disse o que quer: escreva sobre o que a foto mostra, ligado ao que a empresa vende.',
    '',
    '## Regras',
    '- Descreva só o que está na foto. Não invente produto, sabor, preço, prazo, nome de pessoa nem depoimento.',
    '- Frase curta, voz ativa. Sem travessão (— ou –). Sem "imperdível", "garantido" nem superlativo vazio.',
    '- Legenda até 900 caracteres, com a chamada no fim. No máximo 2 emojis, e só se combinar com a empresa.',
    '- hashtags: de 3 a 8, sem o #, minúsculas, sem acento.',
    '',
    '## Formato da resposta (JSON)',
    '{"caption":"...","hashtags":["..."]}',
  ];
  return lines.filter((l) => l !== '').join('\n');
}
