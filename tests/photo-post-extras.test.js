import { describe, it, expect } from 'vitest';
import { parsePhotoPost, parseScheduledFor, parsePhotoRewrite, SCHEDULE_MAX_DAYS } from '../platform/src/lib/photo-post-model.ts';
import { ratioOf } from '../platform/src/lib/media-view.ts';

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const now = Date.parse('2026-10-22T15:00:00Z');
const base = { assetId: ID, ratio: '4:5', caption: 'Bolo saindo agora.', when: 'at' };

describe('escolher dia e hora (BEZ-254)', () => {
  it('aceita horário futuro e grava em ISO', () => {
    expect(parsePhotoPost({ ...base, scheduledFor: '2026-10-24T21:00:00.000Z' }, now)).toMatchObject({ ok: true, value: { when: 'at', scheduledFor: '2026-10-24T21:00:00.000Z' } });
  });

  it('recusa sem horário, no passado, em menos de 5 minutos e além de 90 dias', () => {
    expect(parsePhotoPost({ ...base }, now)).toMatchObject({ ok: false, field: 'scheduledFor' });
    expect(parseScheduledFor('2026-10-22T14:00:00Z', now)).toMatchObject({ ok: false, error: expect.stringMatching(/5 minutos/) });
    expect(parseScheduledFor('2026-10-22T15:03:00Z', now)).toMatchObject({ ok: false });
    expect(parseScheduledFor(new Date(now + (SCHEDULE_MAX_DAYS + 1) * 86_400_000).toISOString(), now)).toMatchObject({ ok: false, error: expect.stringMatching(/90 dias/) });
    expect(parseScheduledFor('amanhã', now)).toMatchObject({ ok: false });
  });

  it('agendar sem dia e hora segue como antes (próximo horário livre)', () => {
    expect(parsePhotoPost({ ...base, when: 'schedule', scheduledFor: 'ignorado' }, now)).toMatchObject({ ok: true, value: { when: 'schedule' } });
    expect(parsePhotoPost({ ...base, when: 'schedule' }, now).value.scheduledFor).toBeUndefined();
  });
});

describe('atalho da legenda do post de foto', () => {
  it('valida foto, atalho e legenda', () => {
    expect(parsePhotoRewrite({ assetId: ID, mode: 'shorter', caption: ' Bolo ', hashtags: ['#Bolo'] })).toEqual({ ok: true, value: { assetId: ID, mode: 'shorter', caption: 'Bolo', hashtags: ['bolo'] } });
    expect(parsePhotoRewrite({ assetId: ID, mode: 'poema', caption: 'x' })).toMatchObject({ ok: false, field: 'mode' });
    expect(parsePhotoRewrite({ assetId: ID, mode: 'cta', caption: '' })).toMatchObject({ ok: false, field: 'caption' });
    expect(parsePhotoRewrite({ mode: 'cta', caption: 'x' })).toMatchObject({ ok: false, field: 'assetId' });
  });
});

describe('formato do post em Aprovar', () => {
  it('lê 1:1 e 1.91:1 do pedido; o resto é 4:5', () => {
    expect(ratioOf('1.91:1')).toBe('1.91:1');
    expect(ratioOf('1:1')).toBe('1:1');
    expect(ratioOf(undefined)).toBe('4:5');
    expect(ratioOf('9:16')).toBe('4:5');
  });
});
