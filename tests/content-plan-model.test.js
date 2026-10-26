import { describe, it, expect } from 'vitest';
import { planSuggestions, commemorativeDates, parseIdeas, fallbackIdea, ideasPrompt, ideaProblems, engagementByGoal, PROMO_WINDOW } from '../platform/src/lib/content-plan-model.ts';
import { KIND_GOALS, campaignSlotQuota } from '../platform/src/lib/campaign-model.ts';

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

describe('engajamento por objetivo (BEZ-246)', () => {
  const day = (n) => new Date(now.getTime() - n * 86_400_000).toISOString();
  const s = (goal, ago, likes, comments, rate = null) => ({ goal, publishedAt: day(ago), likes, comments, rate });

  it('sem alcance em algum post, compara curtidas mais comentários', () => {
    const out = engagementByGoal([s('bastidores', 5, 40, 10), s('bastidores', 9, 30, 0), s('ensinar', 6, 10, 2), s('ensinar', 12, 6, 2, 0.05)], now);
    expect(out).toEqual({ bastidores: 40, ensinar: 10 });
  });

  it('todos com alcance: vale a taxa', () => {
    const out = engagementByGoal([s('bastidores', 5, 40, 10, 0.08), s('bastidores', 9, 30, 0, 0.06), s('ensinar', 6, 900, 2, 0.02), s('ensinar', 12, 6, 2, 0.04)], now);
    expect(out.bastidores).toBeCloseTo(0.07, 6);
    expect(out.ensinar).toBeCloseTo(0.03, 6);
  });

  it('amostra pequena, post novo demais ou velho demais, sem objetivo: fica de fora', () => {
    const out = engagementByGoal([s('bastidores', 5, 40, 10), s('ensinar', 6, 10, 2), s('ensinar', 1, 500, 50), s('ensinar', 120, 500, 50), s(null, 5, 999, 9), s('auto', 5, 1, 1), s('auto', 6, 1, 1)], now);
    expect(out).toEqual({});
  });

  it('ligado ao planejador: puxa para o que mais engaja só com 2 objetivos medidos', () => {
    const samples = [s('bastidores', 5, 40, 10), s('bastidores', 9, 30, 0), s('novidade', 6, 5, 0), s('novidade', 12, 3, 1)];
    const out = planSuggestions({ ...base, slots: [at(22)], history: [past(20, 'ensinar')], engagement: engagementByGoal(samples, now) });
    expect(out[0]).toMatchObject({ goal: 'bastidores', reason: 'Bastidores é o que mais engaja na sua conta.' });
    const single = planSuggestions({ ...base, slots: [at(22)], history: [past(20, 'ensinar')], engagement: engagementByGoal(samples.slice(0, 2), now) });
    expect(single[0].reason).not.toMatch(/engaja/);
  });
});

describe('campanha no planejador (SPEC 018)', () => {
  const campaign = (over = {}) => ({ id: 'c1', name: 'Encomendas de fim de ano', goals: KIND_GOALS.vender, remaining: 2, plannedTotal: 0, offering: 'Caixas de panetone', ...over });
  const slots3 = [at(22), at(24), at(27)];

  it('sem campanha, toda sugestão é de rotação (ou foto, ou data) e não leva campaignId', () => {
    const out = planSuggestions({ ...base, slots: slots3, history: [past(20, 'ensinar')] });
    expect(out.every((s) => s.campaignId === null && s.rule !== 'campaign')).toBe(true);
    expect(out.map((s) => s.rule)).toEqual(['rotation', 'rotation', 'rotation']);
  });

  it('com 3 horários livres, 2 são da campanha (o primeiro e o último), alternados com a rotação', () => {
    const out = planSuggestions({ ...base, slots: slots3, history: [past(20, 'promocao')], campaign: campaign() });
    expect(out.map((s) => s.rule)).toEqual(['campaign', 'rotation', 'campaign']);
    expect(out.map((s) => s.campaignId)).toEqual(['c1', null, 'c1']);
    for (const s of [out[0], out[2]]) expect(KIND_GOALS.vender).toContain(s.goal);
  });

  it('o motivo da campanha sai de template: nome, "k de n posts da semana", o objetivo e o que decidiu', () => {
    const out = planSuggestions({ ...base, slots: slots3, history: [past(20, 'promocao')], campaign: campaign() });
    expect(out[0].reason).toBe('Campanha Encomendas de fim de ano: 1 de 2 posts da semana. Mostrar o produto ou serviço; o último foi promoção.');
    expect(out[2].reason).toMatch(/^Campanha Encomendas de fim de ano: 2 de 2 posts da semana\. /);
    expect(out.every((s) => s.reason.length <= 200)).toBe(true);
    const long = planSuggestions({ ...base, slots: [at(22)], history: [], campaign: campaign({ name: 'x'.repeat(80), remaining: 1 }) });
    expect(long[0].reason.length).toBeLessThanOrEqual(200);
    expect(long[0].reason).toContain('...');
  });

  it('plannedTotal conta os posts de campanha que a semana já tem', () => {
    const out = planSuggestions({ ...base, slots: [at(22)], history: [], campaign: campaign({ remaining: 1, plannedTotal: 2 }) });
    expect(out[0].reason).toMatch(/^Campanha Encomendas de fim de ano: 3 de 3 posts da semana\./);
  });

  it('com a data dos posts de campanha que já existem, o motivo numera na ordem do calendário', () => {
    const out = planSuggestions({ ...base, slots: [at(22), at(27)], history: [], campaign: campaign({ remaining: 1, plannedTotal: 1, existingSlots: [at(24)] }) });
    expect(out[0].reason).toMatch(/^Campanha Encomendas de fim de ano: 1 de 2 posts da semana\./);
    const after = planSuggestions({ ...base, slots: [at(27)], history: [], campaign: campaign({ remaining: 1, plannedTotal: 1, existingSlots: [at(24)] }) });
    expect(after[0].reason).toMatch(/^Campanha Encomendas de fim de ano: 2 de 2 posts da semana\./);
  });

  it('as travas valem dentro da campanha: sem repetir o objetivo anterior e promoção a cada 4 posts', () => {
    const noRepeat = planSuggestions({ ...base, slots: [at(22)], history: [past(20, 'produto')], campaign: campaign({ remaining: 1 }) });
    expect(noRepeat[0].goal).not.toBe('produto');
    expect(['promocao', 'prova_social']).toContain(noRepeat[0].goal);
    const promoRecent = planSuggestions({ ...base, slots: [at(22)], history: [past(19, 'promocao'), past(20, 'produto'), past(21, 'bastidores')], campaign: campaign({ remaining: 1 }) });
    expect(promoRecent[0].goal).toBe('prova_social');
  });

  it('data comemorativa ganha da campanha: o horário da data não é da campanha, e o resto da cota vai para ela', () => {
    const dates = commemorativeDates(2026);
    const out = planSuggestions({ ...base, now: new Date('2026-10-08T15:00:00Z'), slots: ['2026-10-09T21:00:00.000Z', '2026-10-10T21:00:00.000Z', '2026-10-14T21:00:00.000Z'], history: [], dates, campaign: campaign({ remaining: 2 }) });
    expect(out[0]).toMatchObject({ goal: 'data_comemorativa', rule: 'date', campaignId: null });
    expect(out.slice(1).map((s) => s.rule)).toEqual(['campaign', 'campaign']);
  });

  it('a foto do banco só entra na campanha se o objetivo dela casa com o tipo', () => {
    const caixa = { id: 'p2', description: 'Caixa de panetone', tags: ['produto'] };
    // "divulgar" puxa novidade, bastidores e conversa: foto de produto não casa e fica de fora
    const none = planSuggestions({ ...base, slots: [at(22)], history: [past(20, 'ensinar')], photos: [caixa], campaign: campaign({ remaining: 1, goals: KIND_GOALS.divulgar }) });
    expect(none[0]).toMatchObject({ assetId: null, rule: 'campaign' });
    expect(KIND_GOALS.divulgar).toContain(none[0].goal);
    // "vender" puxa produto: a foto entra e o motivo diz isso
    const out = planSuggestions({ ...base, slots: [at(22)], history: [past(20, 'ensinar')], photos: [caixa], campaign: campaign({ remaining: 1 }) });
    expect(out[0]).toMatchObject({ assetId: 'p2', goal: 'produto', rule: 'campaign', campaignId: 'c1' });
    expect(out[0].reason).toBe('Campanha Encomendas de fim de ano: 1 de 1 posts da semana. Mostrar o produto ou serviço com a foto "Caixa de panetone"; o último foi ensinar algo.');
  });

  it('Trocar mantém o grupo: horário de campanha segue de campanha, o de rotação segue de rotação', () => {
    const inCampaign = planSuggestions({ ...base, slots: [at(24)], history: [past(20, 'ensinar')], campaign: campaign({ remaining: 0, plannedTotal: 1 }), slotRules: { [at(24)]: 'campaign' }, avoid: { [at(24)]: ['produto'] } });
    expect(inCampaign[0]).toMatchObject({ rule: 'campaign', campaignId: 'c1' });
    expect(inCampaign[0].goal).not.toBe('produto');
    const free = planSuggestions({ ...base, slots: [at(24)], history: [past(20, 'ensinar')], campaign: campaign({ remaining: 0, plannedTotal: 1 }), slotRules: { [at(24)]: 'free' } });
    expect(free[0]).toMatchObject({ rule: 'rotation', campaignId: null });
  });

  it('sem cota restante a campanha não ocupa horário; o mesmo insumo dá o mesmo resultado', () => {
    const full = planSuggestions({ ...base, slots: slots3, history: [], campaign: campaign({ remaining: 0, plannedTotal: 2 }) });
    expect(full.every((s) => s.campaignId === null)).toBe(true);
    const input = { ...base, slots: slots3, history: [past(20, 'ensinar')], campaign: campaign() };
    expect(planSuggestions(input)).toEqual(planSuggestions(input));
  });

  it('a cota da semana: 60% para cima, sempre com um horário para a rotação', () => {
    expect([1, 2, 3, 5].map(campaignSlotQuota)).toEqual([1, 1, 2, 3]);
  });
});

describe('ideia da sugestão com campanha e fatos (SPEC 018)', () => {
  it('o pedido ao modelo leva a campanha, só os fatos que valem e o que não pode dizer; os itens da campanha vêm marcados', () => {
    const prompt = ideasPrompt({
      niche: 'Confeitaria',
      offering: 'Bolos',
      campaign: { name: 'Encomendas de fim de ano', objective: 'Vender as caixas até 15 de dezembro', offering: 'Caixas de panetone', audience: 'Famílias', restrictions: ['desconto'] },
      facts: ['Entregamos no mesmo dia'],
      never: ['sem açúcar'],
      items: [{ i: 0, goal: 'produto', photo: null, date: null, campaign: true }, { i: 1, goal: 'bastidores', photo: 'Forno aceso', date: null }],
    });
    expect(prompt).toContain('Campanha ativa: Encomendas de fim de ano.');
    expect(prompt).toContain('Resultado que a empresa quer: Vender as caixas até 15 de dezembro.');
    expect(prompt).toContain('- Entregamos no mesmo dia');
    expect(prompt).toContain('- sem açúcar');
    expect(prompt).toContain('- desconto');
    expect(prompt).toMatch(/0\. objetivo: [^\n]*; campanha: sim/);
    expect(prompt).not.toMatch(/1\. objetivo: [^\n]*campanha: sim/);
    expect(prompt).not.toMatch(/[—–]/);
    expect(ideasPrompt({ niche: null, offering: null, items: [] })).toContain('Não há fatos cadastrados: não use número, preço nem prazo.');
  });

  it('dicas do público (SPEC 022): entram como pista leve, depois dos fatos e do que não se diz, e somem sem dica', () => {
    const items = [{ i: 0, goal: 'ensinar', photo: null, date: null }];
    const withHints = ideasPrompt({ niche: 'Confeitaria', offering: 'Bolos', items, never: ['garantia'], hints: ['Posts informativos renderam 1,8 vez o engajamento dos de atmosfera.', 'Seu público tem 67% entre 25 e 44 anos.'] });
    expect(withHints).toContain('O que os números desta conta mostram (use só como pista de tom e de assunto, sem mudar os itens abaixo):');
    expect(withHints).toContain('- Posts informativos renderam 1,8 vez o engajamento dos de atmosfera.');
    expect(withHints.indexOf('Nunca diga:')).toBeLessThan(withHints.indexOf('O que os números desta conta mostram'));
    expect(withHints.indexOf('O que os números desta conta mostram')).toBeLessThan(withHints.indexOf('Itens:'));
    for (const none of [undefined, []]) expect(ideasPrompt({ niche: null, offering: null, items, hints: none })).not.toContain('O que os números desta conta mostram');
  });

  it('a ideia com número fora dos fatos, "nunca afirmar", palavra proibida ou travessão é barrada; a oferta da campanha libera o número dela', () => {
    const ctx = { facts: ['Entregamos no mesmo dia'], never: ['sem açúcar'], banned: ['imperdível'], inactive: [{ text: 'Bolo de pote por R$ 18', reason: 'expired', validUntil: '2026-10-15' }] };
    expect(ideaProblems('Mostre o forno aceso logo cedo', ctx)).toEqual([]);
    expect(ideaProblems('Bolo de pote por R$ 18 só hoje', ctx)).toEqual(['fact_not_valid']);
    expect(ideaProblems('Caixa por R$ 89 para presente', ctx)).toEqual(['number_not_in_facts']);
    expect(ideaProblems('Caixa por R$ 89 para presente', { ...ctx, allowed: ['Caixa de panetone por R$ 89'] })).toEqual([]);
    expect(ideaProblems('Bolo sem açúcar para a ceia', ctx)).toEqual(['never_claim']);
    expect(ideaProblems('Oferta imperdível de Natal', ctx)).toEqual(['banned_word']);
    expect(ideaProblems('Natal na vitrine — encomende já', ctx)).toEqual(['dash']);
  });

  it('o fallback usa o texto da campanha nos itens dela, e continua igual nos outros', () => {
    expect(fallbackIdea('produto', null, null, 'Caixas de panetone para presente')).toBe('Mostrar o produto ou serviço: Caixas de panetone para presente');
    expect(fallbackIdea('produto', null, null, 'x'.repeat(300)).length).toBe(160);
    expect(fallbackIdea('bastidores', 'Forno aceso', null)).toBe('Bastidores: Forno aceso');
    expect(fallbackIdea('data_comemorativa', null, 'Dia das Crianças', 'Caixas')).toBe('Dia das Crianças: um post ligando a data ao que a empresa faz');
  });
});
