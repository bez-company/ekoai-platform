// A Agenda com os horários dentro dela (SPEC 017 decisão 13, BEZ-233): recorte de semana e mês no
// fuso editorial, horários como espaços vazios ou ocupados, avulsos e a fila ao lado.
import { describe, it, expect } from 'vitest';
import { agendaRange, agendaWindow, buildAgenda, parseAgendaQuery, localDate } from '../platform/src/lib/agenda-model.ts';

const TZ = -3;
const NOW = Date.parse('2026-10-22T15:00:00Z'); // quinta 22/10, 12h em Brasília
const slot = (id, weekday, hour, minute = 0, channel = 'instagram') => ({ id, channel, weekday, hour, minute, active: true });
const post = (id, scheduled_for, status = 'scheduled', channel = 'instagram') => ({ id, channel, status, scheduled_for, caption_final: id, image_url: null, last_error: null });

describe('período da agenda', () => {
  it('lê view e data da URL; valor estranho cai na semana de hoje no fuso editorial', () => {
    expect(parseAgendaQuery(new URLSearchParams('view=month&date=2026-11-03'), NOW, TZ)).toEqual({ view: 'month', date: '2026-11-03' });
    expect(parseAgendaQuery(new URLSearchParams('view=ano&date=2026-02-31'), NOW, TZ)).toEqual({ view: 'week', date: '2026-10-22' });
    // 01h UTC de sexta ainda é quinta em Brasília
    expect(localDate(Date.parse('2026-10-23T01:00:00Z'), TZ)).toBe('2026-10-22');
  });

  it('semana de segunda a domingo; mês em semanas inteiras, com o anterior e o próximo', () => {
    expect(agendaRange({ view: 'week', date: '2026-10-22' })).toMatchObject({ first: '2026-10-19', last: '2026-10-25', prev: '2026-10-12', next: '2026-10-26' });
    expect(agendaRange({ view: 'week', date: '2026-10-25' })).toMatchObject({ first: '2026-10-19' }); // domingo fecha a semana
    expect(agendaRange({ view: 'month', date: '2026-10-22' })).toEqual({ first: '2026-09-28', last: '2026-11-01', monthStart: '2026-10-01', monthEnd: '2026-10-31', prev: '2026-09-01', next: '2026-11-01' });
    expect(agendaRange({ view: 'month', date: '2026-12-10' })).toMatchObject({ monthEnd: '2026-12-31', next: '2027-01-01', prev: '2026-11-01' });
    expect(agendaWindow({ view: 'week', date: '2026-10-22' }, TZ)).toEqual({ fromIso: '2026-10-19T03:00:00.000Z', toIso: '2026-10-26T03:00:00.000Z' });
  });
});

describe('montagem da agenda', () => {
  const slots = [slot('s-ter', 2, 18), slot('s-qui', 4, 18), slot('s-sab', 6, 10, 30), { ...slot('s-off', 1, 9), active: false }];

  it('cada horário vira espaço do dia: ocupado pelo post daquele horário ou vazio', () => {
    const posts = [post('p-qui', '2026-10-22T21:00:00Z'), post('p-fila', null, 'queued')];
    const a = buildAgenda({ query: { view: 'week', date: '2026-10-22' }, slots, posts, nowMs: NOW, tzHours: TZ });
    expect(a.days.map((d) => d.date)).toEqual(['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25']);
    expect(a.slots).toBe(3); // o inativo não conta
    const terca = a.days[1];
    expect(terca.cells).toEqual([{ kind: 'slot', at: '2026-10-20T21:00:00.000Z', time: '18:00', channel: 'instagram', slotId: 's-ter', post: null, suggestion: null }]);
    expect(terca.past).toBe(true);
    const quinta = a.days[3];
    expect(quinta.cells[0]).toMatchObject({ kind: 'slot', slotId: 's-qui', post: { id: 'p-qui' } });
    expect(quinta.past).toBe(false);
    expect(a.days[5].cells[0]).toMatchObject({ time: '10:30', at: '2026-10-24T13:30:00.000Z', post: null });
    expect(a.days[0].cells).toEqual([]); // segunda: só o horário inativo
    expect(a.queue.map((p) => p.id)).toEqual(['p-fila']);
  });

  it('post fora de horário (publicar agora, horário à mão) aparece como avulso, na ordem do dia', () => {
    const posts = [post('p-avulso', '2026-10-22T13:15:00Z', 'published'), post('p-qui', '2026-10-22T21:00:00Z')];
    const a = buildAgenda({ query: { view: 'week', date: '2026-10-22' }, slots, posts, nowMs: NOW, tzHours: TZ });
    expect(a.days[3].cells.map((c) => [c.kind, c.time, c.post?.id])).toEqual([['extra', '10:15', 'p-avulso'], ['slot', '18:00', 'p-qui']]);
  });

  it('dois posts no mesmo horário: um ocupa o espaço, o outro vira avulso (nada some)', () => {
    const posts = [post('a', '2026-10-22T21:00:00Z'), post('b', '2026-10-22T21:00:00Z')];
    const cells = buildAgenda({ query: { view: 'week', date: '2026-10-22' }, slots, posts, nowMs: NOW, tzHours: TZ }).days[3].cells;
    expect(cells.map((c) => c.kind).sort()).toEqual(['extra', 'slot']);
    expect(cells.map((c) => c.post.id).sort()).toEqual(['a', 'b']);
  });

  it('mês: dias fora do mês ficam marcados; filtro por rede deixa só os horários e posts dela', () => {
    const mixed = [...slots, slot('s-li', 4, 9, 0, 'linkedin')];
    const a = buildAgenda({ query: { view: 'month', date: '2026-10-05' }, slots: mixed, posts: [], nowMs: NOW, tzHours: TZ, channel: 'instagram' });
    expect(a.days).toHaveLength(35);
    expect(a.days[0]).toMatchObject({ date: '2026-09-28', inRange: false });
    expect(a.days[3]).toMatchObject({ date: '2026-10-01', inRange: true });
    expect(a.days.flatMap((d) => d.cells).every((c) => c.channel === 'instagram')).toBe(true);
  });
});

describe('sugestões do coordenador na agenda', () => {
  const slots = [slot('s-qui', 4, 18), slot('s-sex', 5, 18), slot('s-li', 5, 18, 0, 'linkedin'), slot('s-ter', 2, 18)];
  const sug = (id, slotAt) => ({ id, slotAt, goal: 'bastidores', goalLabel: 'Bastidores', assetId: null, idea: 'Como a massa é feita', reason: 'Os dois últimos foram dicas.' });

  it('a sugestão aparece no horário vazio do Instagram, não no ocupado, no de outra rede nem no passado', () => {
    const a = buildAgenda({
      query: { view: 'week', date: '2026-10-22' },
      slots,
      posts: [post('p-qui', '2026-10-22T21:00:00Z')],
      nowMs: NOW,
      tzHours: TZ,
      suggestions: [sug('g-qui', '2026-10-22T21:00:00.000Z'), sug('g-sex', '2026-10-23T21:00:00.000Z'), sug('g-ter', '2026-10-20T21:00:00.000Z'), sug('g-solta', '2026-10-24T15:00:00.000Z')],
    });
    const byDay = Object.fromEntries(a.days.map((d) => [d.date, d.cells]));
    expect(byDay['2026-10-22'][0]).toMatchObject({ post: { id: 'p-qui' }, suggestion: null });
    const sexta = byDay['2026-10-23'];
    expect(sexta.find((c) => c.channel === 'instagram')).toMatchObject({ post: null, suggestion: { id: 'g-sex', reason: 'Os dois últimos foram dicas.' } });
    expect(sexta.find((c) => c.channel === 'linkedin').suggestion).toBeNull();
    expect(byDay['2026-10-20'][0].suggestion).toBeNull(); // terça já passou
    expect(a.days.flatMap((d) => d.cells).filter((c) => c.suggestion).map((c) => c.suggestion.id)).toEqual(['g-sex']);
  });
});

describe('títulos e contagem da agenda', () => {
  it('título da semana e do mês, com virada de mês e de ano', async () => {
    const { agendaTitle, agendaCounts } = await import('../platform/src/lib/agenda-model.ts');
    expect(agendaTitle({ view: 'week', from: '2026-10-19', to: '2026-10-25', days: [] })).toBe('19 a 25 de outubro');
    expect(agendaTitle({ view: 'week', from: '2026-09-28', to: '2026-10-04', days: [] })).toBe('28 de setembro a 4 de outubro');
    expect(agendaTitle({ view: 'week', from: '2026-12-28', to: '2027-01-03', days: [] })).toBe('28 de dezembro de 2026 a 3 de janeiro de 2027');
    const month = buildAgenda({ query: { view: 'month', date: '2026-10-05' }, slots: [], posts: [], nowMs: NOW, tzHours: TZ });
    expect(agendaTitle(month)).toBe('outubro de 2026');
    const week = buildAgenda({ query: { view: 'week', date: '2026-10-22' }, slots: [slot('a', 4, 18), slot('b', 6, 10)], posts: [post('p', '2026-10-22T21:00:00Z')], nowMs: NOW, tzHours: TZ });
    expect(agendaCounts(week)).toEqual({ posts: 1, slots: 2, free: 1 });
    expect(week.days.filter((d) => d.today).map((d) => d.date)).toEqual(['2026-10-22']);
  });
});
