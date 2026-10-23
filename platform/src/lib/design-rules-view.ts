// design-rules-view.ts: o que a tela Aprendizado › Design do post precisa das regras (SPEC 019, BEZ-279).
// Puro e seguro para o cliente: agrupa as regras por estado e escreve a linha de evidência, sem texto de post.

import type { DesignRule, RuleStatus } from './design/rules-model';

export type RuleLike = Pick<DesignRule, 'id' | 'status' | 'decidedAt' | 'evidence'> & { title: string; explanation: string; createdAt: string };

export type Grouped<T> = { proposed: T[]; active: T[]; off: T[] };

// Dispensada não aparece: a Ekoai só volta a propor depois de 60 dias e de mais 3 posts (SPEC 019, decisão 11).
export function groupRules<T extends { status: RuleStatus; createdAt: string }>(rules: readonly T[]): Grouped<T> {
  const byNew = (a: T, b: T) => (a.createdAt < b.createdAt ? 1 : -1);
  return {
    proposed: rules.filter((r) => r.status === 'proposed').sort(byNew),
    active: rules.filter((r) => r.status === 'active').sort(byNew),
    off: rules.filter((r) => r.status === 'off').sort(byNew),
  };
}

const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

// "Em 3 posts, de 12/10 a 22/10." Contagem e datas; nunca o texto do post.
export function evidenceLine(e: RuleLike['evidence']): string | null {
  const posts = e?.posts;
  if (!posts) return null;
  const when = e?.first_at && e?.last_at ? (dm(e.first_at) === dm(e.last_at) ? `, em ${dm(e.first_at)}` : `, de ${dm(e.first_at)} a ${dm(e.last_at)}`) : '';
  return `Em ${posts} ${posts === 1 ? 'post' : 'posts'}${when}.`;
}

export const ACTION_ERROR = 'Não foi possível concluir. Nada foi alterado. Tente de novo.';
// O servidor escreve a mensagem de regra de negócio (4xx); erro dele mesmo (5xx) vira a frase com o próximo passo.
export const actionError = (status: number, error: unknown): string => (status >= 500 || typeof error !== 'string' || !error ? ACTION_ERROR : error);
