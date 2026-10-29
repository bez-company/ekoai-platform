import { describe, it, expect } from 'vitest';
import { EMPTY_PRICING, dayBefore, discountOn, isBelowTarget, isDay, isPricingSet, parseDiscount, parsePricing, postPriceBrl, postPriceWithDiscountBrl, profitOf } from '../platform/src/lib/price-model.ts';

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

describe('desconto de preço por conta (SPEC 032)', () => {
  it('o desconto é um percentual sobre o preço de lista, arredondado para cima no mesmo passo', () => {
    expect(postPriceWithDiscountBrl(0.41, C(), 0)).toBe(1.65); // sem desconto é o preço de lista
    expect(postPriceWithDiscountBrl(0.41, C(), 10)).toBe(1.5); // 1,65 × 0,9 = 1,485, para cima no passo de 0,05
    expect(postPriceWithDiscountBrl(0.04, C(), 50)).toBe(0.5); // o mínimo também recebe o desconto
    expect(postPriceWithDiscountBrl(0.41, C(), 100)).toBe(0); // cortesia
  });

  it('vale o desconto que começou até o dia e ainda não tinha terminado; com dois, o que começou por último', () => {
    const list = [
      { discountPercent: 10, startsOn: '2026-09-01', endsOn: '2026-09-30' },
      { discountPercent: 20, startsOn: '2026-10-01', endsOn: null },
      { discountPercent: 30, startsOn: '2026-10-15', endsOn: '2026-10-20' },
    ];
    expect(discountOn(list, '2026-08-31')).toBeNull();
    expect(discountOn(list, '2026-09-30').discountPercent).toBe(10); // o último dia ainda vale
    expect(discountOn(list, '2026-10-01').discountPercent).toBe(20);
    expect(discountOn(list, '2026-10-16').discountPercent).toBe(30);
    expect(discountOn(list, '2026-10-21').discountPercent).toBe(20);
    expect(discountOn([], '2026-10-01')).toBeNull();
  });

  it('o formulário exige percentual válido e motivo, e o fim não pode ser antes de hoje', () => {
    const ok = parseDiscount({ discountPercent: '10', reason: '  Piloto  ', endsOn: '2026-12-31' }, '2026-10-30');
    expect(ok).toEqual({ ok: true, value: { discountPercent: 10, reason: 'Piloto', endsOn: '2026-12-31' } });
    expect(parseDiscount({ discountPercent: '12,5', reason: 'Contrato anual' }, '2026-10-30')).toEqual({ ok: true, value: { discountPercent: 12.5, reason: 'Contrato anual', endsOn: null } });
    expect(parseDiscount({ discountPercent: 10, reason: 'Piloto', endsOn: '' }, '2026-10-30').ok).toBe(true);
    expect(parseDiscount({ discountPercent: 10, reason: 'Piloto', endsOn: '2026-10-30' }, '2026-10-30').ok).toBe(true); // hoje vale
    expect(parseDiscount({ discountPercent: 0, reason: 'Piloto' }, '2026-10-30').ok).toBe(false);
    expect(parseDiscount({ discountPercent: 101, reason: 'Piloto' }, '2026-10-30').ok).toBe(false);
    expect(parseDiscount({ discountPercent: 10, reason: '  ' }, '2026-10-30').ok).toBe(false);
    expect(parseDiscount({ discountPercent: 10, reason: 'x'.repeat(201) }, '2026-10-30').ok).toBe(false);
    expect(parseDiscount({ discountPercent: 10, reason: 'Piloto', endsOn: '2026-10-29' }, '2026-10-30').ok).toBe(false);
    expect(parseDiscount({ discountPercent: 10, reason: 'Piloto', endsOn: '2026-02-30' }, '2026-10-30').ok).toBe(false);
    expect(parseDiscount({ discountPercent: 'abc', reason: 'Piloto' }, '2026-10-30').ok).toBe(false);
    expect(parseDiscount(null, '2026-10-30').ok).toBe(false);
  });

  it('dias em AAAA-MM-DD: valida a data real e calcula o dia anterior na virada de mês e de ano', () => {
    expect(isDay('2026-10-30')).toBe(true);
    expect(isDay('2026-13-01')).toBe(false);
    expect(isDay('30/10/2026')).toBe(false);
    expect(isDay(20261030)).toBe(false);
    expect(dayBefore('2026-11-01')).toBe('2026-10-31');
    expect(dayBefore('2027-01-01')).toBe('2026-12-31');
  });
});
