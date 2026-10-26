// request-panel.ts: o painel "O que você pediu" da tela Aprovar (SPEC 020, entrega d). Puro: lê o que a geração
// guardou em `generation.directives` e devolve o que a tela desenha. Três estados: tudo aplicado, uma ou mais
// instruções não aplicadas (cada uma com o motivo e, quando dá, o próximo passo) e "não consegui ler".
// Pedido sem instrução (ou post antigo, anterior à SPEC 020) não tem painel.

import { ROUTES } from './app-routes';
import type { GenerationDirectives, PendingApproval } from './types';

export type PanelRow = { text: string; ok: boolean; why?: string; action?: { label: string; href: string } };
export type RequestPanel =
  | { state: 'unread'; idea: string | null }
  | { state: 'applied' | 'partial'; idea: string | null; rows: PanelRow[]; footer: string };

export const PANEL_TITLE = 'O que você pediu';
export const UNREAD_MESSAGE = 'Não consegui ler as instruções do pedido. O post saiu só com o tema. Confira se é o que você queria; se não for, use Pedir ajuste.';
const FOOTER_APPLIED = 'Tudo o que você pediu está no post. Quer mudar algo? Use Pedir ajuste.';
const FOOTER_PARTIAL = 'O que não foi aplicado não trava a aprovação. Se faltar algo, resolva e peça o ajuste: só isso muda e o resto do post fica igual.';

// O próximo passo que a tela oferece: logo ou @ que a conta não tem se resolvem no perfil da empresa.
function actionFor(row: { text: string; why?: string }): PanelRow['action'] {
  if (/cadastrado/i.test(row.why ?? '') && /(logo|@)/i.test(row.text)) return { label: /logo/i.test(row.text) ? 'Enviar o logo' : 'Cadastrar o @', href: ROUTES.company };
  return undefined;
}

// Os itens vêm na ordem do pedido (`items`); post gerado antes disso só tem as duas listas.
function itemsOf(d: GenerationDirectives): { text: string; ok: boolean; why?: string }[] {
  if (d.items) return d.items;
  return [...(d.applied ?? []).map((text) => ({ text, ok: true })), ...(d.notApplied ?? []).map((n) => ({ text: n.what, ok: false, why: n.why }))];
}

export function requestPanelOf(pending: Pick<PendingApproval, 'generation' | 'seed'>): RequestPanel | null {
  const d = pending.generation?.directives;
  if (!d) return null;
  const idea = typeof pending.seed?.idea === 'string' && pending.seed.idea.trim() ? pending.seed.idea.trim() : null;
  if (d.status === 'failed') return { state: 'unread', idea };
  const rows = itemsOf(d).map((i): PanelRow => ({ ...i, ...(actionFor(i) ? { action: actionFor(i) } : {}) }));
  if (!rows.length) return null;
  const partial = rows.some((r) => !r.ok);
  return { state: partial ? 'partial' : 'applied', idea, rows, footer: partial ? FOOTER_PARTIAL : FOOTER_APPLIED };
}
