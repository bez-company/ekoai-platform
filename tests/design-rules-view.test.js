// A tela Aprendizado › Design do post (SPEC 019, BEZ-279) sem navegador: o agrupamento das regras, a linha de
// evidência (só contagem e datas, nunca texto de post) e a frase de erro com o próximo passo.
import { describe, it, expect } from 'vitest';
import { groupRules, evidenceLine, actionError, ACTION_ERROR } from '../platform/src/lib/design-rules-view.ts';

const r = (id, status, createdAt) => ({ id, status, createdAt, title: id });

describe('regras do design na tela', () => {
  it('agrupa por estado, a mais nova primeiro, e esconde a dispensada', () => {
    const g = groupRules([r('a', 'active', '2026-10-01'), r('b', 'proposed', '2026-10-02'), r('c', 'off', '2026-10-03'), r('d', 'dismissed', '2026-10-04'), r('e', 'active', '2026-10-05'), r('f', 'proposed', '2026-10-06')]);
    expect(g.proposed.map((x) => x.id)).toEqual(['f', 'b']);
    expect(g.active.map((x) => x.id)).toEqual(['e', 'a']);
    expect(g.off.map((x) => x.id)).toEqual(['c']);
    expect(JSON.stringify(g)).not.toContain('"d"');
  });

  it('a evidência diz quantos posts e o período', () => {
    expect(evidenceLine({ posts: 3, first_at: '2026-10-12T15:00:00.000Z', last_at: '2026-10-22T09:00:00.000Z' })).toBe('Em 3 posts, de 12/10 a 22/10.');
    expect(evidenceLine({ posts: 3, first_at: '2026-10-22T09:00:00.000Z', last_at: '2026-10-22T18:00:00.000Z' })).toBe('Em 3 posts, em 22/10.');
    expect(evidenceLine({ posts: 4 })).toBe('Em 4 posts.');
    expect(evidenceLine({ posts: 1 })).toBe('Em 1 post.');
    expect(evidenceLine(null)).toBeNull();
    expect(evidenceLine({})).toBeNull();
  });

  it('erro do servidor vira a frase com o próximo passo; a regra de negócio chega como está', () => {
    expect(actionError(500, 'Não deu para concluir agora.')).toBe(ACTION_ERROR);
    expect(actionError(409, 'A regra mudou enquanto você olhava. Recarregue a página.')).toBe('A regra mudou enquanto você olhava. Recarregue a página.');
    expect(actionError(409, undefined)).toBe(ACTION_ERROR);
    expect(actionError(403, '')).toBe(ACTION_ERROR);
    expect(ACTION_ERROR).toMatch(/Nada foi alterado/);
  });
});
