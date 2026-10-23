// clickup-pr-sync.js: liga a PR ao card do ClickUp pelo `[BEZ-N]` do título e move o card.
//
//   PR aberta ou título editado: comenta o link da PR no card (uma vez) e leva para In Review.
//   PR mergeada na staging: leva para Staging. Done é da release (scripts/clickup-release.sh).
//
// O card é o que tem o nome começando por `[BEZ-N] ` no workspace da BEZ. O ClickUp gratuito não
// tem automação nem ID customizado, então é esta Action que faz o papel da integração do GitHub.
// Roda pelo workflow .github/workflows/clickup-sync.yml com CLICKUP_API_TOKEN. Sem o token, avisa
// e sai sem erro (não derruba nada). Nunca regride um card (Done, Staging e Canceled ficam).
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const API = 'https://api.clickup.com/api/v2';

/** `[BEZ-296] fix(x): ...` -> `BEZ-296`; título sem o prefixo -> null. */
export function cardRef(title) {
  const m = /^\s*\[(BEZ-\d+)\]\s/.exec(title ?? '');
  return m ? m[1] : null;
}

/** Evento do webhook de PR -> 'open' | 'merged' | null (só PR para a staging conta). */
export function prEvent({ action, merged, base }) {
  if (base !== 'staging') return null;
  if (action === 'closed') return merged ? 'merged' : null;
  return ['opened', 'reopened', 'ready_for_review', 'edited'].includes(action) ? 'open' : null;
}

const FROM = {
  open: { 'backlog': 'in review', 'todo': 'in review', 'in progress': 'in review' },
  merged: { 'backlog': 'staging', 'todo': 'staging', 'in progress': 'staging', 'in review': 'staging' },
};

/** Status novo do card, ou null quando não deve mexer (já adiante, Done, Canceled). */
export function targetStatus(event, current) {
  return FROM[event]?.[current] ?? null;
}

async function call(token, path, init = {}) {
  const res = await fetch(`${API}/${path}`, {
    ...init,
    headers: { Authorization: token, 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`ClickUp ${init.method ?? 'GET'} ${path.split('?')[0]}: ${res.status}`);
  return res.json();
}

async function findCard(token, ref) {
  const { teams } = await call(token, 'team');
  const prefix = `[${ref}] `;
  for (let page = 0; page < 10; page++) {
    const { tasks } = await call(token, `team/${teams[0].id}/task?include_closed=true&subtasks=true&page=${page}`);
    const hit = tasks.find((t) => t.name.startsWith(prefix));
    if (hit) return { id: hit.id, status: hit.status.status };
    if (tasks.length < 100) break;
  }
  return null;
}

export async function sync({ token, ref, event, prUrl, prNumber, log = console }) {
  const card = await findCard(token, ref);
  if (!card) return log.log(`::warning::card ${ref} não encontrado no ClickUp`);

  const comments = await call(token, `task/${card.id}/comment`);
  if (!comments.comments.some((c) => c.comment_text?.includes(prUrl))) {
    await call(token, `task/${card.id}/comment`, {
      method: 'POST',
      body: JSON.stringify({ comment_text: `PR #${prNumber}: ${prUrl}` }),
    });
    log.log(`${ref}: link da PR #${prNumber} comentado`);
  }

  const next = targetStatus(event, card.status);
  if (!next) return log.log(`${ref} está em "${card.status}": status mantido`);
  await call(token, `task/${card.id}`, { method: 'PUT', body: JSON.stringify({ status: next }) });
  log.log(`${ref}: ${card.status} -> ${next}`);
}

async function main() {
  const { action, pull_request: pr } = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const event = prEvent({ action, merged: pr.merged, base: pr.base.ref });
  const ref = cardRef(pr.title);
  if (!event) return console.log(`evento ${action} na base ${pr.base.ref}: nada a fazer`);
  if (!ref) return console.log('título sem `[BEZ-N]`: nada a fazer');
  const token = process.env.CLICKUP_API_TOKEN;
  if (!token) return console.log('::warning::CLICKUP_API_TOKEN ausente: mova o card à mão');
  await sync({ token, ref, event, prUrl: pr.html_url, prNumber: pr.number });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.log(`::warning::${err.message}`);
  });
}
