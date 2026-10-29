import { describe, it, expect } from 'vitest';
import { instagramView, linkedinView, networkLimitReached, NETWORK_LIMIT_REASON } from '../platform/src/lib/channels-view.ts';

const NOW = Date.UTC(2026, 9, 22);
const day = (n) => new Date(NOW + n * 86_400_000).toISOString();
const acc = (over = {}) => ({ id: 'a1', channel: 'instagram', handle: 'ekoai.app', status: 'active', expiresAt: day(50), connectedAt: day(-10), ...over });
const base = { accounts: [], configured: true, canManage: true, maxAccounts: 1, nowMs: NOW };

describe('instagramView', () => {
  it('sem conta: administrador conecta', () => {
    expect(instagramView(base)).toEqual({ kind: 'none', canConnect: true, blockedReason: null });
  });

  it('sem conta: quem não administra recebe o próximo passo, sem botão', () => {
    const v = instagramView({ ...base, canManage: false });
    expect(v).toMatchObject({ kind: 'none', canConnect: false });
    expect(v.blockedReason).toMatch(/administradores/);
  });

  it('ambiente sem o app da Meta configurado não oferece o botão', () => {
    const v = instagramView({ ...base, configured: false });
    expect(v).toMatchObject({ kind: 'none', canConnect: false });
    expect(v.blockedReason).toMatch(/ainda não está ativa/);
  });

  it('conta ativa mostra os dias que faltam e só avisa quando está perto de vencer', () => {
    expect(instagramView({ ...base, accounts: [acc()] })).toMatchObject({ kind: 'connected', handle: 'ekoai.app', daysLeft: 50, expiringSoon: false });
    expect(instagramView({ ...base, accounts: [acc({ expiresAt: day(10) })] })).toMatchObject({ kind: 'connected', daysLeft: 10, expiringSoon: true });
  });

  it('precisa reconectar quando o status pede ou o prazo acabou', () => {
    expect(instagramView({ ...base, accounts: [acc({ status: 'reauth_required' })] })).toMatchObject({ kind: 'reauth', id: 'a1' });
    expect(instagramView({ ...base, accounts: [acc({ expiresAt: day(-1) })] })).toMatchObject({ kind: 'reauth' });
  });

  it('conta revogada não conta: volta ao estado sem conexão', () => {
    expect(instagramView({ ...base, accounts: [acc({ status: 'revoked' })] })).toMatchObject({ kind: 'none', canConnect: true });
  });

  it('só o canal do Instagram entra na conta', () => {
    expect(instagramView({ ...base, accounts: [acc({ channel: 'linkedin' })] })).toMatchObject({ kind: 'none' });
  });
});

describe('limite de redes do plano (SPEC 021)', () => {
  const li = (over = {}) => acc({ id: 'l1', channel: 'linkedin', handle: 'Ana', ...over });
  const liBase = { accounts: [], configured: true, canManage: true, nowMs: NOW };

  it('plano de 1 rede com o Instagram conectado: o LinkedIn fica bloqueado, com o motivo', () => {
    const v = linkedinView({ ...liBase, accounts: [acc()], maxNetworks: 1 });
    expect(v).toEqual({ kind: 'none', canConnect: false, blockedReason: NETWORK_LIMIT_REASON });
  });

  it('plano de 1 rede: a rede que já está conectada continua conectada', () => {
    expect(instagramView({ ...base, accounts: [acc()], maxNetworks: 1 })).toMatchObject({ kind: 'connected' });
    expect(linkedinView({ ...liBase, accounts: [li()], maxNetworks: 1 })).toMatchObject({ kind: 'connected' });
  });

  it('plano de 3 redes com duas conectadas libera a terceira', () => {
    expect(linkedinView({ ...liBase, accounts: [acc()], maxNetworks: 3 })).toMatchObject({ kind: 'none', canConnect: true });
    expect(networkLimitReached([acc(), li()], 'x', 3)).toBe(false);
    expect(networkLimitReached([acc(), li(), acc({ id: 'x1', channel: 'x' })], 'tiktok', 3)).toBe(true);
  });

  it('duas contas da mesma rede contam como uma rede só', () => {
    expect(networkLimitReached([acc(), acc({ id: 'a2' })], 'linkedin', 2)).toBe(false);
  });

  it('conta revogada não ocupa vaga', () => {
    expect(networkLimitReached([acc({ status: 'revoked' })], 'linkedin', 1)).toBe(false);
  });

  it('sem limite no plano (ausente ou null) nunca bloqueia', () => {
    expect(networkLimitReached([acc(), li()], 'x', null)).toBe(false);
    expect(networkLimitReached([acc(), li()], 'x', undefined)).toBe(false);
    expect(linkedinView({ ...liBase, accounts: [acc()] })).toMatchObject({ kind: 'none', canConnect: true });
  });

  it('quem não administra continua recebendo o aviso de administrador, não o do plano', () => {
    const v = linkedinView({ ...liBase, canManage: false, accounts: [acc()], maxNetworks: 1 });
    expect(v.blockedReason).toMatch(/administradores/);
  });
});
