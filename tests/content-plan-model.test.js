import { describe, it, expect } from 'vitest';
import { planSuggestions, commemorativeDates, parseIdeas, fallbackIdea, ideasPrompt, PROMO_WINDOW } from '../platform/src/lib/content-plan-model.ts';

// Quarta, 21/10/2026, 12:00 em Brasília (15:00 UTC).
const now = new Date('2026-10-21T15:00:00Z');
const at = (day, hourUtc = 21) => `2026-10-${String(day).padStart(2, '0')}T${String(hourUtc).padStart(2, '0')}:00:00.000Z`; // 18h BRT
const past = (day, goal, withPhoto = false) => ({ at: at(day), goal, withPhoto });
const base = { now, photos: [], dates: [], tzOffsetHours: -3 };

describe('regras de sequência', () => {
  it('um post por horário livre dos próximos 7 dias, fora do horizonte não entra', () => {
    const out = planSuggestions({ ...base, slots: [at(22), at(24), at(29)], history: [] });
    expect(out.map((s) => s.slotAt)).toEqual([at(22), at(24)]);
  });

  it('não repete o objetivo do post anterior, nem entre as sugestões', () => {
    const out = planSuggestions({ ...base, slots: [at(22), at(23), at(24), at(25), at(26), at(27)], history: [past(20, 'ensinar')] });
    const seq = ['ensinar', ...out.map((s) => s.goal)];
    for (let i = 1; i < seq.length; i += 1) expect(seq[i], `posição ${i}`).not.toBe(seq[i - 1]);
  });

  it('no máximo 1 promoção a cada 4 posts', () => {
    const history = [past(10, 'ensinar'), past(12, 'produto'), past(14, 'bastidores'), past(16, 'novidade'), past(18, 'prova_social'), past(20, 'conversa')];
    const out = planSuggestions({ ...base, slots: [at(22), at(23), at(24), at(25), at(26), at(27)], history, engagement: { promocao: 0.9, ensinar: 0.1 } });
    const seq = [...history.map((h) => h.goal), ...out.map((s) => s.goal)];
    seq.forEach((g, i) => {
      if (g !== 'promocao') return;
      expect(seq.slice(Math.max(0, i - PROMO_WINDOW + 1), i).includes('promocao'), `promoção na posição ${i}`).toBe(false);
    });
    expect(out.filter((s) => s.goal === 'promocao').length).toBeGreaterThan(0);
  });

  it('banco com foto: ao menos uma foto real por semana, e cada foto só uma vez', () => {
    const photos = [{ id: 'p1', description: 'Forno a lenha aceso. Fundo escuro', tags: ['bastidor'] }, { id: 'p2', description: null, tags: ['produto'] }];
    const out = planSuggestions({ ...base, slots: [at(22), at(24), at(26)], history: [past(20, 'ensinar')], photos });
    const withPhoto = out.filter((s) => s.assetId);
    expect(withPhoto.length).toBe(1);
    expect(withPhoto[0]).toMatchObject({ assetId: 'p1', goal: 'bastidores' });
    expect(withPhoto[0].reason).toBe('Bastidores com a foto "Forno a lenha aceso". Ainda não saiu foto real da empresa.');
  });

  it('foto recente no histórico: não força outra foto na mesma semana', () => {
    const out = planSuggestions({ ...base, slots: [at(22), at(24)], history: [past(20, 'produto', true)], photos: [{ id: 'p1', description: 'x', tags: ['produto'] }] });
    expect(out.every((s) => s.assetId === null)).toBe(true);
  });

  it('data comemorativa em até 3 dias ganha o horário, uma vez só', () => {
    const dates = commemorativeDates(2026);
    const out = planSuggestions({ ...base, now: new Date('2026-10-08T15:00:00Z'), slots: ['2026-10-09T21:00:00.000Z', '2026-10-10T21:00:00.000Z', '2026-10-12T21:00:00.000Z'], history: [], dates });
    expect(out.map((s) => s.goal)).toEqual(['data_comemorativa', expect.any(String), expect.any(String)]);
    expect(out[0]).toMatchObject({ dateKey: 'criancas-2026', reason: 'Dia das Crianças é segunda (12/10).' });
    expect(out.slice(1).some((s) => s.goal === 'data_comemorativa')).toBe(false);
    const again = planSuggestions({ ...base, now: new Date('2026-10-08T15:00:00Z'), slots: ['2026-10-09T21:00:00.000Z'], history: [], dates, usedDateKeys: ['criancas-2026'] });
    expect(again[0].goal).not.toBe('data_comemorativa');
  });

  it('com métrica de 2 ou mais objetivos, puxa para o que mais engaja e diz por quê', () => {
    const out = planSuggestions({ ...base, slots: [at(22)], history: [past(20, 'ensinar'), past(18, 'conversa')], engagement: { bastidores: 0.08, produto: 0.02, novidade: 0.01 } });
    expect(out[0]).toMatchObject({ goal: 'bastidores', reason: 'Bastidores é o que mais engaja na sua conta.' });
  });

  it('Trocar e Pular: o objetivo evitado não volta no mesmo horário', () => {
    const first = planSuggestions({ ...base, slots: [at(22)], history: [past(20, 'ensinar')] });
    const swapped = planSuggestions({ ...base, slots: [at(22)], history: [past(20, 'ensinar')], avoid: { [at(22)]: [first[0].goal] } });
    expect(swapped[0].goal).not.toBe(first[0].goal);
    expect(swapped[0].goal).not.toBe('ensinar');
  });

  it('o motivo cita a sequência', () => {
    const out = planSuggestions({ ...base, slots: [at(22)], history: [past(18, 'ensinar'), past(20, 'ensinar')] });
    expect(out[0].reason).toMatch(/^Os dois últimos foram ensinar algo; .+ varia a sequência\.$/);
    expect(planSuggestions({ ...base, slots: [at(22)], history: [] })[0].reason).toMatch(/^Primeiro post da sequência/);
  });
});

describe('datas e ideias', () => {
  it('datas móveis calculadas', () => {
    const d = Object.fromEntries(commemorativeDates(2026).map((x) => [x.key, x.date]));
    expect(d['maes-2026']).toBe('2026-05-10');
    expect(d['pais-2026']).toBe('2026-08-09');
    expect(d['black-friday-2026']).toBe('2026-11-27');
  });

  it('ideias do modelo: índice fora, tipo errado e vazio caem no padrão', () => {
    expect(parseIdeas({ ideas: [{ i: 0, idea: '  Bolo   de pote ' }, { i: 5, idea: 'x' }, { i: 1, idea: 3 }, { i: 2, idea: ' ' }] }, 3)).toEqual(['Bolo de pote', null, null]);
    expect(parseIdeas('nada', 2)).toEqual([null, null]);
    expect(fallbackIdea('produto', null, null)).toBe('Mostrar o produto ou serviço, como "O bolo de pote de ninho"');
    expect(fallbackIdea('data_comemorativa', null, 'Natal')).toMatch(/^Natal: /);
  });

  it('o pedido ao modelo leva ramo, objetivo, foto e data', () => {
    const p = ideasPrompt({ niche: 'Confeitaria', offering: 'Bolos', items: [{ i: 0, goal: 'bastidores', photo: 'Forno aceso', date: null }, { i: 1, goal: 'data_comemorativa', photo: null, date: 'Natal' }] });
    expect(p).toContain('Ramo: Confeitaria.');
    expect(p).toContain('0. objetivo: mostrar os bastidores');
    expect(p).toContain('foto: Forno aceso');
    expect(p).toContain('data: Natal');
  });
});
