import { describe, it, expect } from 'vitest';
import * as o from '../platform/src/lib/onboarding.ts';

const base = { role: 'admin', kind: 'empresa', hasProfile: false, profileComplete: false, instagramConnected: false, teamStarted: false, skipped: [] };
const ids = (c, status) => c.items.filter((i) => i.status === status).map((i) => i.id);

describe('checklist do Início', () => {
  it('leitor não tem checklist', () => {
    expect(o.buildChecklist({ ...base, role: 'viewer' })).toBeNull();
  });

  it('conta nova de empresa: três passos a fazer, o perfil leva ao cadastro em passos', () => {
    const c = o.buildChecklist(base);
    expect(c).toMatchObject({ resolved: 0, total: 3, complete: false });
    expect(c.items.map((i) => i.id)).toEqual(['profile', 'instagram', 'team']);
    expect(c.items[0].actions).toEqual([{ kind: 'link', label: 'Preencher perfil', href: '/onboarding' }]);
    expect(o.checklistSummary(c)).toBe('Faltam 3 passos para a conta ficar pronta.');
  });

  it('perfil começado leva a Configurações; completo vira feito e perde a ação', () => {
    expect(o.buildChecklist({ ...base, hasProfile: true }).items[0].actions[0]).toMatchObject({ label: 'Completar perfil', href: '/settings/company' });
    const done = o.buildChecklist({ ...base, hasProfile: true, profileComplete: true });
    expect(done.items[0]).toMatchObject({ status: 'done', actions: [] });
  });

  it('Instagram: administrador pendente recebe o link para conectar; conectado vira feito', () => {
    expect(o.buildChecklist(base).items[1]).toMatchObject({ status: 'todo', actions: [{ kind: 'link', label: 'Conectar Instagram', href: '/settings/channels' }] });
    expect(o.buildChecklist({ ...base, instagramConnected: true }).items[1].status).toBe('done');
  });

  it('equipe: convidar ou pular; equipe começada conta como feito; pulada dá para voltar', () => {
    expect(o.buildChecklist(base).items[2].actions.map((a) => a.kind)).toEqual(['link', 'skip']);
    expect(o.buildChecklist({ ...base, teamStarted: true }).items[2]).toMatchObject({ status: 'done', actions: [] });
    const skipped = o.buildChecklist({ ...base, skipped: ['team'] });
    expect(skipped.items[2]).toMatchObject({ status: 'skipped', actions: [{ kind: 'unskip', label: 'Mostrar de novo' }] });
    expect(skipped.resolved).toBe(1);
    expect(o.buildChecklist({ ...base, teamStarted: true, skipped: ['team'] }).items[2].status).toBe('done');
  });

  it('conta pessoa não tem o passo da equipe', () => {
    const c = o.buildChecklist({ ...base, kind: 'pessoa' });
    expect(c.items.map((i) => i.id)).toEqual(['profile', 'instagram']);
    expect(c.total).toBe(2);
  });

  it('criador vê o checklist sem nenhuma ação e com o aviso de quem configura', () => {
    const c = o.buildChecklist({ ...base, role: 'creator' });
    for (const i of c.items) expect(i.actions).toEqual([]);
    expect(c.items[0].note).toMatch(/Só administradores/);
    expect(c.items[1].note).toMatch(/Só administradores/);
  });

  it('tudo resolvido: completo, e a frase fala no singular quando falta um', () => {
    const all = o.buildChecklist({ ...base, hasProfile: true, profileComplete: true, instagramConnected: true, skipped: ['team'] });
    expect(all).toMatchObject({ complete: true, resolved: 3 });
    expect(o.checklistSummary(all)).toBe('A conta está pronta.');
    const one = o.buildChecklist({ ...base, hasProfile: true, profileComplete: true, instagramConnected: true });
    expect(ids(one, 'todo')).toEqual(['team']);
    expect(o.checklistSummary(one)).toBe('Falta 1 passo para a conta ficar pronta.');
  });

  it('só o passo da equipe é pulável', () => {
    expect(o.isSkippable('team')).toBe(true);
    for (const v of ['profile', 'instagram', '', null, undefined, 3]) expect(o.isSkippable(v)).toBe(false);
  });
});

describe('perguntas rápidas do onboarding (SPEC 017, decisão 11)', () => {
  it('aceita as três respostas e cada uma pode ficar em branco', () => {
    expect(o.parseOnboardingAnswers({ source: 'instagram', goal: 'vender_mais', postsPerWeek: 3 })).toEqual({ ok: true, value: { source: 'instagram', goal: 'vender_mais', postsPerWeek: 3 } });
    expect(o.parseOnboardingAnswers({})).toEqual({ ok: true, value: { source: null, goal: null, postsPerWeek: null } });
    expect(o.parseOnboardingAnswers({ source: '', goal: null, postsPerWeek: '' }).ok).toBe(true);
  });

  it('recusa valor fora da lista, com o campo e o próximo passo', () => {
    expect(o.parseOnboardingAnswers({ postsPerWeek: 4 })).toMatchObject({ ok: false, field: 'postsPerWeek' });
    expect(o.parseOnboardingAnswers({ postsPerWeek: '3' })).toMatchObject({ ok: false, field: 'postsPerWeek' });
    expect(o.parseOnboardingAnswers({ source: 'tv' })).toMatchObject({ ok: false, field: 'source' });
    expect(o.parseOnboardingAnswers({ goal: 'ficar_rico' })).toMatchObject({ ok: false, field: 'goal' });
    for (const bad of [null, [], 'x']) expect(o.parseOnboardingAnswers(bad).ok).toBe(false);
  });

  it('horários padrão: 2 = ter e qui, 3 = ter, qui e sáb, 5 = seg a sex, sempre às 18h no Instagram', () => {
    const days = (n) => o.defaultSlots(n).map((s) => s.weekday);
    expect(days(2)).toEqual([2, 4]);
    expect(days(3)).toEqual([2, 4, 6]);
    expect(days(5)).toEqual([1, 2, 3, 4, 5]);
    for (const s of o.defaultSlots(3)) expect(s).toMatchObject({ channel: 'instagram', hour: 18, minute: 0 });
  });
});

describe('guia até a primeira publicação (SPEC 017, decisões 11 e 12)', () => {
  const all = { create: true, approve: true, publishing: true, channels: true, brand: true, team: true };
  const g0 = {
    role: 'admin', kind: 'empresa', can: all, hasProfile: false, profileComplete: false, instagramConnected: false, postCreated: false,
    postApproved: false, hasSlots: false, paused: true, published: false, teamStarted: false, skipped: [],
  };
  const status = (g) => Object.fromEntries(g.steps.map((s) => [s.id, s.status]));

  it('leitor não tem guia', () => {
    expect(o.buildGuide({ ...g0, role: 'viewer' })).toBeNull();
  });

  it('conta nova: os passos na ordem da spec, a equipe por último e opcional; o atual é o perfil', () => {
    const g = o.buildGuide(g0);
    expect(g.steps.map((s) => s.id)).toEqual(['profile', 'instagram', 'post', 'approve', 'slots', 'publishing', 'publish', 'team']);
    expect(g.steps.at(-1).optional).toBe(true);
    expect(g).toMatchObject({ resolved: 0, total: 8, complete: false, current: 'profile', hidden: false });
  });

  it('cada passo é marcado pelo dado, e o atual anda junto', () => {
    const g = o.buildGuide({ ...g0, hasProfile: true, profileComplete: true, instagramConnected: true, postCreated: true });
    expect(status(g)).toMatchObject({ profile: 'done', instagram: 'done', post: 'done', approve: 'todo' });
    expect(g.current).toBe('approve');
  });

  it('aprovado conta como criado; publicado conta como criado e aprovado, e esconde o guia', () => {
    expect(status(o.buildGuide({ ...g0, postApproved: true }))).toMatchObject({ post: 'done', approve: 'done' });
    const g = o.buildGuide({ ...g0, published: true });
    expect(status(g)).toMatchObject({ post: 'done', approve: 'done', publish: 'done' });
    expect(g.hidden).toBe(true);
  });

  it('conta pausada pede para ligar a publicação; com horários e sem pausa, os dois passos ficam feitos', () => {
    const paused = o.buildGuide(g0).steps.find((s) => s.id === 'publishing');
    expect(paused.actions).toEqual([{ kind: 'resume', label: 'Ligar a publicação' }]);
    expect(status(o.buildGuide({ ...g0, hasSlots: true, paused: false }))).toMatchObject({ slots: 'done', publishing: 'done' });
  });

  it('sem a permissão, o passo fica sem ação e diz quem faz', () => {
    const none = { create: false, approve: false, publishing: false, channels: false, brand: false, team: false };
    const g = o.buildGuide({ ...g0, role: 'creator', can: { ...none, create: true } });
    const by = Object.fromEntries(g.steps.map((s) => [s.id, s]));
    expect(by.post.actions).toEqual([{ kind: 'link', label: 'Criar post', href: '/create' }]);
    expect(by.approve).toMatchObject({ actions: [], note: expect.stringMatching(/aprova/) });
    expect(by.slots.note).toMatch(/Só administradores/);
    expect(by.team.actions).toEqual([]);
  });

  it('o passo opcional da equipe não trava o atual nem impede o guia de acabar', () => {
    const ready = { ...g0, hasProfile: true, profileComplete: true, instagramConnected: true, postCreated: true, postApproved: true, hasSlots: true, paused: false, published: true };
    const g = o.buildGuide(ready);
    expect(g.current).toBeNull();
    expect(g.complete).toBe(false);
    expect(o.buildGuide({ ...ready, skipped: ['team'] }).complete).toBe(true);
    expect(o.buildGuide({ ...ready, kind: 'pessoa' }).steps.map((s) => s.id)).not.toContain('team');
  });
});

describe('posts esquecidos em Aprovar (decisão 12)', () => {
  const now = Date.parse('2026-10-22T12:00:00Z');
  const daysAgo = (d) => new Date(now - d * 86400000).toISOString();

  it('mais de 3 dias avisa; mais de 14 pergunta se arquiva', () => {
    expect(o.pendingAge([daysAgo(1), daysAgo(4), daysAgo(15)], now)).toEqual({ waiting: 3, stale: 2, archive: 1 });
    expect(o.pendingAge([daysAgo(3)], now)).toEqual({ waiting: 1, stale: 0, archive: 0 });
    expect(o.pendingAge([], now)).toEqual({ waiting: 0, stale: 0, archive: 0 });
  });
});
