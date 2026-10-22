import { describe, it, expect } from 'vitest';
import { instagramView } from '../platform/src/lib/channels-view.ts';

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
