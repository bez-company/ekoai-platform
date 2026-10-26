import { describe, it, expect } from 'vitest';
import * as o from '../platform/src/lib/observations-model.ts';
import { contentBreakdown, insightSentence, recommendSlots } from '../platform/src/lib/content-analysis-model.ts';

const AGE = { '13-17': 0.02, '18-24': 0.14, '25-34': 0.38, '35-44': 0.29, '45-54': 0.11, '55-64': 0.04, '65+': 0.02 };
let n = 0;
const post = (over) => ({ id: `p${(n += 1)}`, title: 't', publishedAt: '2026-10-20T22:00:00.000Z', kind: 'informativo', format: 'image', goal: 'ensinar', engagement: 0.05, ...over });
const at = (day, hour) => `2026-10-${String(day).padStart(2, '0')}T${String(hour + 3).padStart(2, '0')}:00:00.000Z`;

function input(over = {}) {
  const posts = over.posts ?? [
    ...Array.from({ length: 9 }, (_, i) => post({ kind: 'informativo', format: 'image', engagement: 0.059, publishedAt: at(1 + (i % 3) * 7, 19) })),
    ...Array.from({ length: 6 }, (_, i) => post({ kind: 'atmosfera', format: i < 2 ? 'carousel' : 'image', goal: 'produto', engagement: 0.032, publishedAt: at(3 + (i % 2) * 7, 11 + (i % 3)) })),
  ];
  const breakdown = contentBreakdown(posts);
  return {
    breakdown,
    insight: insightSentence(breakdown),
    audience: { status: 'ok', followers: 2310, age: AGE, gender: { F: 0.71, M: 0.27, U: 0.02 } },
    recommendation: recommendSlots(posts, { tzOffsetHours: -3 }),
    ...over,
  };
}

describe('observações do público', () => {
  it('conteúdo e público: texto de template com os números; só essas duas podem virar dica', () => {
    const obs = o.buildObservations(input());
    const byId = Object.fromEntries(obs.map((x) => [x.id, x]));
    expect(byId.content.text).toBe('Posts informativos renderam 1,8 vez o engajamento dos de atmosfera.');
    expect(byId.content.evidence).toBe('9 posts informativos (5,9%) contra 6 de atmosfera (3,2%) · últimos 60 dias');
    expect(byId.audience.text).toBe('Seu público tem 67% entre 25 e 44 anos e 71% de mulheres.');
    expect(byId.hours.usable).toBe(false);
    expect(byId.hours.text).toMatch(/^Os melhores horários para publicar são .+\.$/);
    expect(obs.filter((x) => x.usable).map((x) => x.id)).toEqual(['content', 'audience']);
  });

  it('a faixa etária usa o par de faixas vizinhas com mais gente, e a última vira "a partir de"', () => {
    expect(o.topAgePair(AGE)).toEqual({ from: '25-34', to: '35-44', share: 0.67 });
    const old = { '13-17': 0, '18-24': 0.05, '25-34': 0.1, '35-44': 0.1, '45-54': 0.1, '55-64': 0.35, '65+': 0.3 };
    const text = o.buildObservations(input({ audience: { status: 'ok', followers: 900, age: old, gender: null } })).find((x) => x.id === 'audience').text;
    expect(text).toBe('Seu público tem 65% a partir de 55 anos.');
  });

  it('gênero só entra quando um passa de 50%; homens quando eles lideram', () => {
    const men = o.buildObservations(input({ audience: { status: 'ok', followers: 900, age: AGE, gender: { F: 0.3, M: 0.68, U: 0.02 } } })).find((x) => x.id === 'audience').text;
    expect(men).toBe('Seu público tem 67% entre 25 e 44 anos e 68% de homens.');
    const even = o.buildObservations(input({ audience: { status: 'ok', followers: 900, age: AGE, gender: { F: 0.49, M: 0.49, U: 0.02 } } })).find((x) => x.id === 'audience').text;
    expect(even).toBe('Seu público tem 67% entre 25 e 44 anos.');
  });

  it('sem leitura do público (ou com menos de 100 seguidores) não há observação de público', () => {
    expect(o.buildObservations(input({ audience: null })).some((x) => x.id === 'audience')).toBe(false);
    expect(o.buildObservations(input({ audience: { status: 'too_few_followers', followers: 87, age: null, gender: null } })).some((x) => x.id === 'audience')).toBe(false);
  });

  it('formato com grupo pequeno aparece cinza e diz por quê, sem interruptor', () => {
    const f = o.buildObservations(input()).find((x) => x.id === 'format');
    expect(f).toMatchObject({ few: true, usable: false });
    expect(f.text).toMatch(/^Imagem única rendeu \d,\d% contra \d,\d% de carrossel\.$/);
    // quando o grupo pequeno rende mais, o texto abre por ele
    const posts = [...Array.from({ length: 10 }, () => post({ format: 'image', engagement: 0.04 })), ...Array.from({ length: 2 }, () => post({ format: 'carousel', engagement: 0.08 }))];
    const lead = o.buildObservations(input({ posts, breakdown: contentBreakdown(posts), insight: null })).find((x) => x.id === 'format');
    expect(lead.text).toBe('Carrossel rendeu 8,0% contra 4,0% de imagem única.');
    expect(lead.few).toBe(true);
    expect(f.evidence).toBe('Só 2 posts de carrossel: poucos posts para concluir. A observação conta quando houver 4 ou mais por grupo.');
  });

  it('com poucos posts não há comparação nem horário', () => {
    const few = Array.from({ length: 5 }, () => post());
    const obs = o.buildObservations(input({ posts: few, breakdown: contentBreakdown(few), insight: null, recommendation: recommendSlots(few, { tzOffsetHours: -3 }) }));
    expect(obs.map((x) => x.id)).toEqual(['audience']);
  });

  it('dicas do planejador: só as usáveis que a pessoa ligou', () => {
    const obs = o.buildObservations(input());
    expect(o.plannerHints(obs, [])).toEqual([]);
    expect(o.plannerHints(obs, ['content'])).toEqual(['Posts informativos renderam 1,8 vez o engajamento dos de atmosfera.']);
    expect(o.plannerHints(obs, ['content', 'audience'])).toHaveLength(2);
    // horário e formato nunca viram dica, mesmo se a chave chegasse
    expect(o.plannerHints(obs, ['hours', 'format'])).toEqual([]);
  });

  it('corpo da rota: valida a chave e o booleano antes de qualquer I/O', () => {
    expect(o.parseObservationInput({ key: 'content', enabled: true })).toEqual({ ok: true, value: { key: 'content', enabled: true } });
    expect(o.parseObservationInput({ key: 'hours', enabled: true }).ok).toBe(false);
    expect(o.parseObservationInput({ key: 'audience', enabled: 'sim' }).ok).toBe(false);
    expect(o.parseObservationInput(null).ok).toBe(false);
  });
});
