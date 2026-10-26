import { describe, it, expect } from 'vitest';
import * as a from '../platform/src/lib/audience-model.ts';

// Resposta no formato do exemplo da documentação da Meta (v26): o timeframe vem como primeira dimensão.
const demographics = (breakdown, results, keys = ['timeframe', breakdown]) => ({
  data: [
    {
      name: 'follower_demographics',
      period: 'lifetime',
      total_value: { breakdowns: [{ dimension_keys: keys, results: results.map(([dim, value]) => ({ dimension_values: ['THIS_MONTH', dim], value })) }] },
    },
  ],
});

describe('faixa etária e gênero', () => {
  it('normaliza para fração do total e preenche faixa ausente com zero', () => {
    const age = a.parseDemographics(demographics('age', [['25-34', 38], ['35-44', 29], ['18-24', 14], ['45-54', 11], ['55-64', 4], ['13-17', 2], ['65+', 2]]), 'age');
    expect(age).toEqual({ '13-17': 0.02, '18-24': 0.14, '25-34': 0.38, '35-44': 0.29, '45-54': 0.11, '55-64': 0.04, '65+': 0.02 });
    const some = a.parseDemographics(demographics('age', [['25-34', 3], ['35-44', 1]]), 'age');
    expect(some['25-34']).toBe(0.75);
    expect(some['13-17']).toBe(0);
  });

  it('gênero: F, M e U; valor fora da lista é ignorado', () => {
    const g = a.parseDemographics(demographics('gender', [['F', 71], ['M', 27], ['U', 2], ['X', 50]]), 'gender');
    expect(g).toEqual({ F: 0.71, M: 0.27, U: 0.02 });
  });

  it('acha a dimensão pelo nome, com ou sem timeframe antes dela', () => {
    const sem = { data: [{ name: 'follower_demographics', total_value: { breakdowns: [{ dimension_keys: ['age'], results: [{ dimension_values: ['25-34'], value: 5 }] }] } }] };
    expect(a.parseDemographics(sem, 'age')['25-34']).toBe(1);
  });

  it('formato fora do esperado vira nulo, nunca exceção', () => {
    for (const bad of [null, 'x', {}, { data: 'x' }, { data: [] }, { data: [{ name: 'follower_demographics' }] }, demographics('age', [['25-34', 0]]), demographics('age', [['25-34', -3]]), demographics('age', [['99+', 4]])]) {
      expect(a.parseDemographics(bad, 'age')).toBeNull();
    }
    // pediu gênero e a resposta é de idade
    expect(a.parseDemographics(demographics('age', [['25-34', 5]]), 'gender')).toBeNull();
  });

  it('faixas somadas para a frase do aprendizado', () => {
    const age = a.parseDemographics(demographics('age', [['25-34', 38], ['35-44', 29], ['18-24', 14], ['45-54', 11], ['55-64', 4], ['13-17', 2], ['65+', 2]]), 'age');
    expect(a.ageShare(age, '25-34', '35-44')).toBe(0.67);
  });
});

describe('horário em que os seguidores estão online', () => {
  const day = (peak) => Object.fromEntries(Array.from({ length: 24 }, (_, h) => [String(h), h === peak ? 100 : h === peak - 1 ? 50 : 10]));

  it('vira 24 posições de 0 a 1 relativas ao pico', () => {
    const hours = a.parseOnlineHours({ data: [{ name: 'online_followers', period: 'lifetime', values: [{ value: day(19) }] }] });
    expect(hours).toHaveLength(24);
    expect(hours[19]).toBe(1);
    expect(hours[18]).toBe(0.5);
    expect(hours[3]).toBe(0.1);
  });

  it('média de vários dias', () => {
    const hours = a.parseOnlineHours({ data: [{ name: 'online_followers', values: [{ value: day(19) }, { value: day(20) }] }] });
    // 19h: (100 + 50) / 2 = 75 (o pico); 20h: (10 + 100) / 2 = 55; 18h: (50 + 10) / 2 = 30
    expect(hours[19]).toBe(1);
    expect(hours[20]).toBeCloseTo(55 / 75, 3);
    expect(hours[18]).toBeCloseTo(30 / 75, 3);
  });

  it('sem a métrica, sem horas ou só zeros, é nulo', () => {
    expect(a.parseOnlineHours({ data: [] })).toBeNull();
    expect(a.parseOnlineHours({ data: [{ name: 'online_followers', values: [{ value: {} }] }] })).toBeNull();
    expect(a.parseOnlineHours({ data: [{ name: 'online_followers', values: [{ value: day(5) && Object.fromEntries(Array.from({ length: 24 }, (_, h) => [String(h), 0])) }] }] })).toBeNull();
    expect(a.parseOnlineHours(undefined)).toBeNull();
  });
});

describe('seguidores, erro e estado do dia', () => {
  it('followers_count válido ou nulo', () => {
    expect(a.parseFollowers({ followers_count: 2310 })).toBe(2310);
    expect(a.parseFollowers({ followers_count: '2310' })).toBeNull();
    expect(a.parseFollowers(null)).toBeNull();
  });

  it('erro de 100 seguidores é distinto de permissão e de token', () => {
    const few = { error: { code: 100, message: '(#100) Not enough followers: requires at least 100 followers' } };
    expect(a.audienceFailure(few)).toBe('too_few_followers');
    expect(a.audienceFailure({ error: { code: 100, message: 'Invalid parameter' } })).toBe('other');
    expect(a.audienceFailure({ error: { code: 190 } })).toBe('token');
    expect(a.audienceFailure({ error: { code: 10 } })).toBe('permission');
  });

  it('estado: sem permissão, poucos seguidores, ok e indisponível', () => {
    const full = { followers: 2310, age: { '25-34': 1 }, gender: null, onlineHours: null };
    expect(a.resolveStatus(full, false, false)).toBe('no_permission');
    expect(a.resolveStatus({ ...full, followers: 87 }, true, false)).toBe('too_few_followers');
    expect(a.resolveStatus({ ...full, followers: null }, true, true)).toBe('too_few_followers');
    expect(a.resolveStatus(full, true, false)).toBe('ok');
    expect(a.resolveStatus({ followers: 2310, age: null, gender: null, onlineHours: null }, true, false)).toBe('unavailable');
    // só o horário online já basta para o dia contar como lido
    expect(a.resolveStatus({ followers: 2310, age: null, gender: null, onlineHours: [1] }, true, false)).toBe('ok');
  });
});
