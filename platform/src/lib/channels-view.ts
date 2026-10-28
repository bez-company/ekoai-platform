// channels-view.ts: o que a tela Configurações › Redes mostra do Instagram (SPEC 011 R5). Puro, sem
// I/O: recebe as contas já lidas e devolve o estado da tela, para testar cada caso sem navegador.

import { daysUntil } from './instagram-oauth-model';
import type { SocialAccount } from './social-accounts';

// Aviso de vencimento: o token dura 60 dias e a renovação roda antes; abaixo disto a tela destaca.
export const EXPIRING_SOON_DAYS = 14;

export type InstagramView =
  | { kind: 'none'; canConnect: boolean; blockedReason: string | null }
  | { kind: 'connected'; id: string; handle: string | null; daysLeft: number | null; expiringSoon: boolean }
  | { kind: 'reauth'; id: string; handle: string | null };

export type InstagramViewInput = {
  accounts: readonly SocialAccount[];
  configured: boolean; // INSTAGRAM_APP_ID e INSTAGRAM_APP_SECRET existem neste ambiente
  canManage: boolean; // channels.manage
  maxAccounts: number | null; // limite do plano (null = sem limite)
  nowMs: number;
};

export function instagramView(input: InstagramViewInput): InstagramView {
  const live = input.accounts.filter((a) => a.channel === 'instagram' && a.status !== 'revoked');
  const current = live.find((a) => a.status === 'active') ?? live[0];

  if (current) {
    const daysLeft = daysUntil(current.expiresAt, input.nowMs);
    const expired = current.status === 'reauth_required' || daysLeft === 0;
    if (expired) return { kind: 'reauth', id: current.id, handle: current.handle };
    return {
      kind: 'connected',
      id: current.id,
      handle: current.handle,
      daysLeft,
      expiringSoon: daysLeft !== null && daysLeft <= EXPIRING_SOON_DAYS,
    };
  }

  if (!input.canManage) return { kind: 'none', canConnect: false, blockedReason: 'Só administradores conectam o Instagram. Peça a quem administra a conta.' };
  if (!input.configured) return { kind: 'none', canConnect: false, blockedReason: 'A conexão com o Instagram ainda não está ativa neste ambiente. Avise o suporte.' };
  if (input.maxAccounts !== null && live.length >= input.maxAccounts) {
    return { kind: 'none', canConnect: false, blockedReason: 'O plano da conta não inclui mais contas de Instagram.' };
  }
  return { kind: 'none', canConnect: true, blockedReason: null };
}

// LinkedIn (SPEC 028, BEZ-423): perfil pessoal, um por conta da Ekoai, sem limite de plano. O nome do perfil faz o papel do @.
export type LinkedInView =
  | { kind: 'none'; canConnect: boolean; blockedReason: string | null }
  | { kind: 'connected'; id: string; handle: string | null; daysLeft: number | null; expiringSoon: boolean }
  | { kind: 'reauth'; id: string; handle: string | null };

export type LinkedInViewInput = { accounts: readonly SocialAccount[]; configured: boolean; canManage: boolean; nowMs: number };

export function linkedinView(input: LinkedInViewInput): LinkedInView {
  const live = input.accounts.filter((a) => a.channel === 'linkedin' && a.status !== 'revoked');
  const current = live.find((a) => a.status === 'active') ?? live[0];

  if (current) {
    const daysLeft = daysUntil(current.expiresAt, input.nowMs);
    if (current.status === 'reauth_required' || daysLeft === 0) return { kind: 'reauth', id: current.id, handle: current.handle };
    return { kind: 'connected', id: current.id, handle: current.handle, daysLeft, expiringSoon: daysLeft !== null && daysLeft <= EXPIRING_SOON_DAYS };
  }

  if (!input.canManage) return { kind: 'none', canConnect: false, blockedReason: 'Só administradores conectam o LinkedIn. Peça a quem administra a conta.' };
  if (!input.configured) return { kind: 'none', canConnect: false, blockedReason: 'A conexão com o LinkedIn ainda não está ativa neste ambiente. Avise o suporte.' };
  return { kind: 'none', canConnect: true, blockedReason: null };
}
