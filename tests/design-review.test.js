import { describe, it, expect } from 'vitest';
import { reviewText, reviewLayout, blocking } from '../platform/src/lib/design/review.ts';
import { contrast, mix, untilContrast, over } from '../platform/src/lib/design/color.ts';
import { fitText, wrapLines } from '../platform/src/lib/design/text.ts';
import { brandFromProfile, paletteFor } from '../platform/src/lib/design/model.ts';

const base = { imageTexts: ['Seu bolo está pronto?', '3 sinais para conferir'], caption: 'Bolo bom não precisa de pressa. 3 sinais: o palito sai limpo.', hashtags: ['#bolo'], facts: ['3 sinais'], never: ['cura'], banned: ['imperdível'] };

describe('revisor de texto', () => {
  it('caminho feliz: nenhum achado', () => {
    expect(reviewText(base)).toEqual([]);
  });

  it('palavra proibida, nunca afirmar e promessa, com onde está', () => {
    const issues = reviewText({ ...base, imageTexts: ['Oferta imperdível'], caption: 'Garantimos a cura do seu desânimo' });
    expect(issues.map((i) => [i.rule, i.where])).toEqual(expect.arrayContaining([['banned_word', 'image'], ['never_claim', 'caption'], ['never_claim', 'caption']]));
  });

  it('número fora dos fatos é barrado; o número da lista (1.) e a hashtag não', () => {
    const ok = reviewText({ ...base, caption: '1. massa 2. palito #top10' });
    expect(ok.filter((i) => i.rule === 'number_not_in_facts')).toEqual([]);
    const bad = reviewText({ ...base, imageTexts: ['Custa R$ 36'], caption: '' });
    expect(bad.map((i) => i.rule)).toContain('number_not_in_facts');
    expect(reviewText({ ...base, facts: ['R$ 36'], imageTexts: ['Custa R$ 36'] }).filter((i) => i.rule === 'number_not_in_facts')).toEqual([]);
  });

  it('número que só existe em fato vencido, pendente ou recusado reprova com o fato; o que vale passa', () => {
    const inactive = [
      { text: 'Bolo de pote de ninho por R$ 18', reason: 'expired', validUntil: '2026-10-15' },
      { text: 'Mais de 2 mil bolos entregues', reason: 'pending', validUntil: null },
      { text: 'Entregamos em 12 cidades', reason: 'rejected', validUntil: null },
    ];
    const expired = reviewText({ ...base, imageTexts: ['Bolo por R$ 18'], caption: '', inactive });
    expect(expired).toEqual([{ rule: 'fact_not_valid', detail: '18', message: 'O número 18 vem de um fato vencido em 15/10: "Bolo de pote de ninho por R$ 18". Confirme ou atualize o fato para usá-lo.', where: 'image' }]);
    expect(reviewText({ ...base, imageTexts: [], caption: 'Mais de 2 mil bolos', inactive })[0].message).toContain('ainda não confirmado');
    expect(reviewText({ ...base, imageTexts: [], caption: 'Atendemos 12 cidades', inactive })[0].message).toContain('Tire o número do post');
    // o mesmo número num fato que vale: passa, e não aparece como "fora da base"
    expect(reviewText({ ...base, facts: ['Bolo de pote por R$ 18 até 30/11'], imageTexts: ['Bolo por R$ 18'], caption: '', inactive })).toEqual([]);
    // sem nenhum fato com o número: segue como "fora da base"
    expect(reviewText({ ...base, imageTexts: ['Custa R$ 99'], caption: '', inactive }).map((i) => i.rule)).toEqual(['number_not_in_facts']);
    expect(blocking(expired).map((i) => i.rule)).toEqual(['fact_not_valid']);
  });

  it('o número da oferta da campanha vale só quando o post a leva (allowed)', () => {
    expect(reviewText({ ...base, imageTexts: ['Caixa por R$ 89'], caption: '', allowed: ['Caixa de panetone por R$ 89'] })).toEqual([]);
    expect(reviewText({ ...base, imageTexts: ['Caixa por R$ 89'], caption: '' }).map((i) => i.rule)).toEqual(['number_not_in_facts']);
  });

  it('o número que a pessoa digitou no pedido vale para o post, número a número; o que ela não digitou segue barrado', () => {
    const request = 'Anunciar 30% de desconto no bolo de chocolate nesta semana.';
    expect(reviewText({ ...base, imageTexts: ['30% de desconto no bolo de chocolate'], caption: 'Nesta semana, 30% de desconto.', request })).toEqual([]);
    expect(reviewText({ ...base, imageTexts: ['30% de desconto'], caption: '' }).map((i) => i.rule)).toEqual(['number_not_in_facts']);
    // outro número no mesmo post continua fora da base, e um pedaço do número pedido (0 de 30) não vale
    expect(reviewText({ ...base, imageTexts: ['30% de desconto, bolo por R$ 45'], caption: '', request }).map((i) => [i.rule, i.detail])).toEqual([['number_not_in_facts', '45']]);
    expect(reviewText({ ...base, imageTexts: ['0% de desconto'], caption: '', request }).map((i) => i.detail)).toEqual(['0']);
    // fato vencido continua barrando mesmo com o número no pedido (ADR 0019)
    const inactive = [{ text: 'Bolo por R$ 18', reason: 'expired', validUntil: '2026-10-15' }];
    expect(reviewText({ ...base, imageTexts: ['Bolo por R$ 18'], caption: '', request: 'Bolo por R$ 18', inactive }).map((i) => i.rule)).toEqual(['fact_not_valid']);
  });

  it('acento, travessão, emoji na imagem, legenda longa e hashtags demais', () => {
    const issues = reviewText({ ...base, imageTexts: ['Voce vai amar 🎂 — hoje'], caption: 'x'.repeat(2201), hashtags: Array.from({ length: 31 }, (_, i) => `#h${i}`) });
    expect(issues.map((i) => i.rule).sort()).toEqual(['accent', 'caption_too_long', 'dash', 'emoji_in_image', 'too_many_hashtags']);
    expect(blocking(issues).map((i) => i.rule).sort()).toEqual(['caption_too_long', 'too_many_hashtags']);
  });
});

describe('revisor de layout', () => {
  const box = (over = {}) => ({ id: 'title', x: 64, y: 100, w: 600, h: 120, size: 80, color: '#FFFFFF', bg: '#1F2937', bold: true, ...over });
  it('aprova caixa dentro da margem com contraste', () => {
    expect(reviewLayout([box()], 1350)).toEqual([]);
  });
  it('acha fonte pequena, margem, contraste e sobreposição', () => {
    const issues = reviewLayout([box({ size: 40 }), box({ id: 'sub', y: 150, size: 30, color: '#9CA3AF', bg: '#D1D5DB' }), box({ id: 'item1', x: 10, y: 1300, size: 30 })], 1350, ['item2']);
    expect(issues.map((i) => i.rule).sort()).toEqual(['contrast', 'font_size', 'overlap', 'safe_margin', 'text_too_long']);
  });
});

describe('cor e texto', () => {
  it('contraste e mistura', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 0);
    expect(mix('#000000', '#FFFFFF', 0.5)).toBe('#808080');
    expect(contrast(untilContrast('#F2A9C4', '#FFFFFF', 4.5), '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
    expect(over('#FFFFFF', '#000000', 0.82)).toBe('#2E2E2E');
  });

  it('a marca derivada lê bem onde cada layout a usa', () => {
    const brand = brandFromProfile({ colorPrimary: '#F2A9C4', colorAccent: '#B83262', fontHeading: 'Lora', fontBody: 'Manrope', instagramHandle: 'x' });
    expect(contrast(brand.ink, brand.paper)).toBeGreaterThanOrEqual(7);
    expect(contrast('#FFFFFF', brand.deep)).toBeGreaterThanOrEqual(4.5);
    for (const layout of ['lista-numerada', 'titulo-destaque', 'foto-titulo']) {
      const p = paletteFor({ kind: 'informativo', ratio: '4:5', layout, texts: { title: 'x' }, brand });
      expect(contrast(p.title, p.bg), layout).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('quebra e encolhe o texto', () => {
    expect(wrapLines('um dois três quatro', 9)).toEqual(['um dois', 'três', 'quatro']);
    const fit = fitText('Seu bolo está pronto?', { family: 'Inter', maxWidth: 760, maxLines: 2, start: 96, min: 56 });
    expect(fit.lines.length).toBeLessThanOrEqual(2);
    expect(fit.overflow).toBe(false);
    const tight = fitText('palavraenormequenaocabe'.repeat(3), { family: 'Inter', maxWidth: 300, maxLines: 1, start: 60, min: 56 });
    expect(tight.overflow).toBe(true);
  });
});
