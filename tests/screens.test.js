import { describe, it, expect } from 'vitest';
import * as s from '../platform/src/lib/screens.ts';

const grant = (...p) => (permission) => p.includes(permission);

describe('menu por permissão', () => {
  it('administrador e criador veem tudo; o leitor vê Campanhas, mas não Banco de imagens nem Configurações', () => {
    const admin = s.screensFor(grant('content.view', 'content.create', 'profile.view', 'team.manage')).map((x) => x.label);
    expect(admin).toEqual(['Início', 'Aprovar', 'Agenda', 'Campanhas', 'Publicados', 'Banco de imagens', 'Aprendizado', 'Configurações']);
    expect(s.screensFor(grant('content.view', 'content.create', 'profile.view')).map((x) => x.label)).toEqual(admin);
    expect(s.screensFor(grant('content.view')).map((x) => x.label)).toEqual(['Início', 'Aprovar', 'Agenda', 'Campanhas', 'Publicados', 'Aprendizado']);
  });

  it('no celular, a barra de baixo tem as quatro telas do dia a dia; o resto vai para Mais', () => {
    for (const href of s.MOBILE_PRIMARY) expect(s.SCREENS.some((x) => x.href === href)).toBe(true);
  });

  it('sem nenhuma permissão o menu fica vazio', () => {
    expect(s.screensFor(grant())).toEqual([]);
  });

  it('toda tela da lista tem caminho único e permissão declarada', () => {
    expect(new Set(s.SCREENS.map((x) => x.href)).size).toBe(s.SCREENS.length);
    for (const x of s.SCREENS) expect(x.permission).toMatch(/^[a-z]+\.[a-z]+$/);
  });
});

describe('item ativo', () => {
  it('cada item vale para o próprio caminho e para as rotas abaixo dele', () => {
    expect(s.isActive('/inicio', '/inicio')).toBe(true);
    expect(s.isActive('/aprovar', '/inicio')).toBe(false);
    expect(s.isActive('/configuracoes/equipe', '/configuracoes')).toBe(true);
    expect(s.isActive('/configuracoes', '/configuracoes')).toBe(true);
    expect(s.isActive('/configuracoesx', '/configuracoes')).toBe(false);
    expect(s.isActive(null, '/inicio')).toBe(false);
  });
});
