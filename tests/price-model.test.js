import { describe, it, expect } from 'vitest';
import { EMPTY_PRICING, isBelowTarget, isPricingSet, parsePricing, postPriceBrl, profitOf } from '../platform/src/lib/price-model.ts';

const C = (over = {}) => ({ markupPercent: 300, minimumPerPostBrl: 1, roundUpToBrl: 0.05, targetMarginPercent: 70, ...over });

describe('preço de um post a partir do custo (SPEC 031)', () => {
  it('o preço é o custo mais o percentual, nunca abaixo do mínimo, arredondado para cima', () => {
    expect(postPriceBrl(0.04, C())).toBe(1); // custo de centavos: vale o mínimo
    expect(postPriceBrl(0.41, C())).toBe(1.65); // 0,41 × 4 = 1,64, acima do mínimo, arredondado para cima
    expect(postPriceBrl(0.6, C())).toBe(2.4);
    expect(postPriceBrl(0.6, C({ roundUpToBrl: 0.5 }))).toBe(2.5);
    expect(postPriceBrl(0.6, C({ roundUpToBrl: 0 }))).toBe(2.4);
  });

  it('sem percentual e sem mínimo o preço é o próprio custo, e preço indefinido é a linha zerada', () => {
    expect(postPriceBrl(0.5, EMPTY_PRICING)).toBe(0.5);
    expect(isPricingSet(EMPTY_PRICING)).toBe(false);
    expect(isPricingSet(C({ markupPercent: 0, minimumPerPostBrl: 0.5 }))).toBe(true);
    expect(isPricingSet(C({ markupPercent: 50, minimumPerPostBrl: 0 }))).toBe(true);
  });

  it('50% sobre o custo dá margem de 33% sobre o preço, e o mesmo custo com 900% dá 90%', () => {
    const fifty = postPriceBrl(1, { ...EMPTY_PRICING, markupPercent: 50 });
    expect(fifty).toBe(1.5);
    expect(profitOf(fifty, 1).marginPercent).toBeCloseTo(33.33, 1);
    const nine = postPriceBrl(1, { ...EMPTY_PRICING, markupPercent: 900 });
    expect(nine).toBe(10);
    expect(profitOf(nine, 1).marginPercent).toBeCloseTo(90, 5);
  });

  it('lucro e margem, sem dividir por zero, e o aviso de margem abaixo da meta', () => {
    expect(profitOf(2, 0.5)).toEqual({ profitBrl: 1.5, marginPercent: 75 });
    expect(profitOf(0, 0)).toEqual({ profitBrl: 0, marginPercent: 0 });
    expect(isBelowTarget(60, C())).toBe(true);
    expect(isBelowTarget(70, C())).toBe(false);
    expect(isBelowTarget(10, C({ targetMarginPercent: 0 }))).toBe(false);
  });

  it('o formulário aceita vírgula decimal, valida a faixa de cada campo e recusa lixo', () => {
    expect(parsePricing({ markupPercent: '300', minimumPerPostBrl: '1,00', roundUpToBrl: '0,05', targetMarginPercent: '70' })).toEqual({ ok: true, value: { markupPercent: 300, minimumPerPostBrl: 1, roundUpToBrl: 0.05, targetMarginPercent: 70 } });
    expect(parsePricing({ markupPercent: -1, minimumPerPostBrl: 1, roundUpToBrl: 0, targetMarginPercent: 0 }).ok).toBe(false);
    expect(parsePricing({ markupPercent: 100001, minimumPerPostBrl: 1, roundUpToBrl: 0, targetMarginPercent: 0 }).ok).toBe(false);
    expect(parsePricing({ markupPercent: 10, minimumPerPostBrl: 'abc', roundUpToBrl: 0, targetMarginPercent: 0 }).ok).toBe(false);
    expect(parsePricing({ markupPercent: 10, minimumPerPostBrl: 1, roundUpToBrl: 0, targetMarginPercent: 100 }).ok).toBe(false);
    expect(parsePricing({ markupPercent: 10, minimumPerPostBrl: 1, roundUpToBrl: 0 }).ok).toBe(false);
    expect(parsePricing(null).ok).toBe(false);
    expect(parsePricing([]).ok).toBe(false);
  });
});
