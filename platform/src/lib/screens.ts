// screens.ts: a lista única de telas do menu, cada uma com a permissão que a abre (SPEC 011 R6,
// regra de docs/arquitetura/usuario.md). O menu mostra só o que a pessoa pode abrir; a própria
// tela responde 404 para quem não pode (o guarda mora na página ou no layout dela).

import type { Permission } from './permissions';

export type ScreenIcon = 'home' | 'inbox' | 'calendar' | 'flag' | 'chart' | 'image' | 'spark' | 'settings';

export type Screen = { href: string; label: string; icon: ScreenIcon; permission: Permission };

export const SCREENS: readonly Screen[] = [
  { href: '/inicio', label: 'Início', icon: 'home', permission: 'content.view' },
  { href: '/aprovar', label: 'Aprovar', icon: 'inbox', permission: 'content.view' },
  { href: '/agenda', label: 'Agenda', icon: 'calendar', permission: 'content.view' },
  // Campanhas (SPEC 018): o que a empresa quer alcançar; o coordenador monta a semana a partir disso. Todos leem, só quem gere a marca cria.
  { href: '/campanhas', label: 'Campanhas', icon: 'flag', permission: 'content.view' },
  { href: '/historico', label: 'Publicados', icon: 'chart', permission: 'content.view' },
  // Banco de imagens (SPEC 017, BEZ-198): quem cria post sobe e escolhe fotos; o leitor não vê.
  { href: '/midia', label: 'Banco de imagens', icon: 'image', permission: 'content.create' },
  { href: '/aprendizado', label: 'Aprendizado', icon: 'spark', permission: 'content.view' },
  // O leitor não vê configuração da conta: quem tem o perfil da empresa à vista (admin e criador).
  { href: '/configuracoes', label: 'Configurações', icon: 'settings', permission: 'profile.view' },
];

// No celular, a barra de baixo mostra estas; o resto fica em "Mais".
export const MOBILE_PRIMARY = ['/inicio', '/aprovar', '/agenda', '/historico'] as const;

export function screensFor(allowed: (permission: Permission) => boolean): Screen[] {
  return SCREENS.filter((s) => allowed(s.permission));
}

// O item vale para o próprio caminho e para as rotas abaixo dele.
export function isActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}
