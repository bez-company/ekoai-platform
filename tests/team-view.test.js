import { describe, it, expect } from 'vitest';
import * as v from '../platform/src/lib/team-view.ts';

describe('vagas do plano', () => {
  it('conta membros e só convites pendentes', () => {
    const s = v.seatUsage({ members: 2, invitations: [{ status: 'pending' }, { status: 'expired' }], maxSeats: 5 });
    expect(s).toMatchObject({ used: 3, max: 5, free: 2, full: false, label: '3 de 5 pessoas' });
  });

  it('cheio quando membros mais convites chegam ao limite', () => {
    const s = v.seatUsage({ members: 3, invitations: [{ status: 'pending' }, { status: 'pending' }], maxSeats: 5 });
    expect(s).toMatchObject({ used: 5, free: 0, full: true });
  });

  it('plano sem limite (Time) mostra só quantas pessoas e nunca fica cheio', () => {
    const s = v.seatUsage({ members: 3, invitations: [{ status: 'pending' }], maxSeats: 1000 });
    expect(s).toMatchObject({ used: 4, unlimited: true, full: false, label: '4 pessoas' });
    expect(v.seatUsage({ members: 1, invitations: [], maxSeats: 1000 }).label).toBe('1 pessoa');
    expect(v.seatUsage({ members: 999, invitations: [{ status: 'pending' }], maxSeats: 1000 }).full).toBe(false);
    expect(v.seatLimitLabel(7, 1000)).toBe('7 (sem limite)');
    expect(v.seatLimitLabel(3, 5)).toBe('3 de 5');
  });

  it('plano de uma pessoa fala no singular e nunca dá vaga negativa', () => {
    const s = v.seatUsage({ members: 1, invitations: [], maxSeats: 1 });
    expect(s).toMatchObject({ label: '1 de 1 pessoa', free: 0, full: true });
    expect(v.seatUsage({ members: 4, invitations: [], maxSeats: 1 }).free).toBe(0);
  });
});

describe('iniciais', () => {
  it('duas palavras, uma palavra e só e-mail', () => {
    expect(v.initials('Ana Souza Lima', 'ana@x.com')).toBe('AL');
    expect(v.initials('Ana', 'ana@x.com')).toBe('AN');
    expect(v.initials(null, 'bia@x.com')).toBe('B');
    expect(v.initials('  ', 'caio@x.com')).toBe('C');
  });
});

describe('administradores e validade', () => {
  it('conta só administradores', () => {
    expect(v.adminCount([{ role: 'admin' }, { role: 'viewer' }, { role: 'admin' }, { role: 'creator' }])).toBe(2);
  });

  it('texto da validade do convite', () => {
    expect(v.inviteExpiry('expired', 0)).toBe('Venceu');
    expect(v.inviteExpiry('pending', 1)).toBe('Vence em 1 dia');
    expect(v.inviteExpiry('pending', 5)).toBe('Vence em 5 dias');
  });
});

describe('último acesso (SPEC 029)', () => {
  const now = Date.parse('2026-10-28T15:00:00Z'); // 12h em Brasília
  it('hoje, ontem, há N dias e a data', () => {
    expect(v.lastAccessLabel('2026-10-28T13:00:00Z', now)).toBe('Último acesso hoje');
    expect(v.lastAccessLabel('2026-10-27T20:00:00Z', now)).toBe('Último acesso ontem');
    expect(v.lastAccessLabel('2026-10-25T15:00:00Z', now)).toBe('Último acesso há 3 dias');
    expect(v.lastAccessLabel('2026-10-12T15:00:00Z', now)).toBe('Último acesso em 12/10/2026');
  });

  it('conta o dia no horário de Brasília, não em UTC', () => {
    // 01:30 UTC do dia 28 ainda é 22:30 do dia 27 em Brasília: ontem
    expect(v.lastAccessLabel('2026-10-28T01:30:00Z', now)).toBe('Último acesso ontem');
  });

  it('sem login ou data inválida: ainda não entrou', () => {
    expect(v.lastAccessLabel(null, now)).toBe('Ainda não entrou');
    expect(v.lastAccessLabel('lixo', now)).toBe('Ainda não entrou');
  });
});

describe('única pessoa administradora', () => {
  it('só quando é a única com o papel de administrador', () => {
    const team = [{ userId: 'a', role: 'admin' }, { userId: 'b', role: 'creator' }];
    expect(v.isSoleAdmin(team, 'a')).toBe(true);
    expect(v.isSoleAdmin(team, 'b')).toBe(false);
    expect(v.isSoleAdmin([...team, { userId: 'c', role: 'admin' }], 'a')).toBe(false);
    expect(v.isSoleAdmin([], 'a')).toBe(false);
  });
});
