// screens.ts: a lista única de telas do menu, cada uma com a permissão que a abre (SPEC 011 R6,
// regra de docs/arquitetura/usuario.md). O menu mostra só o que a pessoa pode abrir; a própria
// tela responde 404 para quem não pode (o guarda mora na página ou no layout dela).

import type { Permission } from './permissions';

export type ScreenIcon = 'home' | 'inbox' | 'calendar' | 'chart' | 'spark' | 'settings';

export type Screen = { href: string; label: string; icon: ScreenIcon; permission: Permission };

export const SCREENS: readonly Screen[] = [
  { href: '/', label: 'Início', icon: 'home', permission: 'content.view' },
  { href: '/inbox', label: 'Aprovar', icon: 'inbox', permission: 'content.view' },
  { href: '/calendar', label: 'Agenda', icon: 'calendar', permission: 'content.view' },
  { href: '/history', label: 'Publicados', icon: 'chart', permission: 'content.view' },
  { href: '/learning', label: 'Aprendizado', icon: 'spark', permission: 'content.view' },
  // O leitor não vê configuração da conta: quem tem o perfil da empresa à vista (admin e criador).
  { href: '/settings', label: 'Configurações', icon: 'settings', permission: 'profile.view' },
];

export function screensFor(allowed: (permission: Permission) => boolean): Screen[] {
  return SCREENS.filter((s) => allowed(s.permission));
}

// "/" só vale para a própria raiz; os outros itens valem também para as rotas abaixo deles.
export function isActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}
