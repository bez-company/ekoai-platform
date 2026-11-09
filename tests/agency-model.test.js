// A agência e os clientes dela (SPEC 039, BEZ-265): validação da entrada, ordem do seletor e textos do menu.
import { describe, it, expect } from 'vitest';
import { accountDetail, groupAccounts, instagramLabel, isAgencyPlan, parseAgencyToggle, parseNewClient } from '../platform/src/lib/agency-model.ts';

describe('cadastro do cliente', () => {
  it('limpa o nome e recusa vazio ou longo', () => {
    expect(parseNewClient({ name: '  Padaria   Central ' })).toEqual({ ok: true, value: { name: 'Padaria Central' } });
    expect(parseNewClient({ name: '   ' })).toMatchObject({ ok: false, field: 'name' });
    expect(parseNewClient(null)).toMatchObject({ ok: false });
    expect(parseNewClient({ name: 'x'.repeat(81) })).toMatchObject({ ok: false, field: 'name' });
  });

  it('o console só aceita ligar ou desligar com booleano', () => {
    expect(parseAgencyToggle({ on: true })).toEqual({ ok: true, value: { on: true } });
    expect(parseAgencyToggle({ on: false })).toEqual({ ok: true, value: { on: false } });
    expect(parseAgencyToggle({ on: 'sim' }).ok).toBe(false);
  });

  it('só o plano agencia é agência', () => {
    expect(isAgencyPlan('agencia')).toBe(true);
    expect(isAgencyPlan('inicial')).toBe(false);
    expect(isAgencyPlan(null)).toBe(false);
  });
});

describe('seletor de conta', () => {
  const ag = { id: 'bez', name: 'BEZ', agencyId: null, isAgency: true };
  const c1 = { id: 'zeta', name: 'Zeta', agencyId: 'bez', isAgency: false };
  const c2 = { id: 'alfa', name: 'Alfa', agencyId: 'bez', isAgency: false };
  const solta = { id: 'solo', name: 'Solo', agencyId: null, isAgency: false };

  it('a agência vem primeiro, com os clientes em ordem alfabética, e as contas soltas no fim', () => {
    expect(groupAccounts([c1, solta, ag, c2])).toEqual([
      { label: 'BEZ', accounts: [ag, c2, c1] },
      { label: 'Outras contas', accounts: [solta] },
    ]);
  });

  it('sem agência, a lista não tem título', () => {
    expect(groupAccounts([solta])).toEqual([{ label: null, accounts: [solta] }]);
  });

  it('cliente de agência que a pessoa não vê entra como conta solta', () => {
    expect(groupAccounts([c1])).toEqual([{ label: null, accounts: [c1] }]);
  });
});

describe('textos', () => {
  it('a linha da conta no menu', () => {
    expect(accountDetail({ role: 'admin', isAgency: true, agencyName: null, tierName: 'Agência' })).toBe('Plano Agência');
    expect(accountDetail({ role: 'admin', isAgency: false, agencyName: 'BEZ', tierName: 'Time' })).toBe('Cliente de BEZ');
    expect(accountDetail({ role: 'creator', isAgency: false, agencyName: null, tierName: 'Time' })).toBe('Plano Time');
    expect(accountDetail({ role: 'viewer', isAgency: true, agencyName: null, tierName: 'Agência' })).toBe('Você acompanha como leitor');
  });

  it('o Instagram do cliente', () => {
    expect(instagramLabel(null)).toEqual({ text: 'Instagram não conectado', tone: 'muted' });
    expect(instagramLabel({ handle: 'padaria', status: 'active' })).toEqual({ text: '@padaria', tone: 'ok' });
    expect(instagramLabel({ handle: '@padaria', status: 'reauth_required' })).toEqual({ text: '@padaria: precisa reconectar', tone: 'warn' });
  });
});
