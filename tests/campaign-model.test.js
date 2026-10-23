import { describe, it, expect } from 'vitest';
import {
  parseCampaignInput,
  parseCampaignPatch,
  campaignFromRow,
  transition,
  campaignInEffect,
  campaignSlug,
  campaignSlotQuota,
  dayCount,
  todayLocal,
  isCampaignId,
  KIND_GOALS,
  CAMPAIGN_KINDS,
} from '../platform/src/lib/campaign-model.ts';
import { POST_GOALS } from '../platform/src/lib/post-goals.ts';

const TODAY = '2026-10-22';
const input = (over = {}) => ({
  name: 'Encomendas de fim de ano',
  kind: 'vender',
  objective: 'Vender as caixas de fim de ano até 15 de dezembro',
  offering: 'Caixas de panetone e bolo de pote para presente',
  audience: 'Famílias e empresas que dão presente',
  start_date: '2026-10-12',
  end_date: '2026-12-15',
  ...over,
});

describe('campanha: entrada', () => {
  it('aceita a campanha completa, limpa espaços e usa o que vem do perfil quando o campo some', () => {
    const r = parseCampaignInput(input({ name: '  Encomendas   de fim de ano ', cta: '', posts_per_week: '', restrictions: ['desconto', ' desconto ', 'entrega no mesmo dia em dezembro'], target_label: 'Pedidos pelo WhatsApp', target_value: '40', tenant_id: 'outra' }), TODAY);
    expect(r).toEqual({
      ok: true,
      value: {
        name: 'Encomendas de fim de ano',
        kind: 'vender',
        objective: 'Vender as caixas de fim de ano até 15 de dezembro',
        offering: 'Caixas de panetone e bolo de pote para presente',
        audience: 'Famílias e empresas que dão presente',
        cta: null,
        restrictions: ['desconto', 'entrega no mesmo dia em dezembro'],
        target_label: 'Pedidos pelo WhatsApp',
        target_value: 40,
        posts_per_week: null,
        start_date: '2026-10-12',
        end_date: '2026-12-15',
      },
    });
  });

  it('cada campo obrigatório recusa com a mensagem e o campo', () => {
    const bad = (over) => parseCampaignInput(input(over), TODAY);
    expect(bad({ name: '' })).toMatchObject({ ok: false, field: 'name' });
    expect(bad({ objective: '' })).toEqual({ ok: false, error: 'Diga o que você quer alcançar, em uma frase.', field: 'objective' });
    expect(bad({ objective: 'x'.repeat(281) })).toMatchObject({ ok: false, field: 'objective' });
    expect(bad({ kind: 'viral' })).toMatchObject({ ok: false, field: 'kind' });
    expect(bad({ offering: '' })).toMatchObject({ ok: false, field: 'offering' });
    expect(bad({ audience: '' })).toMatchObject({ ok: false, field: 'audience' });
    expect(bad({ end_date: '' })).toMatchObject({ ok: false, field: 'end_date' });
    expect(bad({ end_date: '2026-02-30' })).toMatchObject({ ok: false, field: 'end_date' });
    expect(bad({ end_date: '2026-10-05' })).toEqual({ ok: false, error: 'A data final vem depois da inicial.', field: 'end_date' });
    expect(bad({ cta: 'email' })).toMatchObject({ ok: false, field: 'cta' });
    expect(bad({ posts_per_week: 15 })).toMatchObject({ ok: false, field: 'posts_per_week' });
    expect(bad({ posts_per_week: 0 })).toMatchObject({ ok: false, field: 'posts_per_week' });
  });

  it('o início ausente vale hoje; o fim pode ser hoje', () => {
    expect(parseCampaignInput(input({ start_date: undefined, end_date: TODAY }), TODAY)).toMatchObject({ ok: true, value: { start_date: TODAY, end_date: TODAY } });
  });

  it('restrições: até 5, cada uma curta; a meta é rótulo e número, e o número nunca é inventado', () => {
    expect(parseCampaignInput(input({ restrictions: ['a', 'b', 'c', 'd', 'e', 'f'] }), TODAY)).toMatchObject({ ok: false, field: 'restrictions' });
    expect(parseCampaignInput(input({ restrictions: ['x'.repeat(151)] }), TODAY)).toMatchObject({ ok: false, field: 'restrictions' });
    expect(parseCampaignInput(input({ restrictions: 'desconto' }), TODAY)).toMatchObject({ ok: false, field: 'restrictions' });
    expect(parseCampaignInput(input({ target_value: 40 }), TODAY)).toMatchObject({ ok: false, field: 'target_label' });
    expect(parseCampaignInput(input({ target_label: 'Pedidos' }), TODAY)).toMatchObject({ ok: true, value: { target_label: 'Pedidos', target_value: null } });
    expect(parseCampaignInput(input({ target_label: 'Pedidos', target_value: -1 }), TODAY)).toMatchObject({ ok: false, field: 'target_value' });
    expect(parseCampaignInput(input({ target_label: 'Pedidos', target_value: 4.5 }), TODAY)).toMatchObject({ ok: false, field: 'target_value' });
  });

  it('status, confirmação e dono da conta não vêm do corpo', () => {
    const r = parseCampaignInput(input({ status: 'active', confirmed_at: '2026-10-01', tenant_id: 'outra', created_by: 'x' }), TODAY);
    expect(Object.keys(r.value).sort()).toEqual(['audience', 'cta', 'end_date', 'kind', 'name', 'objective', 'offering', 'posts_per_week', 'restrictions', 'start_date', 'target_label', 'target_value']);
  });

  it('o patch muda só o enviado, revalida a janela com o que já existe e recusa o vazio', () => {
    const cur = { startDate: '2026-10-12', endDate: '2026-12-15' };
    expect(parseCampaignPatch({ audience: ' Noivas ' }, cur, TODAY)).toEqual({ ok: true, value: { audience: 'Noivas' } });
    expect(parseCampaignPatch({}, cur, TODAY)).toEqual({ ok: false, error: 'Nada para alterar.' });
    expect(parseCampaignPatch({ status: 'active' }, cur, TODAY)).toEqual({ ok: false, error: 'Nada para alterar.' });
    expect(parseCampaignPatch({ end_date: '2026-10-01' }, cur, TODAY)).toMatchObject({ ok: false, field: 'end_date' });
    expect(parseCampaignPatch({ start_date: '2027-01-01' }, cur, TODAY)).toMatchObject({ ok: false, field: 'end_date' });
    expect(parseCampaignPatch({ objective: '' }, cur, TODAY)).toMatchObject({ ok: false, field: 'objective' });
    expect(parseCampaignPatch({ target_label: 'Pedidos', target_value: 12 }, cur, TODAY)).toEqual({ ok: true, value: { target_label: 'Pedidos', target_value: 12 } });
    expect(parseCampaignPatch({ target_label: '', target_value: null }, cur, TODAY)).toEqual({ ok: true, value: { target_label: null, target_value: null } });
  });
});

describe('campanha: ciclo de vida e vigência', () => {
  it('o ciclo só anda pelos caminhos da spec', () => {
    expect(transition('draft', 'confirm')).toBe('active');
    expect(transition('active', 'pause')).toBe('paused');
    expect(transition('paused', 'resume')).toBe('active');
    expect(transition('active', 'end')).toBe('ended');
    expect(transition('paused', 'end')).toBe('ended');
    expect(transition('draft', 'archive')).toBe('archived');
    expect(transition('ended', 'archive')).toBe('archived');
    expect(transition('active', 'confirm')).toBeNull();
    expect(transition('ended', 'resume')).toBeNull();
    expect(transition('archived', 'confirm')).toBeNull();
    expect(transition('draft', 'end')).toBeNull();
    expect(transition('active', 'archive')).toBeNull();
  });

  it('só a campanha ativa, confirmada e dentro do prazo entra no planejamento (início e fim inclusive)', () => {
    const c = (over = {}) => ({ status: 'active', confirmedAt: '2026-10-10T12:00:00Z', startDate: '2026-10-12', endDate: '2026-12-15', ...over });
    expect(campaignInEffect(c(), TODAY)).toBe(true);
    expect(campaignInEffect(c({ startDate: TODAY }), TODAY)).toBe(true);
    expect(campaignInEffect(c({ endDate: TODAY }), TODAY)).toBe(true);
    expect(campaignInEffect(c({ startDate: '2026-10-23' }), TODAY)).toBe(false);
    expect(campaignInEffect(c({ endDate: '2026-10-21' }), TODAY)).toBe(false);
    for (const status of ['draft', 'paused', 'ended', 'archived']) expect(campaignInEffect(c({ status }), TODAY)).toBe(false);
    expect(campaignInEffect(c({ confirmedAt: null }), TODAY)).toBe(false);
    expect(campaignInEffect(c({ startDate: null, endDate: null }), TODAY)).toBe(true);
  });

  it('dayCount, todayLocal e o id', () => {
    expect(dayCount('2026-10-22', '2026-12-15')).toBe(54);
    expect(todayLocal(new Date('2026-10-22T02:59:00Z'))).toBe('2026-10-21');
    expect(isCampaignId('11111111-2222-4333-8444-555555555555')).toBe(true);
    expect(isCampaignId('nope')).toBe(false);
  });

  it('o slug sai do nome, sem acento nem símbolo, e aceita sufixo', () => {
    expect(campaignSlug('Encomendas de fim de ano')).toBe('encomendas-de-fim-de-ano');
    expect(campaignSlug('Páscoa 2027: ovos & colomba!')).toBe('pascoa-2027-ovos-colomba');
    expect(campaignSlug('!!!')).toBe('campanha');
    expect(campaignSlug('Natal', 'a1b2')).toBe('natal-a1b2');
    expect(campaignSlug('x'.repeat(80)).length).toBeLessThanOrEqual(40);
  });
});

describe('campanha: tipo e cota de horários', () => {
  it('cada tipo puxa três objetivos de post válidos, sem "auto" nem data comemorativa', () => {
    for (const kind of CAMPAIGN_KINDS) {
      expect(KIND_GOALS[kind]).toHaveLength(3);
      for (const g of KIND_GOALS[kind]) {
        expect(POST_GOALS).toContain(g);
        expect(['auto', 'data_comemorativa']).not.toContain(g);
      }
    }
    expect(KIND_GOALS.vender).toEqual(['produto', 'promocao', 'prova_social']);
  });

  it('a campanha ocupa até 60% (para cima, ao menos 1) e sempre deixa um horário para a rotação', () => {
    expect([0, 1, 2, 3, 4, 5, 7, 10].map(campaignSlotQuota)).toEqual([0, 1, 1, 2, 3, 3, 5, 6]);
  });

  it('converte a linha do pg, inclusive a data e o que falta numa campanha antiga', () => {
    const c = campaignFromRow({ id: 'a', slug: 's', name: 'N', kind: 'vender', objective: 'o', offering: 'x', audience: 'y', cta: 'whatsapp', restrictions: ['a'], target_label: 'Pedidos', target_value: 40, posts_per_week: 3, start_date: new Date(2026, 9, 12), end_date: '2026-12-15', status: 'active', confirmed_at: new Date('2026-10-12T15:00:00Z'), confirmed_by: 'u1', created_at: new Date('2026-10-12T15:00:00Z') });
    expect(c).toMatchObject({ kind: 'vender', startDate: '2026-10-12', endDate: '2026-12-15', targetValue: 40, confirmedAt: '2026-10-12T15:00:00.000Z', restrictions: ['a'] });
    const legacy = campaignFromRow({ id: 'b', slug: 'antiga', name: 'Antiga', status: 'active', start_date: null, end_date: null, created_at: '2026-01-01' });
    expect(legacy).toMatchObject({ kind: null, objective: null, restrictions: [], startDate: null, status: 'active', confirmedAt: null });
  });
});
