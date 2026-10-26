import { describe, it, expect } from 'vitest';
import * as v from '../platform/src/lib/analysis-view.ts';
import { contentBreakdown, insightSentence, recommendSlots } from '../platform/src/lib/content-analysis-model.ts';

const AGE = { '13-17': 0.02, '18-24': 0.14, '25-34': 0.38, '35-44': 0.29, '45-54': 0.11, '55-64': 0.04, '65+': 0.02 };
const online = Array.from({ length: 24 }, (_, h) => (h === 19 ? 1 : h === 20 ? 0.95 : h === 11 ? 0.55 : 0.2));

let n = 0;
const post = (over) => ({ id: `p${(n += 1)}`, title: 't', publishedAt: '2026-10-20T22:00:00.000Z', kind: 'informativo', format: 'image', goal: 'ensinar', engagement: 0.05, ...over });
const posts = (count) => Array.from({ length: count }, (_, i) => post({ publishedAt: `2026-10-${String(10 + (i % 3)).padStart(2, '0')}T${String(12 + (i % 4) * 2).padStart(2, '0')}:00:00.000Z` }));

function analysis(over = {}) {
  const ps = over.posts ?? posts(15);
  const breakdown = contentBreakdown(ps);
  return {
    connected: true,
    insights: true,
    posts: ps,
    breakdown,
    insight: insightSentence(breakdown),
    recommendation: recommendSlots(ps, { tzOffsetHours: -3, onlineHours: null }),
    audience: { capturedOn: '2026-10-26', followers: 2310, age: AGE, gender: { F: 0.71, M: 0.27, U: 0.02 }, onlineHours: online, status: 'ok' },
    tzOffsetHours: -3,
    ownHours: Array.from({ length: 24 }, (_, h) => (h === 19 ? 1 : h === 11 ? 0.8 : null)),
    ...over,
  };
}

describe('estado da tela de Analytics', () => {
  it('sem Instagram conectado e sem permissão de insights: a tela explica e não desenha cartão', () => {
    expect(v.analysisView(analysis({ connected: false, insights: false })).gate).toBe('no_instagram');
    expect(v.analysisView(analysis({ insights: false })).gate).toBe('no_permission');
    expect(v.analysisView(analysis()).gate).toBe('ready');
  });

  it('conteúdo: com 12 posts compara; antes disso diz quantos faltam', () => {
    expect(v.analysisView(analysis()).content.state).toBe('ready');
    expect(v.analysisView(analysis({ posts: posts(5), breakdown: contentBreakdown(posts(5)) })).content).toEqual({ state: 'wait', have: 5, need: 12 });
  });

  it('público: ok com a faixa de maior peso marcada, poucos seguidores, indisponível e sem leitura', () => {
    const ok = v.analysisView(analysis()).audience;
    expect(ok.state).toBe('ok');
    expect(ok.age.find((a) => a.top).label).toBe('25 a 34');
    // o jsonb do Postgres devolve as chaves em outra ordem ('65+' primeiro): a tela mantém a ordem das faixas
    const shuffled = v.analysisView(analysis({ audience: { ...analysis().audience, age: { '65+': 0.02, '13-17': 0.02, '55-64': 0.04, '45-54': 0.11, '35-44': 0.29, '25-34': 0.38, '18-24': 0.14 }, gender: { U: 0.02, M: 0.27, F: 0.71 } } })).audience;
    expect(shuffled.age.map((a) => a.label)).toEqual(['13 a 17', '18 a 24', '25 a 34', '35 a 44', '45 a 54', '55 a 64', '65 ou mais']);
    expect(shuffled.gender.map((g) => g.key)).toEqual(['F', 'M', 'U']);
    expect(ok.age.map((a) => a.label)).toContain('65 ou mais');
    expect(ok.gender.map((g) => g.label)).toEqual(['Mulheres', 'Homens', 'Não informado']);
    expect(v.analysisView(analysis({ audience: { capturedOn: '2026-10-26', followers: 87, age: null, gender: null, onlineHours: null, status: 'too_few_followers' } })).audience).toEqual({ state: 'too_few', followers: 87, need: 100 });
    expect(v.analysisView(analysis({ audience: { capturedOn: '2026-10-26', followers: 2310, age: null, gender: null, onlineHours: null, status: 'unavailable' } })).audience.state).toBe('unavailable');
    expect(v.analysisView(analysis({ audience: null })).audience.state).toBe('none');
  });

  it('horários: online da Meta quando vem, senão o engajamento dos próprios posts, senão nada', () => {
    const on = v.analysisView(analysis()).hours;
    expect(on.mode).toBe('online');
    expect(on.peaks).toBe('Pico às 19h e 20h.');
    const own = v.analysisView(analysis({ audience: { capturedOn: '2026-10-26', followers: 2310, age: AGE, gender: null, onlineHours: null, status: 'ok' } })).hours;
    expect(own.mode).toBe('own');
    expect(own.peaks).toBe('Melhores horas para publicar: 11h e 19h.');
    expect(v.analysisView(analysis({ audience: null, ownHours: new Array(24).fill(null) })).hours.mode).toBe('none');
  });

  it('picos: até 3 horas a 90% do pico, em ordem do dia', () => {
    expect(v.peakHours(online)).toEqual([19, 20]);
    expect(v.peakHours(new Array(24).fill(null))).toEqual([]);
    expect(v.peakHours(new Array(24).fill(0.5))).toEqual([0, 1, 2]);
  });

  it('texto da recomendação e link para os Horários', () => {
    const ok = recommendSlots(
      [
        ...Array.from({ length: 4 }, (_, i) => post({ publishedAt: `2026-10-${13 + i * 7 > 31 ? 27 : 13 + i * 7}T22:00:00.000Z`, engagement: 0.09 })),
        ...Array.from({ length: 4 }, (_, i) => post({ publishedAt: `2026-10-${2 + i * 7}T14:00:00.000Z`, engagement: 0.07 })),
        ...Array.from({ length: 4 }, (_, i) => post({ publishedAt: `2026-10-${3 + i * 7}T13:00:00.000Z`, engagement: 0.05 })),
      ],
      { tzOffsetHours: -3 },
    );
    expect(ok.ok).toBe(true);
    expect(v.recommendationText(ok)).toMatch(/^Ter 19h/);
    expect(v.suggestionHref()).toBe('/agenda?edit=slots');
    const few = recommendSlots(posts(5), { tzOffsetHours: -3 });
    expect(v.recommendationText(few)).toBe('Faltam 7 posts para recomendar horários.');
  });
});
