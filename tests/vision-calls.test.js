import { describe, it, expect } from 'vitest';
import { isVisionCapError, CAPTION_CAP_MESSAGE } from '../platform/src/lib/vision-calls.ts';

describe('teto diário de visão (BEZ-244)', () => {
  it('reconhece só o erro do gatilho de teto', () => {
    expect(isVisionCapError({ code: '23514', hint: 'vision_daily' })).toBe(true);
    expect(isVisionCapError({ code: '23514', hint: 'plan_posts' })).toBe(false);
    expect(isVisionCapError(null)).toBe(false);
  });

  it('a mensagem diz o que houve e o próximo passo', () => {
    expect(CAPTION_CAP_MESSAGE).toMatch(/hoje/);
    expect(CAPTION_CAP_MESSAGE).toMatch(/Escreva a legenda você/);
  });
});
