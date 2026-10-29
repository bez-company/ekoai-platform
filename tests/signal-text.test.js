import { describe, it, expect } from 'vitest';
import { hashtagsOf, joinHashtagLine, parseSignalRequest, sameText, splitHashtagLine } from '../platform/src/lib/signal-text.ts';

describe('texto do avaliador de sinais (SPEC 028, BEZ-441)', () => {
  it('separa a linha final de hashtags do texto e junta de volta', () => {
    expect(splitHashtagLine('Primeira linha.\n\nSegunda.\n\n#bolo #marília')).toEqual({ body: 'Primeira linha.\n\nSegunda.', tags: '#bolo #marília' });
    expect(splitHashtagLine('Só texto.')).toEqual({ body: 'Só texto.', tags: '' });
    expect(splitHashtagLine('#bolo #marilia')).toEqual({ body: '#bolo #marilia', tags: '' }); // texto que é só hashtag não some
    expect(splitHashtagLine('Fala do #bolo no meio\nfim')).toEqual({ body: 'Fala do #bolo no meio\nfim', tags: '' });
    expect(joinHashtagLine('Novo texto.', '#bolo #marilia')).toBe('Novo texto.\n\n#bolo #marilia');
    expect(joinHashtagLine('Novo texto.', '')).toBe('Novo texto.');
  });

  it('lê as hashtags em minúsculas e compara textos sem olhar espaço nem a linha de hashtags', () => {
    expect(hashtagsOf('#Bolo #marília_sp')).toEqual(['bolo', 'marília_sp']);
    expect(hashtagsOf('')).toEqual([]);
    expect(sameText('Texto.\n\n#bolo', 'Texto.  ')).toBe(true);
    expect(sameText('Texto.', 'Outro texto.')).toBe(false);
  });

  it('valida o pedido da tela na entrada', () => {
    expect(parseSignalRequest({ action: 'evaluate', text: '  Oi  ' })).toEqual({ ok: true, value: { text: 'Oi', action: { evaluate: true } } });
    expect(parseSignalRequest({ action: 'apply', text: 'Oi', criterionId: 'gancho', suggestion: '  Abra  com   um número.  ' })).toEqual({ ok: true, value: { text: 'Oi', action: { apply: { criterionId: 'gancho', suggestion: 'Abra com um número.' } } } });
    expect(parseSignalRequest({ action: 'apply', text: 'Oi', criterionId: 'gancho' }).ok).toBe(false);
    expect(parseSignalRequest({ action: 'apply', text: 'Oi', suggestion: 'x' }).ok).toBe(false);
    expect(parseSignalRequest({ action: 'evaluate', text: '   ' }).ok).toBe(false);
    expect(parseSignalRequest({ action: 'evaluate', text: 'x'.repeat(3501) }).ok).toBe(false);
    expect(parseSignalRequest({ action: 'outra', text: 'Oi' }).ok).toBe(false);
    expect(parseSignalRequest(null).ok).toBe(false);
    expect(parseSignalRequest([]).ok).toBe(false);
  });

  it('a sugestão muito longa é cortada em vez de recusada', () => {
    const r = parseSignalRequest({ action: 'apply', text: 'Oi', criterionId: 'gancho', suggestion: 'a'.repeat(900) });
    expect(r.value.action.apply.suggestion).toHaveLength(300);
  });
});
