// signal-critic.ts: o avaliador de sinais (SPEC 028, BEZ-425), na parte pura: as rubricas, o prompt, a leitura da resposta e os
// tetos por código. A Ekoai NÃO conhece a nota real de nenhuma rede: isto prevê o potencial do post com o que a rede diz medir
// (channel-signals.json), em faixa (forte, médio, fraco) e checklist, e nunca como um número que pareça da rede. O modelo que
// avalia é obrigado a citar o trecho que prova cada nota; o código confere a citação e derruba o juiz otimista. Sem I/O.

import { hookOf } from './linkedin-post';
import type { Signal } from './post-goals';

export type CriticChannel = 'instagram' | 'linkedin';
export type Score = 0 | 1 | 2;
export type Band = 'forte' | 'medio' | 'fraco';

export type Criterion = {
  id: string;
  label: string;
  score: Score;
  evidence: string | null; // o trecho do post que prova a nota, ou a observação quando a nota é 0
  suggestion: string | null; // uma frase do que mudar, só abaixo de 2
};

export type Critic = {
  channel: CriticChannel;
  band: Band;
  criteria: Criterion[];
  fixed?: boolean; // a Ekoai já aplicou o conserto de uma volta antes de mostrar
};

type RubricItem = { id: string; label: string; ask: string };

// O que cada critério pergunta e o que vale 0, 1 e 2. Os rótulos são os que a tela mostra (protótipo v23).
export const RUBRICS: Record<CriticChannel, RubricItem[]> = {
  instagram: [
    { id: 'envio', label: 'Envio', ask: 'Alguém mandaria este post a uma pessoa específica? 2: o texto dá um motivo claro e dá para saber a quem mandar; 1: dá para mandar, mas é genérico; 0: ninguém mandaria.' },
    { id: 'salvamento', label: 'Salvamento', ask: 'Dá para consultar depois? 2: lista, passo a passo ou dado que se guarda; 1: algo útil, mas solto; 0: nada para guardar.' },
    { id: 'gancho', label: 'Gancho da capa', ask: 'O texto da capa promete algo específico? 2: promete um resultado ou uma pergunta concreta; 1: é um tema com um toque de promessa; 0: é um rótulo de tema.' },
    { id: 'fato', label: 'Fato da empresa', ask: 'O post usa um fato da lista de fatos da empresa? 2: cita o fato; 1: aproveita o assunto do negócio, sem fato; 0: serviria a qualquer empresa.' },
    { id: 'chamada', label: 'Chamada', ask: 'A chamada no fim combina com o que o post pede à pessoa e é uma frase só, sem insistir? 2: sim; 1: serve, mas pesa ou é vaga; 0: falta ou contradiz o post.' },
  ],
  linkedin: [
    { id: 'gancho', label: 'Gancho nas duas primeiras linhas', ask: 'As duas primeiras linhas prometem algo específico e dão motivo para abrir o "ver mais"? 2: sim, com situação, problema ou número; 1: promete, mas é genérico; 0: é definição ou rótulo.' },
    { id: 'especificidade', label: 'Especificidade', ask: 'O texto traz uma situação concreta ou um fato da empresa? 2: sim, citado; 1: fala do negócio sem detalhe; 0: serviria a qualquer empresa.' },
    { id: 'leitura', label: 'Vale ler tudo', ask: 'Cada parágrafo dá um motivo para continuar lendo? 2: sim, sem enchimento; 1: tem partes que só repetem; 0: enche linha.' },
    { id: 'pergunta', label: 'Pergunta que um colega responde', ask: 'O fim tem uma pergunta que um colega de profissão responde com a experiência dele? 2: pergunta específica; 1: pergunta aberta demais; 0: não há pergunta ou pede curtida ou compartilhamento.' },
    { id: 'voz', label: 'Voz humana', ask: 'Soa a quem fez o trabalho, em primeira pessoa e com uma cena? 2: sim; 1: oscila entre pessoa e manual; 0: tom de manual, de blog ou de texto genérico de IA.' },
  ],
};

export type PostView = {
  text: string; // a legenda (Instagram) ou o texto do post (LinkedIn)
  hashtags: string[];
  coverText?: string; // Instagram: o texto da capa (título e selo)
  imageTexts?: string[]; // Instagram: todo o texto que já está desenhado na imagem (capa e itens)
  shareReason: string;
  signal: Signal;
};

export type CriticFacts = { niche: string; audience: string; facts: string[] };

export function buildCriticPrompt(channel: CriticChannel, post: PostView, ctx: CriticFacts): string {
  const label = channel === 'instagram' ? 'Instagram' : 'LinkedIn';
  const lines: string[] = [];
  lines.push(`Você avalia o potencial de um post de ${label} de uma pequena empresa brasileira, critério por critério. Responda SÓ com um objeto JSON.`);
  lines.push('Você não sabe a nota real da rede e não deve fingir que sabe: avalie só o que está escrito, contra a pergunta de cada critério.');
  lines.push('');
  lines.push('## A empresa');
  lines.push(`- Nicho: ${ctx.niche}`);
  lines.push(`- Para quem: ${ctx.audience}`);
  lines.push(ctx.facts.length ? `- Fatos cadastrados (os únicos que o post pode afirmar):\n${ctx.facts.map((f) => `  - ${f}`).join('\n')}` : '- Fatos cadastrados: nenhum');
  lines.push('');
  lines.push(`## O post de ${label}`);
  if (post.coverText) lines.push(`Texto da capa: ${post.coverText}`);
  if (post.imageTexts?.length) lines.push(`Todo o texto que já está desenhado na imagem: ${post.imageTexts.join(' | ')}`);
  lines.push(`${channel === 'instagram' ? 'Legenda' : 'Texto'}:\n"""\n${post.text}\n"""`);
  if (post.hashtags.length) lines.push(`Hashtags: ${post.hashtags.map((h) => `#${h}`).join(' ')}`);
  lines.push(`O redator declarou que o post pede à pessoa "${post.signal}" porque: ${post.shareReason}. Confira se o texto sustenta isso.`);
  lines.push('');
  lines.push('## Critérios (nota 0, 1 ou 2)');
  for (const c of RUBRICS[channel]) lines.push(`- ${c.id} (${c.label}): ${c.ask}`);
  lines.push('');
  lines.push('## Regras da resposta');
  lines.push('- evidence: para nota 1 ou 2, COPIE um trecho exato do post que prova a nota (sem reescrever). Sem trecho exato, a nota cai. Para nota 0, diga em uma frase curta o que falta.');
  lines.push('- suggestion: só quando a nota é menor que 2. UMA frase, no imperativo, do que mudar neste post (concreta, que um redator aplica sem perguntar nada). Não invente fato, número nem prazo.');
  if (post.imageTexts?.length) lines.push('- O que está na imagem já aparece para quem vê o post: a legenda não deve repetir esse texto, e nenhuma sugestão pode pedir para repeti-lo na legenda. Dê crédito ao que a imagem já traz (lista, passo a passo) quando o critério for de salvamento.');
  lines.push('- Seja exigente: 2 é para o que está claramente bem feito, não para o que é aceitável.');
  lines.push('');
  lines.push('## Formato (JSON)');
  lines.push(`{"criteria":[${RUBRICS[channel].map((c) => `{"id":"${c.id}","score":0,"evidence":"...","suggestion":null}`).join(',')}]}`);
  return lines.join('\n');
}

const plain = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

// O trecho citado precisa existir no post (legenda, texto da capa ou hashtags), comparado sem acento, caixa nem pontuação.
export function evidenceIsInPost(evidence: string, post: PostView): boolean {
  const needle = plain(evidence);
  if (needle.length < 4) return false;
  return plain([post.coverText ?? '', ...(post.imageTexts ?? []), post.text, post.hashtags.join(' ')].join(' ')).includes(needle);
}

const clean = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.replace(/\s*[–—]\s*/g, ', ').replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, max).trim() : null;
};

export function bandOf(criteria: readonly Criterion[]): Band {
  const avg = criteria.reduce((n, c) => n + c.score, 0) / Math.max(criteria.length, 1);
  return avg >= 1.6 ? 'forte' : avg >= 1 ? 'medio' : 'fraco';
}

const RANK: Record<Band, number> = { fraco: 0, medio: 1, forte: 2 };
export const bandRank = (b: Band): number => RANK[b];
export const avgScore = (criteria: readonly Criterion[]): number => criteria.reduce((n, c) => n + c.score, 0) / Math.max(criteria.length, 1);

// Tetos que o código impõe, porque ele sabe contar e o modelo erra de forma otimista (o eval faz o mesmo com o juiz).
function codeCap(channel: CriticChannel, id: string, post: PostView): { max: Score; why: string } | null {
  if (channel === 'linkedin') {
    if (id === 'pergunta' && !post.text.includes('?')) return { max: 0, why: 'O texto não tem nenhuma pergunta.' };
    if (id === 'gancho' && (post.text.split('\n').find((l) => l.trim())?.trim().length ?? 0) > 160) return { max: 1, why: 'A primeira linha passa de 160 caracteres e é cortada antes do "ver mais".' };
    if (id === 'gancho' && hookOf(post.text).length < 30) return { max: 0, why: 'As duas primeiras linhas são curtas demais para prometer algo.' };
  }
  if (channel === 'instagram') {
    if (id === 'chamada' && (post.signal === 'enviar' || post.signal === 'salvar') && !/salv|mand|envi|compartilh/i.test(post.text)) return { max: 0, why: `O post pede "${post.signal}", mas a legenda não pede para ${post.signal === 'salvar' ? 'salvar' : 'enviar'}.` };
    if (id === 'gancho' && post.coverText && post.coverText.split(/\s+/).filter(Boolean).length > 12) return { max: 1, why: 'O texto da capa passa de 12 palavras.' };
  }
  return null;
}

type Parsed = { ok: true; value: Critic } | { ok: false; error: string };

export function parseCritic(json: unknown, channel: CriticChannel, post: PostView): Parsed {
  const o = json && typeof json === 'object' && !Array.isArray(json) ? (json as Record<string, unknown>) : null;
  const list = o && Array.isArray(o.criteria) ? (o.criteria as unknown[]) : null;
  if (!list) return { ok: false, error: 'A avaliação não trouxe a lista de critérios (criteria).' };
  const criteria: Criterion[] = [];
  for (const item of RUBRICS[channel]) {
    const raw = list.find((x) => x && typeof x === 'object' && (x as Record<string, unknown>).id === item.id) as Record<string, unknown> | undefined;
    if (!raw) return { ok: false, error: `A avaliação não trouxe o critério "${item.id}".` };
    const n = typeof raw.score === 'number' ? Math.round(raw.score) : Number.NaN;
    if (!(n >= 0 && n <= 2)) return { ok: false, error: `A nota do critério "${item.id}" precisa ser 0, 1 ou 2.` };
    let score = n as Score;
    let evidence = clean(raw.evidence, 300);
    let suggestion = clean(raw.suggestion, 240);
    // Nota acima de 0 sem trecho não vale; com trecho que não está no post, no máximo 1.
    if (score > 0 && !evidence) score = 0;
    else if (score > 0 && evidence && !evidenceIsInPost(evidence, post)) {
      score = Math.min(score, 1) as Score;
      evidence = null;
    }
    const cap = codeCap(channel, item.id, post);
    if (cap && score > cap.max) {
      score = cap.max;
      evidence = cap.why;
    }
    if (score === 2) suggestion = null;
    criteria.push({ id: item.id, label: item.label, score, evidence, suggestion });
  }
  return { ok: true, value: { channel, band: bandOf(criteria), criteria } };
}

// Os critérios que o conserto automático atende: nota 0 com uma sugestão que dá para aplicar.
export const weakCriteria = (critic: Critic): Criterion[] => critic.criteria.filter((c) => c.score === 0 && !!c.suggestion);

export type FixInput = {
  channel: CriticChannel;
  text: string;
  instructions: string[];
  facts: string[];
  never: string[];
  banned: string[];
  limit: number; // o teto de caracteres do texto
  imageTexts?: string[]; // o texto que já está na imagem: o conserto não o repete
};

export function buildFixPrompt(input: FixInput): string {
  const label = input.channel === 'instagram' ? 'legenda do Instagram' : 'texto do post de LinkedIn';
  const lines: string[] = [];
  lines.push(`Você ajusta a ${label} de uma pequena empresa brasileira. Responda SÓ com um objeto JSON.`);
  lines.push('Faça só as mudanças abaixo e copie o resto igual. Não acrescente fato, número, preço nem prazo que não esteja na lista de fatos.');
  lines.push('');
  lines.push('## Mudanças pedidas');
  lines.push(input.instructions.map((s) => `- ${s}`).join('\n'));
  lines.push('');
  lines.push('## O que a empresa pode afirmar (fatos)');
  lines.push(input.facts.length ? input.facts.map((f) => `- ${f}`).join('\n') : '- (nenhum fato cadastrado)');
  if (input.never.length) lines.push(`\n## Nunca afirma\n${input.never.map((f) => `- ${f}`).join('\n')}`);
  if (input.banned.length) lines.push(`\n## Palavras proibidas: ${input.banned.join(', ')}`);
  lines.push('');
  if (input.imageTexts?.length) lines.push(`## O que já está desenhado na imagem (NÃO repita na legenda)\n${input.imageTexts.map((t) => `- ${t}`).join('\n')}\n`);
  lines.push(`## Regras: frase curta, voz ativa, sem travessão (— ou –), até ${input.limit} caracteres. Hashtags não entram no texto.`);
  lines.push('');
  lines.push(`## ${label[0].toUpperCase()}${label.slice(1)} atual\n"""\n${input.text}\n"""`);
  lines.push('');
  lines.push('## Formato (JSON)');
  lines.push('{"text":"..."}');
  return lines.join('\n');
}

export function parseFix(json: unknown, limit: number): { ok: true; text: string } | { ok: false; error: string } {
  const o = json && typeof json === 'object' && !Array.isArray(json) ? (json as Record<string, unknown>) : null;
  const text = typeof o?.text === 'string' ? o.text.replace(/\r\n?/g, '\n').replace(/\s*[–—]\s*/g, ', ').replace(/\n{3,}/g, '\n\n').trim().slice(0, limit).trim() : '';
  return text ? { ok: true, text } : { ok: false, error: 'O ajuste não devolveu o texto.' };
}

// Lê o que está guardado em generation.critic (jsonb) sem confiar no formato.
export function criticFromStored(raw: unknown): Critic | null {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!o || (o.channel !== 'instagram' && o.channel !== 'linkedin') || !Array.isArray(o.criteria)) return null;
  const channel = o.channel;
  const criteria: Criterion[] = [];
  for (const item of RUBRICS[channel]) {
    const c = (o.criteria as unknown[]).find((x) => x && typeof x === 'object' && (x as Record<string, unknown>).id === item.id) as Record<string, unknown> | undefined;
    if (!c || !(c.score === 0 || c.score === 1 || c.score === 2)) return null;
    criteria.push({ id: item.id, label: item.label, score: c.score, evidence: typeof c.evidence === 'string' ? c.evidence : null, suggestion: typeof c.suggestion === 'string' ? c.suggestion : null });
  }
  return { channel, band: bandOf(criteria), criteria, ...(o.fixed === true ? { fixed: true } : {}) };
}
