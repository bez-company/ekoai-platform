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
