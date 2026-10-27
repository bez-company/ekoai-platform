// As categorias de aviso e o corpo da rota de preferências (BEZ-366). Puro: sem banco.
import { describe, it, expect } from 'vitest';
import { CATEGORIES, categoryOf, isMuted, mutedInApp, parsePrefChange, withDefaults } from '../platform/src/lib/notification-prefs-model.ts';

describe('categoryOf', () => {
  it('cada kind de aviso do código cai em uma categoria', () => {
    expect(categoryOf('publish.ok')).toBe('publication');
    expect(categoryOf('publish.failed')).toBe('publication');
    expect(categoryOf('publishing.paused')).toBe('publication');
    expect(categoryOf('schedule.created')).toBe('publication');
    expect(categoryOf('post.failed')).toBe('publication');
    expect(categoryOf('post.ready')).toBe('approval');
    expect(categoryOf('pending.stale')).toBe('approval');
    expect(categoryOf('suggestions.week')).toBe('planning');
    expect(categoryOf('design.rule_proposed')).toBe('planning');
    expect(categoryOf('campaign.ended')).toBe('planning');
    expect(categoryOf('instagram.reauth')).toBe('connection');
    expect(categoryOf('team.member_joined')).toBe('account');
    expect(categoryOf('account.created')).toBe('account');
  });

  it('kind desconhecido não é configurável e sempre aparece; prefixo parecido não vale', () => {
    expect(categoryOf('algo.novo')).toBeNull();
    expect(categoryOf('publisher.x')).toBeNull();
    expect(categoryOf('postx')).toBeNull();
    expect(isMuted('algo.novo', new Set(CATEGORIES))).toBe(false);
  });
});

describe('preferências', () => {
  it('sem linha guardada tudo vem ligado nos dois canais', () => {
    const prefs = withDefaults([]);
    expect(prefs.map((p) => p.category)).toEqual([...CATEGORIES]);
    expect(prefs.every((p) => p.inApp && p.email)).toBe(true);
  });

  it('a linha guardada vale só para a sua categoria', () => {
    const prefs = withDefaults([{ category: 'approval', in_app: false, email: true }]);
    expect(prefs.find((p) => p.category === 'approval')).toEqual({ category: 'approval', inApp: false, email: true });
    expect(prefs.find((p) => p.category === 'publication')).toEqual({ category: 'publication', inApp: true, email: true });
    const muted = mutedInApp(prefs);
    expect(isMuted('post.ready', muted)).toBe(true);
    expect(isMuted('publish.ok', muted)).toBe(false);
  });
});

describe('parsePrefChange', () => {
  it('aceita um canal ou os dois', () => {
    expect(parsePrefChange({ category: 'approval', inApp: false })).toEqual({ ok: true, value: { category: 'approval', inApp: false } });
    expect(parsePrefChange({ category: 'planning', email: false, inApp: true })).toEqual({ ok: true, value: { category: 'planning', inApp: true, email: false } });
  });

  it('recusa categoria inválida, tipo errado e corpo sem canal, com o próximo passo', () => {
    for (const body of [null, {}, { category: 'x', inApp: true }, { category: 'approval' }, { category: 'approval', inApp: 'sim' }, [], 'approval']) {
      const r = parsePrefChange(body);
      expect(r.ok, JSON.stringify(body)).toBe(false);
      expect(r.error).toMatch(/\./);
    }
  });
});
