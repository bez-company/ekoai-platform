import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as v from '../platform/src/lib/notice-view.ts';

// Meio-dia de 20/10/2026 em Brasília (UTC-3), com o fuso padrão da plataforma.
const NOW = Date.parse('2026-10-20T15:00:00Z');
const at = (iso) => new Date(iso).toISOString();
const row = (id, createdAt, over = {}) => ({ id, kind: 'k', level: 'info', title: `aviso ${id}`, body: null, link: null, createdAt, unread: false, ...over });
let tz;
beforeEach(() => { tz = process.env.NEXT_PUBLIC_PUBLISH_TZ_OFFSET; delete process.env.NEXT_PUBLIC_PUBLISH_TZ_OFFSET; delete process.env.PUBLISH_TZ_OFFSET; });
afterEach(() => { if (tz !== undefined) process.env.NEXT_PUBLIC_PUBLISH_TZ_OFFSET = tz; });

describe('quem vê qual aviso', () => {
  it('administrador lê tudo, criador a equipe e o geral, leitor só o geral', () => {
    expect(v.AUDIENCES_BY_ROLE.admin).toEqual(['admin', 'team', 'all']);
    expect(v.AUDIENCES_BY_ROLE.creator).toEqual(['team', 'all']);
    expect(v.AUDIENCES_BY_ROLE.viewer).toEqual(['all']);
  });

  it('reconhece só os três públicos', () => {
    for (const a of ['admin', 'team', 'all']) expect(v.isAudience(a)).toBe(true);
    for (const a of ['viewer', 'ALL', '', null, undefined, 3]) expect(v.isAudience(a)).toBe(false);
  });
});

describe('tom por nível', () => {
  it('erro vira danger, aviso vira warning, o resto é info', () => {
    expect(v.toneOf('error')).toBe('danger');
    expect(v.toneOf('warning')).toBe('warning');
    expect(v.toneOf('info')).toBe('info');
    expect(v.toneOf('qualquer')).toBe('info');
  });
});

describe('dia e horário', () => {
  it('rótulo do dia no fuso de Brasília', () => {
    expect(v.dayLabel(at('2026-10-20T12:12:00Z'), NOW)).toBe('Hoje');
    expect(v.dayLabel(at('2026-10-19T20:05:00Z'), NOW)).toBe('Ontem');
    expect(v.dayLabel(at('2026-10-15T13:00:00Z'), NOW)).toBe('Esta semana');
    expect(v.dayLabel(at('2026-10-01T13:00:00Z'), NOW)).toBe('Antes');
  });

  it('a virada do dia é a de Brasília, não a de UTC', () => {
    // 20/10 01:30 UTC ainda é 19/10 22:30 em Brasília: "ontem" para quem olha às 12h de 20/10.
    expect(v.dayLabel(at('2026-10-20T01:30:00Z'), NOW)).toBe('Ontem');
  });

  it('texto do horário', () => {
    expect(v.noticeWhen(at('2026-10-20T12:12:00Z'), NOW)).toBe('Hoje, 09:12');
    expect(v.noticeWhen(at('2026-10-19T20:05:00Z'), NOW)).toBe('Ontem, 17:05');
    expect(v.noticeWhen(at('2026-10-12T13:22:00Z'), NOW)).toBe('12/10, 10:22');
  });

  it('agrupa em sequência, na ordem em que vieram', () => {
    const groups = v.groupNotices([row(1, at('2026-10-20T12:00:00Z')), row(2, at('2026-10-20T11:00:00Z')), row(3, at('2026-10-19T20:00:00Z')), row(4, at('2026-10-10T13:00:00Z'))], NOW);
    expect(groups.map((g) => [g.label, g.items.map((i) => i.id)])).toEqual([['Hoje', [1, 2]], ['Ontem', [3]], ['Antes', [4]]]);
    expect(v.groupNotices([], NOW)).toEqual([]);
  });
});

describe('rótulo do sino', () => {
  it('diz quantos são novos, no singular e no plural', () => {
    expect(v.bellLabel(0)).toBe('Avisos');
    expect(v.bellLabel(1)).toBe('Avisos, 1 novo');
    expect(v.bellLabel(3)).toBe('Avisos, 3 novos');
  });
});
