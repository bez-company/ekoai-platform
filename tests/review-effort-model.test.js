// Esforço da pessoa em Aprovar (BEZ-544): dois tempos (a espera do post e o tempo com ele aberto), a campanha e se a
// legenda mudou. Nada do texto do post entra no evento.
import { describe, it, expect } from 'vitest';
import { captionEdited, parseReviewMs, reviewEffortProps, REVIEW_MS_MAX } from '../platform/src/lib/review-effort-model.ts';
import { parseApprove, parseReject } from '../platform/src/lib/route-input.ts';

describe('parseReviewMs', () => {
  it('aceita inteiro de 0 a 4 h', () => {
    expect(parseReviewMs(0)).toBe(0);
    expect(parseReviewMs(95_000)).toBe(95_000);
    expect(parseReviewMs(REVIEW_MS_MAX)).toBe(REVIEW_MS_MAX);
  });

  it('aba esquecida, número quebrado, negativo ou texto viram ausente', () => {
    for (const raw of [REVIEW_MS_MAX + 1, 1.5, -1, '9000', null, undefined, Number.NaN]) expect(parseReviewMs(raw)).toBeNull();
  });

  it('entra no aprovar e no rejeitar, e um valor ruim não barra a decisão', () => {
    expect(parseApprove({ pendingId: 'p1', captionId: 1, artId: 1, reviewMs: 1200 })).toMatchObject({ ok: true, value: { reviewMs: 1200 } });
    expect(parseApprove({ pendingId: 'p1', captionId: 1, artId: 1, reviewMs: 'x' })).toMatchObject({ ok: true, value: { reviewMs: null } });
    expect(parseReject({ pendingId: 'p1', reviewMs: 3000 })).toMatchObject({ ok: true, value: { reviewMs: 3000 } });
    expect(parseReject({ pendingId: 'p1' })).toMatchObject({ ok: true, value: { reviewMs: null } });
  });
});

describe('captionEdited', () => {
  it('espaço e quebra de linha a mais não contam; palavra trocada conta', () => {
    expect(captionEdited('Bolo de pote\n\n#bolo ', 'Bolo de pote #bolo')).toBe(false);
    expect(captionEdited('Bolo de pote no capricho #bolo', 'Bolo de pote #bolo')).toBe(true);
  });
});

describe('reviewEffortProps', () => {
  const now = Date.parse('2026-11-04T15:00:00Z');

  it('espera desde a chegada em Aprovar, tempo aberto, rede, campanha e legenda editada', () => {
    const props = reviewEffortProps({ savedAt: '2026-11-04T13:00:00Z', channel: 'instagram', campaignId: '7d3f0c1e-2b4a-4c5d-8e9f-0a1b2c3d4e5f', captionEdited: true }, 95_000, now);
    expect(props).toEqual({ channel: 'instagram', wait_ms: 7_200_000, review_ms: 95_000, campaign_id: '7d3f0c1e-2b4a-4c5d-8e9f-0a1b2c3d4e5f', caption_edited: true });
  });

  it('sem campanha nem legenda (rejeitar), sem chegada conhecida e sem tempo do navegador', () => {
    expect(reviewEffortProps({ savedAt: null, channel: 'linkedin', campaignId: null }, null, now)).toEqual({ channel: 'linkedin', wait_ms: null, review_ms: null });
  });

  it('relógio do servidor atrás da chegada não dá espera negativa', () => {
    expect(reviewEffortProps({ savedAt: '2026-11-04T15:00:05Z', channel: 'instagram', campaignId: null }, null, now).wait_ms).toBe(0);
  });
});
