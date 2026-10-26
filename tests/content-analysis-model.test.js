import { describe, it, expect } from 'vitest';
import * as m from '../platform/src/lib/content-analysis-model.ts';

// BRT = UTC-3: 22h UTC é 19h em Brasília.
const at = (weekday, localHour, week = 0) => {
  // 2026-10-19 é segunda (weekday 1); soma os dias até o weekday pedido.
  const base = Date.UTC(2026, 9, 19 + ((weekday + 6) % 7) - week * 7, localHour + 3, 0, 0);
  return new Date(base).toISOString();
};
let seq = 0;
const post = (over) => ({ id: `p${(seq += 1)}`, title: `Post ${seq}`, publishedAt: at(2, 19), kind: 'informativo', format: 'image', goal: 'ensinar', engagement: 0.05, ...over });

describe('conteúdo que funciona', () => {
  const posts = [
    ...Array.from({ length: 9 }, () => post({ kind: 'informativo', engagement: 0.059 })),
    ...Array.from({ length: 6 }, () => post({ kind: 'atmosfera', format: 'carousel', goal: 'produto', engagement: 0.032 })),
  ];

  it('média por grupo com a contagem e posts sem alcance fora da conta', () => {
    const b = m.contentBreakdown([...posts, post({ engagement: null })]);
    expect(b.counted).toBe(15);
    expect(b.ready).toBe(true);
    expect(b.kind.map((g) => [g.key, g.n, g.avg, g.low])).toEqual([['informativo', 9, 0.059, false], ['atmosfera', 6, 0.032, false]]);
    expect(b.format.map((g) => g.label)).toEqual(['Imagem única', 'Carrossel']);
    expect(b.goal.map((g) => g.label)).toEqual(['Ensinar algo', 'Mostrar o produto ou serviço']);
  });

  it('grupo com menos de 4 posts é marcado e vai para o fim, mesmo com média maior', () => {
    const b = m.contentBreakdown([...posts, post({ format: 'text', engagement: 0.2 }), post({ format: 'text', engagement: 0.2 })]);
    const text = b.format.find((g) => g.key === 'text');
    expect(text).toMatchObject({ n: 2, low: true, label: 'Só texto' });
    expect(b.format[b.format.length - 1].key).toBe('text');
  });

  it('post de melhor resultado', () => {
    const top = post({ title: 'Campeão', engagement: 0.4 });
    expect(m.contentBreakdown([...posts, top]).best.title).toBe('Campeão');
    expect(m.contentBreakdown([post({ engagement: null })]).best).toBeNull();
  });

  it('frase do aprendizado: só com os dois tipos acima do corte e com pelo menos 20% de diferença', () => {
    const s = m.insightSentence(m.contentBreakdown(posts));
    expect(s.text).toBe('Posts informativos renderam 1,8 vez o engajamento dos de atmosfera.');
    expect(s.evidence).toBe('9 posts informativos (5,9%) contra 6 de atmosfera (3,2%)');
    // atmosfera ganha: a frase troca de lado
    const inverted = m.contentBreakdown([...Array.from({ length: 6 }, () => post({ kind: 'informativo', engagement: 0.02 })), ...Array.from({ length: 6 }, () => post({ kind: 'atmosfera', engagement: 0.05 }))]);
    expect(m.insightSentence(inverted).text).toBe('Posts de atmosfera renderam 2,5 vezes o engajamento dos informativos.'.replace('vezes', 'vez'));
    // diferença pequena, grupo pequeno ou poucos posts: nenhuma frase
    expect(m.insightSentence(m.contentBreakdown([...Array.from({ length: 6 }, () => post({ kind: 'informativo', engagement: 0.05 })), ...Array.from({ length: 6 }, () => post({ kind: 'atmosfera', engagement: 0.048 }))]))).toBeNull();
    expect(m.insightSentence(m.contentBreakdown([...Array.from({ length: 9 }, () => post({ kind: 'informativo', engagement: 0.06 })), ...Array.from({ length: 3 }, () => post({ kind: 'atmosfera', engagement: 0.01 }))]))).toBeNull();
    expect(m.insightSentence(m.contentBreakdown(posts.slice(0, 5)))).toBeNull();
  });
});

describe('horários recomendados', () => {
  const tz = -3;
  // 14 posts: terça 19h rende muito, sexta 11h bem, sábado 10h médio, o resto fraco.
  const base = [
    ...Array.from({ length: 4 }, (_, i) => post({ publishedAt: at(2, 19, i), engagement: 0.09 })),
    ...Array.from({ length: 3 }, (_, i) => post({ publishedAt: at(5, 11, i), engagement: 0.07 })),
    ...Array.from({ length: 3 }, (_, i) => post({ publishedAt: at(6, 10, i), engagement: 0.05 })),
    ...Array.from({ length: 2 }, (_, i) => post({ publishedAt: at(1, 9, i), engagement: 0.02 })),
    ...Array.from({ length: 2 }, (_, i) => post({ publishedAt: at(3, 15, i), engagement: 0.02 })),
  ];

  it('dia e hora são lidos no fuso da conta', () => {
    expect(m.localParts(at(2, 19), tz)).toEqual({ weekday: 2, hour: 19 });
    expect(m.localParts('2026-10-20T02:00:00Z', tz)).toEqual({ weekday: 1, hour: 23 }); // segunda 23h em Brasília
    expect(m.localParts('lixo', tz)).toBeNull();
  });

  it('recomenda os 3 melhores horários, em ordem de dia da semana', () => {
    const r = m.recommendSlots(base, { tzOffsetHours: tz });
    expect(r.ok).toBe(true);
    expect(r.basedOn).toBe(14);
    expect(r.usedOnline).toBe(false);
    expect(r.slots.map((s) => [s.weekday, s.hour, s.minute])).toEqual([[2, 19, 0], [5, 11, 0], [6, 10, 0]]);
    expect(m.describeSlots(r.slots)).toBe('Ter 19h, Sex 11h, Sáb 10h');
  });

  it('célula com um post só não ganha de célula consistente (puxa para a média)', () => {
    const lucky = post({ publishedAt: at(4, 12), engagement: 0.12 });
    const r = m.recommendSlots([...base, lucky], { tzOffsetHours: tz });
    const top = [...r.slots].sort((a, b) => b.score - a.score)[0];
    expect([top.weekday, top.hour]).toEqual([2, 19]);
  });

  it('dois horários no mesmo dia ficam a pelo menos 3 h um do outro', () => {
    const posts = [
      ...Array.from({ length: 4 }, (_, i) => post({ publishedAt: at(2, 19, i), engagement: 0.09 })),
      ...Array.from({ length: 4 }, (_, i) => post({ publishedAt: at(2, 20, i), engagement: 0.085 })),
      ...Array.from({ length: 4 }, (_, i) => post({ publishedAt: at(5, 11, i), engagement: 0.04 })),
    ];
    const r = m.recommendSlots(posts, { tzOffsetHours: tz });
    expect(r.slots.filter((s) => s.weekday === 2)).toHaveLength(1);
    expect(r.slots.some((s) => s.weekday === 5)).toBe(true);
  });

  it('o horário online dos seguidores reforça, sem decidir sozinho', () => {
    const online = Array.from({ length: 24 }, (_, h) => (h === 10 ? 1 : 0));
    const without = m.recommendSlots(base, { tzOffsetHours: tz });
    const withOnline = m.recommendSlots(base, { tzOffsetHours: tz, onlineHours: online });
    expect(withOnline.usedOnline).toBe(true);
    const score = (r, d, h) => r.slots.find((s) => s.weekday === d && s.hour === h).score;
    // sábado 10h está no pico online: o placar dele sobe em relação à terça, que cai 25%
    expect(score(withOnline, 6, 10) / score(withOnline, 2, 19)).toBeGreaterThan(score(without, 6, 10) / score(without, 2, 19));
    // um array de tamanho errado é ignorado
    expect(m.recommendSlots(base, { tzOffsetHours: tz, onlineHours: [1, 2] }).usedOnline).toBe(false);
  });

  it('poucos posts ou poucos horários: não recomenda e diz quanto falta', () => {
    expect(m.recommendSlots(base.slice(0, 5), { tzOffsetHours: tz })).toEqual({ ok: false, reason: 'few_posts', have: 5, need: 12 });
    expect(m.recommendSlots([...base.slice(0, 11), post({ engagement: null })], { tzOffsetHours: tz })).toMatchObject({ ok: false, reason: 'few_posts', have: 11 });
    const sameHour = Array.from({ length: 13 }, (_, i) => post({ publishedAt: at(2, 19, i % 4) }));
    expect(m.recommendSlots(sameHour, { tzOffsetHours: tz })).toEqual({ ok: false, reason: 'few_hours', have: 1, need: 3 });
  });
});
