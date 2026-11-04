// Como o pedido de material aparece (SPEC 036; protótipo v31): prazo no fuso da conta, post que destrava e estado.
import { describe, it, expect } from 'vitest';
import { requestView } from '../platform/src/lib/material-request-view.ts';

const req = (extra = {}) => ({
  id: 'r1', kind: 'photo', status: 'open', needTag: 'produto', factId: null, campaignId: 'c1', suggestionId: 's1',
  title: 'Fotos para o post "Caixa de panetone"', reason: 'Motivo.', dueAt: '2026-10-24T21:00:00Z', remindedAt: null, answeredAt: null, outcome: null, createdAt: '2026-10-22T12:00:00Z', ...extra,
});
const now = Date.parse('2026-10-22T15:00:00Z');
const post = { idea: 'Caixa de panetone', goalLabel: 'Mostrar o produto ou serviço', slotAt: '2026-10-24T21:00:00Z' };

describe('requestView', () => {
  it('pedido aberto: prazo no fuso da conta e o post que ele destrava', () => {
    const v = requestView(req(), { now, tz: -3, post, campaignName: 'Fim de ano' });
    expect(v).toMatchObject({ open: true, dueToday: false, dueLabel: 'Até sáb 24/10 às 18:00', campaignName: 'Fim de ano', status: { label: 'Aberto', tone: 'accent' } });
    expect(v.post).toEqual({ idea: 'Caixa de panetone', goalLabel: 'Mostrar o produto ou serviço', when: 'sáb 24 às 18:00' });
  });

  it('vence hoje: o prazo vira aviso', () => {
    const v = requestView(req({ dueAt: '2026-10-22T21:00:00Z' }), { now, tz: -3 });
    expect(v).toMatchObject({ dueToday: true, dueLabel: 'Vence hoje às 18:00' });
  });

  it('fechado: o estado diz o que aconteceu, sem culpa', () => {
    expect(requestView(req({ status: 'answered', outcome: 'photo' }), { now, tz: -3 }).status).toEqual({ label: 'Recebido', tone: 'success' });
    expect(requestView(req({ status: 'dismissed', outcome: 'dismissed' }), { now, tz: -3 }).status).toEqual({ label: 'Dispensado', tone: 'neutral' });
    expect(requestView(req({ status: 'expired', outcome: 'expired' }), { now, tz: -3 }).status).toEqual({ label: 'Venceu', tone: 'warning' });
    expect(requestView(req({ status: 'answered', outcome: 'edited' }), { now, tz: -3 }).open).toBe(false);
  });

  it('aberto, mas com o prazo vencido antes da varredura: não aceita resposta', () => {
    expect(requestView(req({ dueAt: '2026-10-22T14:00:00Z' }), { now, tz: -3 }).open).toBe(false);
  });
});
