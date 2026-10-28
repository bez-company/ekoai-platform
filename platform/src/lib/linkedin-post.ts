// linkedin-post.ts: o redator do LinkedIn (SPEC 028, BEZ-424), na parte pura: o prompt e a leitura da resposta. O texto
// parte do núcleo da ideia (angle, points, proof, question), nunca da legenda do Instagram: legenda curta, hashtag e
// chamada para a bio não servem a quem lê no LinkedIn. Perfil pessoal. Sem I/O.

import { cleanShareReason, reachLines, voiceLine, type Core, type CopyCampaign } from './agents';
import { signalPromptLines } from './channel-signals';
import type { CompanyProfile } from './company-profile-model';
import type { Issue } from './design/review';

export const LINKEDIN_LIMITS = { text: 1500, hook: 210, hashtags: 3, shareReason: 160 };

export type LinkedInInput = {
  idea: string;
  goal?: string | null; // o objetivo do post em uma frase
  core: Core;
  profile: CompanyProfile;
  facts: string[];
  never: string[];
  rules: string[];
  campaign?: CopyCampaign | null;
  feedback?: Issue[]; // achados da volta anterior
  previous?: LinkedInPost | null; // o texto recusado
};

export type LinkedInPost = { text: string; hashtags: string[]; shareReason: string };

export function buildLinkedInPrompt(input: LinkedInInput): string {
  const p = input.profile;
  const c = input.core;
  const lines: string[] = [];
  lines.push('Você escreve o post de LinkedIn do perfil pessoal do dono ou da dona de uma pequena empresa brasileira. Responda SÓ com um objeto JSON, em português do Brasil, com acentos corretos.');
  lines.push('');
  lines.push('## A empresa');
  lines.push(`- Nicho: ${p.niche}`);
  lines.push(`- O que vende: ${p.offering}`);
  lines.push(`- Para quem: ${p.audience}`);
  if (p.region) lines.push(`- Região: ${p.region}`);
  if (p.differentiators.length) lines.push(`- Diferenciais: ${p.differentiators.join('; ')}`);
  lines.push(`- Jeito de falar: ${voiceLine(p)}`);
  // O alcance da empresa (cidade, Brasil todo) vale aqui também; o texto dessas linhas fala de legenda, e aqui é o texto do post.
  lines.push(...reachLines(p).map((l) => l.replace(/legendas?/g, 'texto')));
  if (input.campaign) {
    const k = input.campaign;
    lines.push('');
    lines.push(`## A campanha deste post: ${k.name}`);
    if (k.objective) lines.push(`- Resultado que a empresa quer: ${k.objective}`);
    if (k.offering) lines.push(`- O que entra nos posts (vale como afirmado só para esta campanha): ${k.offering}`);
    if (k.restrictions.length) lines.push(`- Nunca diga nesta campanha: ${k.restrictions.join('; ')}`);
    lines.push('- Sirva ao resultado da campanha sem inventar oferta, preço, prazo, desconto nem meta.');
  }
  lines.push('');
  lines.push('## O que a empresa pode afirmar (fatos, com fonte). Número, preço, prazo ou funcionalidade só saem se estiverem aqui, no núcleo ou na ideia do pedido.');
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
  lines.push(...signalPromptLines('linkedin'));
  lines.push('');
  lines.push('## A ideia, já pensada (o núcleo). Escreva o post só a partir disto e do pedido, na ordem dos pontos.');
  lines.push(`- Pedido: ${input.idea}`);
  if (input.goal) lines.push(`- Objetivo do post: ${input.goal}`);
  lines.push(`- Ângulo: ${c.angle}`);
  lines.push(`- Pontos: ${c.points.join('; ')}`);
  if (c.proof) lines.push(`- Fato que sustenta: ${c.proof}`);
  if (c.question) lines.push(`- Pergunta que o público responde: ${c.question}`);
  lines.push('');
  lines.push('## Regras do texto');
  lines.push('- Primeira pessoa do singular, voz de quem faz o trabalho. Frase curta, voz ativa, sentence case. Nada de travessão (— ou –): use vírgula, ponto ou dois-pontos.');
  lines.push(`- A abertura são as duas primeiras linhas, separadas por quebra de linha, cada uma uma frase curta (até 100 caracteres, juntas cabem em cerca de ${LINKEDIN_LIMITS.hook}). É o que aparece antes do "ver mais": a primeira diz algo específico e a segunda dá motivo para abrir. Comece pela situação, pelo problema ou pelo número, nunca por definição nem por "Saber...". Nada de rótulo de tema nem frase que serviria a qualquer empresa.`);
  lines.push('- Escreva como quem fez o trabalho: "eu", "a gente", uma cena do dia a dia da empresa. Nada de tom de manual nem de "rigor técnico", "qualidade", "precisão" ou "excelência".');
  lines.push('- Dali em diante, parágrafos de uma ou duas frases, com uma linha em branco entre eles. Uma situação concreta ou um fato da lista acima. Sem enchimento: cada linha tem que dar um motivo para a pessoa continuar lendo.');
  lines.push('- Termine com UMA pergunta que um colega de profissão responde com a experiência dele: outro dono ou profissional do seu ramo, não o cliente final. Se a pergunta do núcleo for para o consumidor, reescreva-a para o colega. Não peça curtida, compartilhamento nem comentário, e não use "o que vocês acham?".');
  lines.push('- Não cite link, site, preço nem prazo que não estejam nos fatos ou no pedido. Sem emoji. Nada de "imperdível", "garantido", "melhor da cidade", "descubra", "mergulhe", "jornada", "essência" nem "o segredo é".');
  lines.push(`- text: o post inteiro, até ${LINKEDIN_LIMITS.text} caracteres. hashtags: de 0 a ${LINKEDIN_LIMITS.hashtags}, sem o #, minúsculas, sem acento; só se ajudarem a rede a entender o assunto.`);
  lines.push(`- share_reason: UMA frase, até ${LINKEDIN_LIMITS.shareReason} caracteres, que diz quem responde a este post e por quê, no negócio desta empresa. Específica deste post.`);
  if (input.feedback?.length) {
    lines.push('');
    lines.push('## A versão anterior foi recusada pelo revisor. Corrija SÓ o que está abaixo, copie o resto igual e não acrescente fato, prazo nem número novo:');
    lines.push(input.feedback.map((i) => `- ${i.message}`).join('\n'));
    if (input.previous) lines.push(`Versão anterior: ${JSON.stringify({ text: input.previous.text, hashtags: input.previous.hashtags })}`);
  }
  lines.push('');
  lines.push('## Formato da resposta (JSON)');
  lines.push('{"text":"...","hashtags":["..."],"share_reason":"..."}');
  return lines.join('\n');
}

type Parsed = { ok: true; value: LinkedInPost } | { ok: false; error: string };

// A resposta do modelo. Corta o que passa do teto em vez de recusar; recusa o que não dá para usar (sem texto, sem as duas
// primeiras linhas, sem razão) e devolve o motivo ao modelo, como as outras falhas de formato.
export function parseLinkedIn(json: unknown): Parsed {
  const o = json && typeof json === 'object' && !Array.isArray(json) ? (json as Record<string, unknown>) : null;
  if (!o) return { ok: false, error: 'O modelo não devolveu um objeto.' };
  const text = typeof o.text === 'string' ? o.text.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/\s*[–—]\s*/g, ', ').trim().slice(0, LINKEDIN_LIMITS.text).trim() : '';
  if (!text) return { ok: false, error: 'O modelo não devolveu o texto do post do LinkedIn.' };
  if (hookOf(text).length < 15) return { ok: false, error: 'O texto do LinkedIn precisa abrir com uma frase que prometa algo (as duas primeiras linhas).' };
  const shareReason = cleanShareReason(o.share_reason);
  if (!shareReason) return { ok: false, error: 'O modelo não explicou, em uma frase específica, quem responde ao post e por quê (share_reason).' };
  const hashtags = (Array.isArray(o.hashtags) ? o.hashtags : [])
    .map((h) => String(h).trim().replace(/^#/, '').toLowerCase().replace(/[^\p{L}\p{N}_]/gu, ''))
    .filter((h, i, arr) => h && arr.indexOf(h) === i)
    .slice(0, LINKEDIN_LIMITS.hashtags);
  return { ok: true, value: { text, hashtags, shareReason } };
}

// O gancho: as duas primeiras linhas (o que aparece antes do "ver mais"), cortadas no teto.
export function hookOf(text: string): string {
  return text.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 2).join('\n').slice(0, LINKEDIN_LIMITS.hook).trim();
}

// O texto como vai ao LinkedIn: as hashtags, quando há, numa linha no fim.
export function linkedInBody(post: LinkedInPost): string {
  return post.hashtags.length ? `${post.text}\n\n${post.hashtags.map((h) => `#${h}`).join(' ')}` : post.text;
}
