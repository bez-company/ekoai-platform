import { describe, it, expect } from 'vitest';
import { STATUS_BADGE, periodLabel, kindLabel, daysLeftLabel, elapsedPercent, cadenceLabel, engagementView, ENGAGEMENT_NOTE, shortCampaignName } from '../platform/src/lib/campaign-view.ts';

describe('tela de campanha: textos', () => {
  it('cada estado tem etiqueta e tom', () => {
    expect(STATUS_BADGE.active).toEqual({ label: 'Ativa', tone: 'success' });
    expect(STATUS_BADGE.draft).toEqual({ label: 'Rascunho', tone: 'neutral' });
    expect(STATUS_BADGE.paused.tone).toBe('warning');
    expect(STATUS_BADGE.ended.label).toBe('Encerrada');
  });

  it('o prazo e o tipo saem em português, e campanha antiga sem tipo vira "Campanha"', () => {
    expect(periodLabel({ startDate: '2026-10-12', endDate: '2026-12-15' })).toBe('12/10 a 15/12');
    expect(periodLabel({ startDate: null, endDate: '2026-12-15' })).toBe('até 15/12');
    expect(periodLabel({ startDate: '2026-10-12', endDate: null })).toBe('desde 12/10');
    expect(periodLabel({ startDate: null, endDate: null })).toBe('Sem prazo');
    expect(kindLabel({ kind: 'vender' })).toBe('Vender');
    expect(kindLabel({ kind: null })).toBe('Campanha');
  });

  it('dias restantes, andamento do prazo e cadência', () => {
    expect(daysLeftLabel(54)).toBe('Faltam 54 dias');
    expect(daysLeftLabel(1)).toBe('Falta 1 dia');
    expect(daysLeftLabel(0)).toBe('Termina hoje');
    expect(daysLeftLabel(null)).toBe('Sem prazo');
    expect(elapsedPercent({ daysLeft: 54, daysTotal: 64 })).toBe(16);
    expect(elapsedPercent({ daysLeft: 0, daysTotal: 10 })).toBe(100);
    expect(elapsedPercent({ daysLeft: null, daysTotal: null })).toBe(0);
    expect(elapsedPercent({ daysLeft: 5, daysTotal: 0 })).toBe(0);
    expect(cadenceLabel({ cadence: { thisWeek: 2, target: 3 } })).toBe('2 de 3 posts');
    expect(cadenceLabel({ cadence: { thisWeek: 1, target: null } })).toBe('1 post');
    expect(cadenceLabel({ cadence: { thisWeek: 0, target: null } })).toBe('0 posts');
  });

  it('o engajamento sai na medida certa, ao lado da média da conta, e some sem amostra', () => {
    expect(engagementView({ unit: 'rate', campaign: 0.071, account: 0.062, campaignPosts: 4, accountPosts: 20 })).toEqual({ campaign: '7,1%', account: '6,2%', diff: '+0,9 ponto', posts: 4 });
    expect(engagementView({ unit: 'rate', campaign: 0.05, account: 0.062, campaignPosts: 4, accountPosts: 20 })).toMatchObject({ diff: '-1,2 pontos' });
    expect(engagementView({ unit: 'interactions', campaign: 20, account: 46.7, campaignPosts: 2, accountPosts: 3 })).toEqual({ campaign: '20 por post', account: '47 por post', diff: '-27 por post', posts: 2 });
    expect(engagementView({ unit: 'interactions', campaign: 20, account: null, campaignPosts: 2, accountPosts: 0 })).toEqual({ campaign: '20 por post', account: null, diff: null, posts: 2 });
    expect(engagementView({ unit: 'rate', campaign: null, account: 0.06, campaignPosts: 0, accountPosts: 5 })).toBeNull();
  });

  it('nenhum texto desta tela fala de venda, conversão ou retorno, e o nome longo é cortado', () => {
    const all = [ENGAGEMENT_NOTE, ...Object.values(STATUS_BADGE).map((b) => b.label), daysLeftLabel(3), cadenceLabel({ cadence: { thisWeek: 1, target: 3 } })].join(' ');
    expect(all).toContain('Não mede venda nem pedido');
    expect(all.replace(ENGAGEMENT_NOTE, '')).not.toMatch(/venda|conversão|retorno/i);
    expect(shortCampaignName('x'.repeat(40))).toBe(`${'x'.repeat(27)}...`);
    expect(shortCampaignName('Fim de ano')).toBe('Fim de ano');
  });
});
