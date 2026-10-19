// engage-model.ts: engajamento no LinkedIn (SPEC 005 R3). Lê o link do post ou do
// comentário, monta o prompt das sugestões e aplica os limites antes de publicar.
// Puro, sem I/O: serve às rotas (fronteira), ao cliente e aos testes.

export type EngageKind = 'comentario' | 'resposta';

export type LinkedinTarget = {
  kind: EngageKind;
  object: string; // post: urn:li:activity|share|ugcPost
  parentComment: string | null; // resposta: urn:li:comment:(urn:li:activity:X,Y)
};

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

// Limites (os mesmos do bloco `engage` em src/tenant.js). Todo comentário passa por clique.
export const ENGAGE_LIMITS = {
  weeklyGoal: Number(process.env.ENGAGE_WEEKLY_GOAL || 15),
  dailyCap: Number(process.env.ENGAGE_DAILY_CAP || 20),
  minIntervalSeconds: Number(process.env.ENGAGE_MIN_INTERVAL_S || 60),
};

const POST_URN = /urn:li:(activity|share|ugcPost):(\d+)/;
const COMMENT_URN = /urn:li:comment:\((?:urn:li:)?(activity|share|ugcPost):(\d+),(\d+)\)/;

// Aceita link de post (feed/update/urn..., /posts/...-activity-ID-...), link de comentário
// (com ?commentUrn=...) ou a URN crua. Recusa perfil, empresa e link de fora do LinkedIn.
export function parseLinkedinTarget(input: string): Parsed<LinkedinTarget> {
  const raw = String(input || '').trim();
  if (!raw) return { ok: false, error: 'Cole o link do post no LinkedIn.' };

  let text = raw;
  if (/^https?:\/\//i.test(raw)) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return { ok: false, error: 'Link inválido. Copie o link pelo menu "..." do post.' };
    }
    if (!/(^|\.)linkedin\.com$/i.test(url.hostname)) return { ok: false, error: 'O link precisa ser do LinkedIn.' };
    if (/^\/(in|company|school)\//.test(url.pathname)) {
      return { ok: false, error: 'Esse é um link de perfil. Abra o post e copie o link dele.' };
    }
    text = `${decodeURIComponent(url.pathname)} ${url.searchParams.get('commentUrn') || ''}`;
    const activity = url.pathname.match(/-activity-(\d+)-/);
    if (activity && !POST_URN.test(text)) text += ` urn:li:activity:${activity[1]}`;
  }

  const comment = text.match(COMMENT_URN);
  if (comment) {
    const object = `urn:li:${comment[1]}:${comment[2]}`;
    return { ok: true, value: { kind: 'resposta', object, parentComment: `urn:li:comment:(${object},${comment[3]})` } };
  }
  const post = text.match(POST_URN);
  if (post) return { ok: true, value: { kind: 'comentario', object: `urn:li:${post[1]}:${post[2]}`, parentComment: null } };
  return { ok: false, error: 'Não achei o post nesse link. Use "Copiar link do post" no menu "..." do LinkedIn.' };
}

// Genérica até o perfil da empresa existir (SPEC 011 R3); aí a persona sai do perfil da conta.
export const PERSONA = 'responsável pela marca, que escreve seco, concreto e sem buzzword';

export function buildEngagePrompt(input: {
  kind: EngageKind;
  targetText: string;
  author?: string | null;
  rules?: string[];
  avoid?: string[];
  n?: number;
}): string {
  const n = input.n ?? 3;
  const who = input.author ? ` de ${input.author}` : '';
  const task =
    input.kind === 'resposta'
      ? [
          `Alguém comentou${who} num post seu. Escreva ${n} opções de resposta.`,
          'Responda ao ponto da pessoa, sem agradecimento genérico. 1 a 2 frases. Pode terminar com uma pergunta que puxe a conversa.',
        ]
      : [
          `Você vai comentar no post${who} abaixo. Escreva ${n} opções de comentário de VALOR.`,
          'Cada opção acrescenta uma experiência ou uma ideia concreta, 1 a 3 frases. Nada de elogio vazio, nada promocional.',
          'Nunca cite a sua marca nem o seu produto. Valor primeiro.',
        ];
  return [
    `Você é ${PERSONA}. Português do Brasil.`,
    ...task,
    'As opções devem ser diferentes entre si (ângulos diferentes), não variações da mesma frase.',
    input.rules?.length ? `\nRegras aprendidas (siga à risca):\n${input.rules.map((r) => `- ${r}`).join('\n')}` : '',
    input.avoid?.length ? `\nO editor reclamou disso recentemente (evite):\n${input.avoid.map((r) => `- ${r}`).join('\n')}` : '',
    `\n${input.kind === 'resposta' ? 'Comentário' : 'Post'}:\n${input.targetText}`,
    '\nResponda só JSON: {"options":["...","...","..."]}',
  ]
    .filter(Boolean)
    .join('\n');
}

// Valida a saída do modelo: só textos não vazios, sem repetição, até n.
export function normalizeOptions(raw: unknown, n = 3): string[] {
  const list = Array.isArray((raw as { options?: unknown })?.options) ? (raw as { options: unknown[] }).options : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    const text = (typeof item === 'string' ? item : (item as { text?: string })?.text || '').trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out.slice(0, n);
}

// Limite diário e intervalo mínimo entre comentários publicados pela API.
export function checkRateLimit(input: {
  postedToday: number;
  lastPostedAt: string | null;
  now?: Date;
  limits?: typeof ENGAGE_LIMITS;
}): { ok: true } | { ok: false; error: string } {
  const limits = input.limits ?? ENGAGE_LIMITS;
  const now = input.now ?? new Date();
  if (input.postedToday >= limits.dailyCap) {
    return { ok: false, error: `Limite de ${limits.dailyCap} comentários por dia atingido. Volte amanhã ou copie e publique à mão.` };
  }
  if (input.lastPostedAt) {
    const waitMs = new Date(input.lastPostedAt).getTime() + limits.minIntervalSeconds * 1000 - now.getTime();
    if (waitMs > 0) return { ok: false, error: `Espere ${Math.ceil(waitMs / 1000)} s antes do próximo comentário.` };
  }
  return { ok: true };
}

// Erros da API em que vale oferecer "copiar e abrir": permissão do app, URN não aceita, limite.
export function shouldOfferCopy(error: string): boolean {
  return /LinkedIn API (400|401|403|404|422|429)/.test(error);
}

export type DraftInput = { url: string; targetText: string; author: string | null; target: LinkedinTarget };

export function parseDraftInput(body: unknown): Parsed<DraftInput> {
  const b = (body ?? {}) as Record<string, unknown>;
  const target = parseLinkedinTarget(String(b.url ?? ''));
  if (!target.ok) return target;
  const targetText = typeof b.targetText === 'string' ? b.targetText.trim() : '';
  if (targetText.length < 20) return { ok: false, error: 'Cole o texto do post (ou do comentário) para eu sugerir algo que faça sentido.' };
  const author = typeof b.author === 'string' && b.author.trim() ? b.author.trim().slice(0, 120) : null;
  return { ok: true, value: { url: String(b.url).trim(), targetText: targetText.slice(0, 4000), author, target: target.value } };
}

export function parseCommentText(body: unknown): Parsed<{ id: string; text: string }> {
  const b = (body ?? {}) as Record<string, unknown>;
  const id = typeof b.id === 'string' ? b.id : '';
  const text = typeof b.text === 'string' ? b.text.trim() : '';
  if (!id) return { ok: false, error: 'Rascunho não encontrado. Gere as sugestões de novo.' };
  if (!text) return { ok: false, error: 'Escreva o comentário antes de publicar.' };
  if (text.length > 1250) return { ok: false, error: 'Comentário longo demais para o LinkedIn (até 1250 caracteres).' };
  return { ok: true, value: { id, text } };
}

// Segunda-feira 00h no fuso editorial (BRT), em ISO: início da semana da meta.
export function weekStartIso(now = new Date(), offsetHours = -3): string {
  const local = new Date(now.getTime() + offsetHours * 3600 * 1000);
  const day = (local.getUTCDay() + 6) % 7;
  const monday = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - day);
  return new Date(monday - offsetHours * 3600 * 1000).toISOString();
}

export function dayStartIso(now = new Date(), offsetHours = -3): string {
  const local = new Date(now.getTime() + offsetHours * 3600 * 1000);
  const start = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  return new Date(start - offsetHours * 3600 * 1000).toISOString();
}

export function parseTargetInput(body: unknown): Parsed<{ name: string; profile_url: string; note: string | null }> {
  const b = (body ?? {}) as Record<string, unknown>;
  const name = typeof b.name === 'string' ? b.name.trim().slice(0, 120) : '';
  if (!name) return { ok: false, error: 'Dê um nome para a conta.' };
  let url: URL;
  try {
    url = new URL(String(b.profile_url ?? '').trim());
  } catch {
    return { ok: false, error: 'Cole o link do perfil ou da página no LinkedIn.' };
  }
  if (!/(^|\.)linkedin\.com$/i.test(url.hostname) || !/^\/(in|company)\/[^/]+/.test(url.pathname)) {
    return { ok: false, error: 'Use um link de perfil (linkedin.com/in/...) ou de página (linkedin.com/company/...).' };
  }
  const base = url.pathname.match(/^\/(in|company)\/[^/]+/)![0];
  const note = typeof b.note === 'string' && b.note.trim() ? b.note.trim().slice(0, 300) : null;
  return { ok: true, value: { name, profile_url: `https://www.linkedin.com${base}/`, note } };
}

// Atalho pra atividade recente da conta (onde aparecem os posts pra comentar).
export function activityUrl(profileUrl: string): string {
  const base = profileUrl.replace(/\/+$/, '');
  return base.includes('/company/') ? `${base}/posts/` : `${base}/recent-activity/all/`;
}
