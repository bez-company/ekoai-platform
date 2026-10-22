import { describe, it, expect } from 'vitest';
import {
  parseApprove,
  parseScheduledAction,
  parseSlot,
  parsePause,
  parseReject,
  parseLogin,
  parseChannel,
  isUuid,
} from '../platform/src/lib/route-input.ts';
import { scrub } from '../platform/src/lib/log.ts';
import { UserError, userMessage, GENERIC_ERROR } from '../platform/src/lib/errors.ts';

const ID = '3f2a9c1e-7b4d-4e2a-9c11-aa00bb11cc22';

describe('route-input', () => {
  it('aprovar exige legenda e arte inteiras e horário válido', () => {
    expect(parseApprove({ pendingId: 'p1', captionId: 2, artId: 1 })).toMatchObject({ ok: true, value: { captionId: 2, artId: 1, noImage: false } });
    expect(parseApprove({ pendingId: 'p1', captionId: 'x', artId: 1 }).ok).toBe(false);
    expect(parseApprove({ captionId: 1, artId: 1 }).ok).toBe(false);
    expect(parseApprove({ pendingId: 'p1', captionId: 1, artId: 1, scheduledFor: 'amanhã' }).ok).toBe(false);
    const ok = parseApprove({ pendingId: 'p1', captionId: 1, artId: 1, scheduledFor: '2026-11-03T18:00:00-03:00' });
    expect(ok.value.scheduledFor).toBe('2026-11-03T21:00:00.000Z');
    expect(parseApprove(null).ok).toBe(false);
    expect(parseApprove({ pendingId: 'p1', captionId: 1, artId: 1 }).value.publishNow).toBe(false);
    expect(parseApprove({ pendingId: 'p1', captionId: 1, artId: 1, publishNow: true }).value.publishNow).toBe(true);
    expect(parseApprove({ pendingId: 'p1', captionId: 1, artId: 1, publishNow: 'sim' }).value.publishNow).toBe(false);
  });

  it('ação em agendado: id uuid, ação conhecida, data para reagendar', () => {
    expect(parseScheduledAction({ id: ID, action: 'cancel' })).toEqual({ ok: true, value: { id: ID, action: 'cancel' } });
    expect(parseScheduledAction({ id: 'abc', action: 'cancel' }).ok).toBe(false);
    expect(parseScheduledAction({ id: ID, action: 'apagar' }).ok).toBe(false);
    expect(parseScheduledAction({ id: ID, action: 'reschedule' }).ok).toBe(false);
    expect(parseScheduledAction({ id: ID, action: 'reschedule', scheduledFor: '2026-11-03T21:00:00Z' }).ok).toBe(true);
    expect(parseScheduledAction({ id: ID, action: 'publish_now' })).toEqual({ ok: true, value: { id: ID, action: 'publish_now' } });
  });

  it('slot: rede conhecida, dia 0-6, hora 0-23, minuto 0-59', () => {
    expect(parseSlot({ channel: 'instagram', weekday: 2, hour: 18 })).toEqual({
      ok: true,
      value: { channel: 'instagram', weekday: 2, hour: 18, minute: 0 },
    });
    expect(parseSlot({ channel: 'tiktok', weekday: 2, hour: 18 }).ok).toBe(false);
    expect(parseSlot({ channel: 'instagram', weekday: 7, hour: 18 }).ok).toBe(false);
    expect(parseSlot({ channel: 'instagram', weekday: 1, hour: 24 }).ok).toBe(false);
    expect(parseSlot({ channel: 'instagram', weekday: 1, hour: 9, minute: 60 }).ok).toBe(false);
  });

  it('pausa, rejeição, login e canal', () => {
    expect(parsePause({ paused: 'sim' }).ok).toBe(false);
    expect(parsePause({ paused: true, reason: '  feriado ' })).toEqual({ ok: true, value: { paused: true, reason: 'feriado' } });
    expect(parseReject({}).ok).toBe(false);
    expect(parseReject({ pendingId: 'p1', reason: 'fraco' }).value.reason).toBe('fraco');
    expect(parseLogin({}).ok).toBe(false);
    expect(parseLogin({ password: 'x'.repeat(201) }).ok).toBe(false);
    expect(parseChannel('linkedin')).toEqual({ ok: true, value: 'linkedin' });
    expect(parseChannel(null).ok).toBe(false);
    expect(isUuid(ID)).toBe(true);
  });
});

describe('erro e log', () => {
  it('só UserError chega na tela; o resto vira mensagem neutra', () => {
    expect(userMessage(new UserError('Pendência não encontrada.'))).toBe('Pendência não encontrada.');
    expect(userMessage(new Error('Falha ao ler: relation "posts" does not exist'))).toBe(GENERIC_ERROR);
  });

  it('log mascara segredo e email em qualquer nível', () => {
    expect(scrub({ route: 'x', token: 'abc', nested: { email: 'a@b.c', ok: 1 } })).toEqual({
      route: 'x',
      token: '[mascarado]',
      nested: { email: '[mascarado]', ok: 1 },
    });
  });
});

describe('grade de horários inteira (Agenda › Horários, BEZ-247)', () => {
  it('valida cada horário, tira repetidos e limita por dia e por semana', async () => {
    const { parseSlotList } = await import('../platform/src/lib/route-input.ts');
    expect(parseSlotList({ channel: 'instagram', slots: [{ weekday: 2, hour: 18 }, { weekday: 2, hour: 18, minute: 0 }, { weekday: 4, hour: 9, minute: 30 }] })).toEqual({
      ok: true,
      value: { channel: 'instagram', slots: [{ weekday: 2, hour: 18, minute: 0 }, { weekday: 4, hour: 9, minute: 30 }] },
    });
    expect(parseSlotList({ channel: 'instagram', slots: [] })).toEqual({ ok: true, value: { channel: 'instagram', slots: [] } });
    expect(parseSlotList({ channel: 'tiktok', slots: [] })).toMatchObject({ ok: false });
    expect(parseSlotList({ channel: 'instagram' })).toMatchObject({ ok: false });
    expect(parseSlotList({ channel: 'instagram', slots: [{ weekday: 9, hour: 18 }] })).toMatchObject({ ok: false });
    expect(parseSlotList({ channel: 'instagram', slots: [8, 9, 10, 11, 12].map((hour) => ({ weekday: 1, hour })) })).toMatchObject({ ok: false, error: 'Use até 4 horários por dia.' });
    expect(parseSlotList({ channel: 'instagram', slots: Array.from({ length: 29 }, (_, i) => ({ weekday: i % 7, hour: i })) })).toMatchObject({ ok: false });
  });
});
