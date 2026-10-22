import { describe, it, expect } from 'vitest';
import { nextStep, daysUntil } from '../platform/src/lib/home-model.ts';

const ok = { instagram: 'active', instagramExpiresInDays: 40, failed: 0, paused: false, scheduled: 2, queued: 0, pending: 0, hasSlots: true, scheduledThisWeek: 2 };
const admin = { approve: true, publishing: true, channels: true, create: true };
const id = (f, can = admin) => nextStep({ ...ok, ...f }, can)?.id ?? null;

describe('próximo passo do Início (SPEC 017, decisão 3)', () => {
  it('conta em dia: nenhum passo', () => {
    expect(id({})).toBeNull();
  });

  it('cada situação dá o seu passo, com a ação', () => {
    expect(nextStep({ ...ok, pending: 2 }, admin)).toMatchObject({ id: 'pending', title: '2 posts esperando aprovação', action: { href: '/inbox' } });
    expect(nextStep({ ...ok, pending: 1 }, admin).title).toBe('1 post esperando aprovação');
    expect(id({ hasSlots: false })).toBe('no_slots');
    expect(id({ instagram: 'none' })).toBe('instagram_connect');
    expect(id({ instagram: 'reauth_required' })).toBe('instagram_reauth');
    expect(id({ failed: 1 })).toBe('failed');
    expect(id({ queued: 3 })).toBe('queued');
    expect(id({ scheduledThisWeek: 0 })).toBe('empty_week');
  });

  it('token: vence em 3 dias ou menos avisa; com 4 não', () => {
    expect(nextStep({ ...ok, instagramExpiresInDays: 2 }, admin)).toMatchObject({ id: 'instagram_expiring', title: 'A conexão do Instagram vence em 2 dias' });
    expect(nextStep({ ...ok, instagramExpiresInDays: 1 }, admin).title).toBe('A conexão do Instagram vence em 1 dia');
    expect(nextStep({ ...ok, instagramExpiresInDays: 0 }, admin).title).toBe('A conexão do Instagram vence hoje');
    expect(id({ instagramExpiresInDays: 4 })).toBeNull();
  });

  it('pausa só vira passo quando há post aprovado esperando', () => {
    expect(nextStep({ ...ok, paused: true, scheduled: 1, queued: 1 }, admin)).toMatchObject({ id: 'paused', detail: '2 posts aprovados esperam a publicação voltar.' });
    expect(id({ paused: true, scheduled: 0, queued: 0 })).toBeNull();
  });

  it('o que impede publicar vem antes do que só atrasa', () => {
    const all = { instagram: 'reauth_required', failed: 1, paused: true, pending: 3, hasSlots: false, queued: 2, scheduledThisWeek: 0 };
    expect(id(all)).toBe('instagram_reauth');
    expect(id({ ...all, instagram: 'active' })).toBe('failed');
    expect(id({ ...all, instagram: 'active', failed: 0 })).toBe('paused');
    expect(id({ ...all, instagram: 'active', failed: 0, paused: false })).toBe('pending');
    expect(id({ ...all, instagram: 'active', failed: 0, paused: false, pending: 0 })).toBe('no_slots');
  });

  it('cada papel só vê o passo que pode fazer', () => {
    const creator = { approve: false, publishing: false, channels: false, create: true };
    expect(id({ instagram: 'none', pending: 2, hasSlots: false, scheduledThisWeek: 0 }, creator)).toBe('empty_week');
    expect(id({ instagram: 'none', pending: 2 }, { ...creator, approve: true })).toBe('pending');
    expect(id({ instagram: 'none' }, { approve: false, publishing: false, channels: false, create: false })).toBeNull();
  });
});

describe('dias até vencer', () => {
  const now = Date.parse('2026-10-22T12:00:00Z');
  it('arredonda para baixo; vencido é negativo; sem data é nulo', () => {
    expect(daysUntil('2026-10-25T13:00:00Z', now)).toBe(3);
    expect(daysUntil('2026-10-25T11:00:00Z', now)).toBe(2);
    expect(daysUntil('2026-10-21T12:00:00Z', now)).toBe(-1);
    expect(daysUntil(null, now)).toBeNull();
    expect(daysUntil('x', now)).toBeNull();
  });
});
