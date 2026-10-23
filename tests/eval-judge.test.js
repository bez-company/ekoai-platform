// O juiz do eval da geração (evals/judge.js): prompt, leitura da resposta e conferência por código.
// Não chama modelo; o eval ao vivo é `npm run eval`.
import { describe, it, expect } from 'vitest';
import { buildJudgePrompt, checkContains, parseJudge, scoreOf, verdictOf } from '../evals/judge.js';
import { CASES } from '../evals/cases.js';

const reqs = [
  { id: 'a', in: 'image', text: 'O fundo é escuro.' },
  { id: 'b', in: 'caption', text: 'A legenda chama no WhatsApp.' },
  { id: 'c', in: 'image', text: 'O nome está escrito.', contains: ['Casa Aurora'] },
];

describe('prompt do juiz', () => {
  it('leva o pedido palavra por palavra, a legenda e cada exigência com onde olhar', () => {
    const p = buildJudgePrompt({ idea: 'Fundo escuro com logo', requirements: reqs, caption: 'Chame no WhatsApp' });
    for (const piece of ['Fundo escuro com logo', 'Chame no WhatsApp', 'a (olhe a imagem): O fundo é escuro.', 'b (leia a legenda)', 'na dúvida, reprove']) expect(p).toContain(piece);
  });
});

describe('leitura da resposta do juiz', () => {
  it('uma linha por exigência, na ordem do caso; exigência sem resposta reprova', () => {
    const r = parseJudge({ seen: ' Fundo bege. ', items: [{ id: 'b', pass: true, reason: 'ok' }, { id: 'a', pass: false, reason: 'bege' }, { id: 'zzz', pass: true }] }, reqs);
    expect(r.seen).toBe('Fundo bege.');
    expect(r.items.map((i) => [i.id, i.pass])).toEqual([['a', false], ['b', true], ['c', false]]);
    expect(r.items[2].reason).toMatch(/não respondeu/);
  });

  it('só `pass: true` aprova; lixo vira reprovação', () => {
    expect(parseJudge({ items: [{ id: 'a', pass: 'true' }] }, reqs).items[0].pass).toBe(false);
    expect(parseJudge(null, reqs).items.every((i) => !i.pass)).toBe(true);
    expect(parseJudge([], reqs).seen).toBe('');
  });
});

describe('conferência por código', () => {
  it('compara sem ligar para caixa nem espaço repetido; sem `contains`, não confere', () => {
    expect(checkContains(reqs[2], ['casa   aurora', '@casaaurora'])).toEqual({ pass: true, missing: [] });
    expect(checkContains(reqs[2], ['Padaria'])).toEqual({ pass: false, missing: ['Casa Aurora'] });
    expect(checkContains(reqs[0], ['x'])).toBeNull();
  });

  it('o código derruba o juiz otimista, mas não aprova no lugar dele', () => {
    expect(verdictOf(reqs[2], { pass: true, reason: 'viu' }, ['Padaria'])).toMatchObject({ pass: false, by: 'code' });
    expect(verdictOf(reqs[2], { pass: false, reason: 'não viu' }, ['Casa Aurora'])).toMatchObject({ pass: false, by: 'judge+code' });
    expect(verdictOf(reqs[2], { pass: true, reason: 'viu' }, ['Casa Aurora'])).toMatchObject({ pass: true, by: 'judge+code' });
    expect(verdictOf(reqs[0], { pass: true, reason: 'escuro' }, [])).toMatchObject({ pass: true, by: 'judge' });
  });

  it('a nota é a fração de exigências cumpridas', () => {
    expect(scoreOf([{ pass: true }, { pass: false }, { pass: true }, { pass: true }])).toEqual({ passed: 3, total: 4, rate: 0.75 });
    expect(scoreOf([])).toEqual({ passed: 0, total: 0, rate: 0 });
  });
});

describe('conjunto de casos', () => {
  it('ids únicos; toda exigência tem id único no caso, texto e onde olhar', () => {
    expect(new Set(CASES.map((c) => c.id)).size).toBe(CASES.length);
    for (const c of CASES) {
      expect(c.idea.length, c.id).toBeGreaterThan(10);
      expect(new Set(c.requirements.map((r) => r.id)).size, c.id).toBe(c.requirements.length);
      for (const r of c.requirements) {
        expect(['image', 'caption'], `${c.id}/${r.id}`).toContain(r.in);
        expect(r.text.length, `${c.id}/${r.id}`).toBeGreaterThan(10);
      }
    }
  });
});
