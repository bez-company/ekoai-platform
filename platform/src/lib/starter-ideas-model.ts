// starter-ideas-model.ts: "Sugerir ideias" do Criar post (SPEC 025, BEZ-375): 6 ideias de post e algumas dicas de design
// para quem está começando um Instagram, pelo perfil da empresa. Puro, sem I/O: monta o prompt e confere a resposta do modelo
// (as cores e as fontes da linha de design vêm do perfil, nunca do modelo).

import { GOALS, type PostGoal } from './post-goals';
import { voiceLine } from './agents';
import type { CompanyProfile } from './company-profile-model';

export const IDEA_COUNT = 6;
export const TIP_MAX_ITEMS = 3;
const IDEA_LEN = 120;
const TIP_LEN = 140;

// Sem "data comemorativa" (vai no tema do pedido) e sem "deixar a Ekoai escolher": a ideia já é uma escolha.
export const IDEA_GOALS = ['ensinar', 'produto', 'bastidores', 'novidade', 'promocao', 'prova_social', 'conversa'] as const satisfies readonly PostGoal[];
export type IdeaGoal = (typeof IDEA_GOALS)[number];

export type StarterIdea = { id: string; idea: string; goal: IdeaGoal; goalLabel: string; format: 'single' | 'carousel' };
export type StarterIdeas = { ideas: StarterIdea[]; tips: string[] };

// A empresa precisa dizer o que vende e para quem: sem isso, a ideia sairia genérica.
export function profileReady(p: CompanyProfile | null): p is CompanyProfile {
  return !!p && !!p.niche?.trim() && !!p.offering?.trim() && !!p.audience?.trim();
}

export function buildIdeasPrompt(input: { profile: CompanyProfile; facts: string[]; never: string[] }): string {
  const p = input.profile;
  return [
    'Você é o estrategista de conteúdo de uma pequena empresa brasileira que está começando o Instagram. Responda SÓ com um objeto JSON, em português do Brasil, com acentos corretos.',
    '',
    `## A empresa: ${p.offering}. Nicho: ${p.niche}.${p.region ? ` Região: ${p.region}.` : ''} Para quem: ${p.audience}. Jeito de falar: ${voiceLine(p)}.`,
    p.differentiators.length ? `## Diferenciais: ${p.differentiators.join('; ')}` : '',
    p.pains.length ? `## Dores do cliente: ${p.pains.join('; ')}` : '',
    `## Pode afirmar: ${input.facts.length ? input.facts.join('; ') : 'nenhum número, preço nem prazo'}`,
    input.never.length ? `## Nunca afirma: ${input.never.join('; ')}` : '',
    p.bannedWords.length ? `## Palavras proibidas: ${p.bannedWords.join(', ')}` : '',
    '',
    '## Tarefa',
    `- ideas: exatamente ${IDEA_COUNT} ideias de post, variadas (não repita o mesmo objetivo mais de duas vezes). Cada uma: idea (uma frase de até ${IDEA_LEN} caracteres, o assunto do post, concreta e do negócio dessa empresa), goal (um destes: ${IDEA_GOALS.join(', ')}) e format ("single" para uma imagem; "carousel" para lista ou passo a passo).`,
    `- tips: de 2 a ${TIP_MAX_ITEMS} dicas curtas (até ${TIP_LEN} caracteres cada) de linha de design e de conteúdo para o nicho: que tipo de foto, que tipo de texto na imagem, quando usar carrossel. Nada sobre cores nem fontes: isso vem do perfil.`,
    '- Sem promessa de resultado, sem número, preço ou prazo que não esteja nos fatos, sem "imperdível", sem jargão, sem travessão (— ou –).',
    '',
    'Formato: {"ideas":[{"idea":"...","goal":"ensinar","format":"single"}],"tips":["..."]}',
  ]
    .filter((l) => l !== '')
    .join('\n');
}

const clean = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/[—–]/g, ',').replace(/\s+/g, ' ').trim().slice(0, max) : '');

type Parsed = { ok: true; value: StarterIdeas } | { ok: false; error: string };

// A resposta do modelo no formato da tela. Ideia sem texto ou com objetivo fora da lista sai; menos de 3 ideias boas é falha.
export function parseIdeas(json: unknown): Parsed {
  const o = json && typeof json === 'object' && !Array.isArray(json) ? (json as Record<string, unknown>) : null;
  if (!o || !Array.isArray(o.ideas)) return { ok: false, error: 'O modelo não devolveu as ideias.' };
  const seen = new Set<string>();
  const ideas: StarterIdea[] = [];
  for (const raw of o.ideas) {
    const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const idea = clean(r.idea, IDEA_LEN);
    const goal = (IDEA_GOALS as readonly string[]).includes(String(r.goal)) ? (r.goal as IdeaGoal) : null;
    if (!idea || !goal || seen.has(idea.toLowerCase())) continue;
    seen.add(idea.toLowerCase());
    ideas.push({ id: `i${ideas.length + 1}`, idea, goal, goalLabel: GOALS[goal].label, format: r.format === 'carousel' ? 'carousel' : 'single' });
    if (ideas.length === IDEA_COUNT) break;
  }
  if (ideas.length < 3) return { ok: false, error: `O modelo devolveu só ${ideas.length} ideia(s) aproveitável(is).` };
  const tips = (Array.isArray(o.tips) ? o.tips : []).map((t) => clean(t, TIP_LEN)).filter(Boolean).slice(0, TIP_MAX_ITEMS);
  return { ok: true, value: { ideas, tips } };
}

// A linha de design que a tela mostra: cores e fontes do perfil (ou do padrão neutro) mais as dicas do modelo.
export function designLine(p: CompanyProfile, tips: string[]): { colors: string[]; fonts: { heading: string | null; body: string | null }; tips: string[] } {
  return { colors: [p.colorPrimary, p.colorAccent].filter((c): c is string => !!c), fonts: { heading: p.fontHeading, body: p.fontBody }, tips };
}
