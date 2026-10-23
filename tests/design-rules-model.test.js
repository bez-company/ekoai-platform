// A regra de marca que nasce de edições parecidas (SPEC 019, decisões 11 a 14), com datas fixas: 3 posts
// diferentes em 30 dias propõem; 2, ou 3 em 31 dias, não; ida e volta não conta; texto livre não é regra;
// dispensada só volta depois de 60 dias e de mais 3 posts; a regra aplicada nunca piora o post.
import { describe, it, expect } from 'vitest';
import { candidatesOf, findProposals, explanationFor, ruleTitle, applyRule, applyRules, RULE_THRESHOLD, RULE_WINDOW_DAYS } from '../platform/src/lib/design/rules-model.ts';

const NOW = new Date('2026-10-23T12:00:00Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 86_400_000).toISOString();
const ctx = { kind: 'informativo', layout: 'lista-numerada', ratio: '1:1', goal: null };
const initial = { layout: 'lista-numerada', texts: { kicker: 'Dica', title: 'Título', sub: 'Subtítulo', items: ['a', 'b'] } };
const post = (id, current, at, extra = {}) => ({ designId: id, initial, current: { ...initial, ...current }, ctx, lastEditAt: at, revisionIds: [`rev-${id}`], ...extra });
const corner = (id, at) => post(id, { logoCorner: 'br' }, at);

describe('mudança líquida de um post', () => {
  it('só os campos categóricos; texto livre e ida e volta não entram', () => {
    expect(candidatesOf(initial, { ...initial, logoCorner: 'br' }, ctx)).toEqual([{ field: 'logoCorner', scope: 'any', value: 'br', key: 'any|logoCorner|br' }]);
    expect(candidatesOf(initial, { ...initial, texts: { ...initial.texts, title: 'Outro título' } }, ctx)).toEqual([]);
    expect(candidatesOf(initial, { ...initial, texts: { ...initial.texts, sub: 'Outro subtítulo' } }, ctx)).toEqual([]);
    expect(candidatesOf(initial, structuredClone(initial), ctx)).toEqual([]);
    // moveu e devolveu: o design final é o inicial
    expect(candidatesOf(initial, { ...initial, logoCorner: 'bl' }, ctx)).toEqual([]);
    expect(candidatesOf(initial, { ...initial, logoHidden: true }, ctx).map((c) => c.key)).toEqual(['any|logoHidden|true']);
    expect(candidatesOf(initial, { ...initial, texts: { ...initial.texts, sub: undefined } }, ctx).map((c) => c.key)).toEqual(['any|texts.sub|true']);
  });

  it('layout e cor levam o tipo do post; cor que voltou à da marca não é regra', () => {
    expect(candidatesOf(initial, { ...initial, layout: 'titulo-destaque' }, ctx)[0]).toMatchObject({ field: 'layout', scope: 'informativo', value: 'titulo-destaque' });
    expect(candidatesOf(initial, { ...initial, colors: { title: '#B83262' } }, ctx)[0]).toMatchObject({ field: 'colors.title', scope: 'informativo', value: '#B83262' });
    expect(candidatesOf({ ...initial, colors: { title: '#B83262' } }, initial, ctx)).toEqual([]);
  });
});

describe('quando vira proposta', () => {
  it('3 posts diferentes em 30 dias propõem, com a explicação por template e a evidência sem texto', () => {
    const out = findProposals([corner('a', daysAgo(20)), corner('b', daysAgo(10)), corner('c', daysAgo(1))], [], NOW);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ field: 'logoCorner', scope: 'any', value: 'br', ruleKey: 'any|logoCorner|br', posts: 3, revisionIds: ['rev-a', 'rev-b', 'rev-c'] });
    expect(out[0].explanation).toBe('Você moveu o logo para o canto inferior direito em 3 posts nos últimos 30 dias. Usar este canto nos próximos posts?');
    expect(out[0].explanation.length).toBeLessThanOrEqual(200);
    expect(out[0].firstAt).toBe(daysAgo(20));
    expect(out[0].lastAt).toBe(daysAgo(1));
    expect(JSON.stringify(out)).not.toMatch(/Título|Subtítulo/);
  });

  it('2 posts não propõem; 3 posts com um fora da janela (31 dias) não propõem; o limiar é 3 em 30', () => {
    expect(RULE_THRESHOLD).toBe(3);
    expect(RULE_WINDOW_DAYS).toBe(30);
    expect(findProposals([corner('a', daysAgo(5)), corner('b', daysAgo(2))], [], NOW)).toEqual([]);
    expect(findProposals([corner('a', daysAgo(31)), corner('b', daysAgo(5)), corner('c', daysAgo(2))], [], NOW)).toEqual([]);
    expect(findProposals([corner('a', daysAgo(30)), corner('b', daysAgo(5)), corner('c', daysAgo(2))], [], NOW)).toHaveLength(1);
  });

  it('duas edições do mesmo post contam uma; mover e devolver não conta', () => {
    const same = [corner('a', daysAgo(3)), { ...corner('a', daysAgo(2)) }, corner('b', daysAgo(2))];
    // o mesmo designId duas vezes: conta como um post
    expect(findProposals(same, [], NOW)).toEqual([]);
    expect(findProposals(dedupe(same), [], NOW)).toEqual([]);
    const back = post('c', { logoCorner: 'bl' }, daysAgo(1));
    expect(findProposals([corner('a', daysAgo(5)), corner('b', daysAgo(3)), back], [], NOW)).toEqual([]);
  });

  it('valores diferentes do mesmo campo não somam', () => {
    const mixed = [corner('a', daysAgo(5)), post('b', { logoCorner: 'tr' }, daysAgo(4)), post('c', { logoCorner: 'tl' }, daysAgo(3)), corner('d', daysAgo(2))];
    expect(findProposals(mixed, [], NOW)).toEqual([]);
  });

  it('regra que já existe (proposta, ativa ou desligada) não se repete', () => {
    const posts = [corner('a', daysAgo(5)), corner('b', daysAgo(3)), corner('c', daysAgo(1))];
    for (const status of ['proposed', 'active', 'off']) {
      expect(findProposals(posts, [{ id: 'r', field: 'logoCorner', scope: 'any', value: 'br', status, decidedAt: null, evidence: null }], NOW)).toEqual([]);
    }
  });

  it('dispensada só volta depois de 60 dias e de mais 3 posts editados depois da dispensa', () => {
    const dismissed = (days) => [{ id: 'r', field: 'logoCorner', scope: 'any', value: 'br', status: 'dismissed', decidedAt: daysAgo(days), evidence: { posts: 3 } }];
    const posts = [corner('a', daysAgo(5)), corner('b', daysAgo(3)), corner('c', daysAgo(1))];
    // dispensada há 20 dias: ainda no prazo de espera
    expect(findProposals(posts, dismissed(20), NOW)).toEqual([]);
    // passaram 61 dias, mas os 3 posts são de antes da dispensa? (aqui são recentes, depois dela): volta
    expect(findProposals(posts, dismissed(61), NOW)).toHaveLength(1);
    // 61 dias e só 2 posts depois da dispensa: não volta
    expect(findProposals([corner('x', daysAgo(70)), corner('y', daysAgo(5)), corner('z', daysAgo(2))], dismissed(61), NOW)).toEqual([]);
  });

  it('o aviso vem de template para cada campo, até 200 caracteres', () => {
    for (const c of [
      { field: 'logoCorner', scope: 'any', value: 'tl' }, { field: 'logoHidden', scope: 'any', value: true },
      { field: 'texts.sub', scope: 'any', value: true }, { field: 'texts.kicker', scope: 'any', value: true },
      { field: 'layout', scope: 'informativo', value: 'titulo-destaque' }, { field: 'colors.title', scope: 'atmosfera', value: '#B83262' }, { field: 'colors.sub', scope: 'informativo', value: '#4A2C2A' },
    ]) {
      const text = explanationFor(c, 3);
      expect(text.length, text).toBeLessThanOrEqual(200);
      expect(text).toMatch(/3 posts nos últimos 30 dias/);
      expect(text).not.toMatch(/[—–]/);
      expect(ruleTitle(c).length).toBeGreaterThan(3);
    }
    expect(ruleTitle({ field: 'logoCorner', scope: 'any', value: 'br' })).toBe('Logo no canto inferior direito');
  });
});

function dedupe(list) {
  const seen = new Map();
  for (const p of list) seen.set(p.designId, p);
  return [...seen.values()];
}

describe('aplicar a regra a um post novo', () => {
  const ctxApply = { kind: 'informativo', hasVisual: false };
  const base = { layout: 'lista-numerada', texts: { kicker: 'Dica', title: 'Título', sub: 'Subtítulo', items: ['a', 'b'] } };
  const rule = (field, value, scope = 'any', extra = {}) => ({ id: `${field}-${value}`, field, scope, value, status: 'active', decidedAt: null, evidence: null, ...extra });

  it('cada campo muda só o que diz', () => {
    expect(applyRule(base, rule('logoCorner', 'br'), ctxApply)).toEqual({ ...base, logoCorner: 'br' });
    expect(applyRule(base, rule('logoHidden', true), ctxApply)).toEqual({ ...base, logoHidden: true });
    expect(applyRule(base, rule('texts.sub', true), ctxApply).texts).toEqual({ kicker: 'Dica', title: 'Título', sub: undefined, items: ['a', 'b'] });
    expect(applyRule(base, rule('texts.kicker', true), ctxApply).texts.kicker).toBeUndefined();
    expect(applyRule(base, rule('layout', 'titulo-destaque', 'informativo'), ctxApply).layout).toBe('titulo-destaque');
    expect(applyRule(base, rule('colors.title', '#B83262', 'informativo'), ctxApply).colors).toEqual({ title: '#B83262' });
  });

  it('não se aplica ao outro tipo de post, ao que já está assim ou a layout que não serve', () => {
    expect(applyRule(base, rule('colors.title', '#B83262', 'atmosfera'), ctxApply)).toBeNull();
    expect(applyRule({ ...base, logoCorner: 'br' }, rule('logoCorner', 'br'), ctxApply)).toBeNull();
    expect(applyRule(base, rule('logoCorner', 'bl'), ctxApply)).toBeNull(); // o padrão da lista já é o canto inferior esquerdo
    expect(applyRule({ ...base, texts: { title: 'x' } }, rule('texts.sub', true), ctxApply)).toBeNull();
    expect(applyRule(base, rule('layout', 'foto-arco', 'informativo'), ctxApply)).toBeNull();
    expect(applyRule({ ...base, texts: { title: 'x', items: ['a'] } }, rule('layout', 'lista-numerada', 'informativo'), ctxApply)).toBeNull();
  });

  it('a regra nunca piora o post: a que cria achado novo é pulada, as outras valem', () => {
    const rules = [rule('logoCorner', 'br'), rule('colors.title', '#F8D7E3', 'informativo'), rule('texts.sub', true)];
    // o revisor de teste: cor clara no título trava
    const blockers = (d) => (d.colors?.title === '#F8D7E3' ? ['contrast'] : []);
    const out = applyRules(base, rules, ctxApply, blockers);
    expect(out.applied).toEqual(['logoCorner-br', 'texts.sub-true']);
    expect(out.skipped).toEqual([{ id: 'colors.title-#F8D7E3', reason: 'would_worsen' }]);
    expect(out.design.colors).toBeUndefined();
    expect(out.design.logoCorner).toBe('br');
  });

  it('um achado que o post já tinha antes não é culpa da regra', () => {
    const blockers = (d) => ['overlap', ...(d.colors?.title ? [] : [])];
    const out = applyRules(base, [rule('logoCorner', 'br')], ctxApply, blockers);
    expect(out.applied).toEqual(['logoCorner-br']);
  });

  it('regra desligada, proposta ou dispensada não se aplica; sem regra o design é o mesmo', () => {
    const rules = [rule('logoCorner', 'br', 'any', { status: 'off' }), rule('logoHidden', true, 'any', { status: 'proposed' }), rule('texts.sub', true, 'any', { status: 'dismissed' })];
    const out = applyRules(base, rules, ctxApply, () => []);
    expect(out).toEqual({ design: base, applied: [], skipped: [] });
    expect(applyRules(base, [], ctxApply, () => []).design).toBe(base);
  });
});
