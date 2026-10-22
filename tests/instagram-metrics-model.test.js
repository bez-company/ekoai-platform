import { describe, it, expect } from 'vitest';
import * as m from '../platform/src/lib/instagram-metrics-model.ts';

const H = 3_600_000;
const now = Date.parse('2026-10-22T12:00:00Z');
const ago = (ms) => new Date(now - ms).toISOString();

describe('retorno da Graph API', () => {
  it('campos do post: curtidas e comentários; valor estranho vira nulo', () => {
    expect(m.parseMediaFields({ like_count: 12, comments_count: 3, id: '1' })).toEqual({ likes: 12, comments: 3 });
    expect(m.parseMediaFields({ like_count: -1, comments_count: '3' })).toEqual({ likes: null, comments: null });
    expect(m.parseMediaFields(null)).toEqual({ likes: null, comments: null });
  });

  it('insights: lê values[0] ou total_value e ignora métrica desconhecida', () => {
    const json = {
      data: [
        { name: 'reach', period: 'lifetime', values: [{ value: 420 }] },
        { name: 'saved', values: [{ value: 9 }] },
        { name: 'shares', total_value: { value: 4 } },
        { name: 'views', values: [{ value: 800 }] },
        { name: 'total_interactions', values: [{ value: 40 }] },
        { name: 'impressions', values: [{ value: 1 }] },
      ],
    };
    expect(m.parseInsights(json)).toEqual({ reach: 420, saves: 9, shares: 4, views: 800, interactions: 40 });
    expect(m.parseInsights({ data: 'x' })).toEqual({ reach: null, saves: null, shares: null, views: null, interactions: null });
  });

  it('erro da Graph: token, permissão, post apagado ou outro', () => {
    expect(m.graphFailure({ error: { code: 190 } })).toBe('token');
    expect(m.graphFailure({ error: { code: 10 } })).toBe('permission');
    expect(m.graphFailure({ error: { code: 200 } })).toBe('permission');
    expect(m.graphFailure({ error: { code: 100, error_subcode: 33 } })).toBe('gone');
    expect(m.graphFailure({ error: { code: 100 } })).toBe('other');
    expect(m.graphFailure('html')).toBe('other');
  });

  it('id do post no Instagram vem de posts.channels; id estranho é descartado', () => {
    expect(m.mediaIdOf({ instagram: { id: '17895695668004550' } })).toBe('17895695668004550');
    expect(m.mediaIdOf({ instagram: { id: '../me' } })).toBeNull();
    expect(m.mediaIdOf({ linkedin: { id: 'urn:li:share:1' } })).toBeNull();
    expect(m.mediaIdOf(null)).toBeNull();
  });
});

describe('quando coletar', () => {
  it('nunca coletado e dentro de 30 dias: coleta', () => {
    expect(m.isDue(ago(2 * H), null, now)).toBe(true);
    expect(m.isDue(ago(31 * 24 * H), null, now)).toBe(false);
  });

  it('nos 2 primeiros dias, a cada 5 h; depois, a cada 20 h', () => {
    expect(m.isDue(ago(10 * H), ago(4 * H), now)).toBe(false);
    expect(m.isDue(ago(10 * H), ago(5 * H), now)).toBe(true);
    expect(m.isDue(ago(5 * 24 * H), ago(6 * H), now)).toBe(false);
    expect(m.isDue(ago(5 * 24 * H), ago(21 * H), now)).toBe(true);
  });

  it('data inválida não coleta', () => {
    expect(m.isDue('ontem', null, now)).toBe(false);
  });
});

describe('engajamento', () => {
  const base = { ...m.EMPTY_METRICS };
  it('interações sobre alcance, com 4 casas', () => {
    expect(m.engagementRate({ ...base, reach: 400, interactions: 40 })).toBe(0.1);
    expect(m.engagementRate({ ...base, reach: 300, likes: 10, comments: 2, saves: 1 })).toBe(0.0433);
  });

  it('sem alcance (sem a permissão de insights) não há taxa', () => {
    expect(m.engagementRate({ ...base, likes: 10, comments: 2 })).toBeNull();
    expect(m.engagementRate({ ...base, reach: 0, likes: 10 })).toBeNull();
    expect(m.engagementRate({ ...base, reach: 100 })).toBeNull();
  });
});
