// O juiz, as checagens por código e o relatório do eval da geração (evals/). Não chama modelo; o eval ao
// vivo é `npm run eval`.
import { describe, it, expect } from 'vitest';
import { buildJudgePrompt, checkContains, parseJudge, scoreOf, verdictOf } from '../evals/judge.js';
import { codeChecks } from '../evals/metrics.js';
import { compare, renderSummary, summarize } from '../evals/report.js';
import { CASES, COMPANIES, CRAFT } from '../evals/cases.js';

const reqs = [
  { id: 'a', in: 'image', text: 'O fundo é escuro.' },
  { id: 'b', in: 'caption', text: 'A legenda chama no WhatsApp.' },
  { id: 'c', in: 'image', text: 'O nome está escrito.', contains: ['Casa Aurora'] },
];

describe('prompt do juiz', () => {
  it('leva o pedido palavra por palavra, a legenda, cada exigência e a base de fatos da empresa', () => {
    const p = buildJudgePrompt({ idea: 'Fundo escuro com logo', requirements: reqs, caption: 'Chame no WhatsApp', company: COMPANIES.aurora });
    for (const piece of ['Fundo escuro com logo', 'Chame no WhatsApp', 'a (olhe a imagem): O fundo é escuro.', 'b (leia a legenda)', 'na dúvida, reprove', 'Fornada nova todo dia às 7h', 'imperdível', 'círculo âmbar']) expect(p).toContain(piece);
  });
});

describe('leitura da resposta do juiz', () => {
  it('uma linha por exigência, na ordem do caso; exigência sem resposta reprova', () => {
    const r = parseJudge({ seen: ' Fundo bege. ', items: [{ id: 'b', pass: true, reason: 'ok' }, { id: 'a', pass: false, reason: 'bege' }, { id: 'zzz', pass: true }] }, reqs);
    expect(r.seen).toBe('Fundo bege.');
    expect(r.items.map((i) => [i.id, i.pass])).toEqual([['a', false], ['b', true], ['c', false]]);
    expect(r.items[2].reason).toMatch(/não respondeu/);
  });

  it('aceita a resposta embrulhada em array ou só a lista de itens; `answered` conta o que o juiz respondeu', () => {
    const items = [{ id: 'a', pass: true, reason: 'ok' }, { id: 'b', pass: false, reason: 'não' }];
    expect(parseJudge([{ items, seen: 'x' }], reqs)).toMatchObject({ answered: 2, seen: 'x' });
    expect(parseJudge(items, reqs).answered).toBe(2);
    expect(parseJudge([{ foo: 1 }], reqs).answered).toBe(0);
    expect(parseJudge({ items }, reqs).items.map((i) => i.pass)).toEqual([true, false, false]);
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

describe('checagens por código do resultado', () => {
  const ok = { copy: { caption: 'Legenda.', hashtags: ['pao', 'padaria', 'marilia'] }, imageTexts: ['Título', '@casaaurora'], textIssues: [], layoutIssues: [] };
  const by = (input) => Object.fromEntries(codeChecks(input).map((c) => [c.id, c.pass]));

  it('resultado limpo passa em tudo', () => {
    expect(Object.values(by(ok)).every(Boolean)).toBe(true);
  });

  it('pega travessão, emoji na imagem, hashtag fora do padrão, achado bloqueante', () => {
    expect(by({ ...ok, imageTexts: ['Pão — quente'] })['cod-sem-travessao']).toBe(false);
    expect(by({ ...ok, copy: { ...ok.copy, caption: 'Olá – tudo bem' } })['cod-sem-travessao']).toBe(false);
    expect(by({ ...ok, imageTexts: ['Pão quente 🔥'] })['cod-sem-emoji-na-imagem']).toBe(false);
    expect(by({ ...ok, copy: { ...ok.copy, hashtags: ['a', 'b'] } })['cod-hashtags']).toBe(false);
    expect(by({ ...ok, copy: { ...ok.copy, hashtags: ['pão', 'b', 'c'] } })['cod-hashtags']).toBe(false);
    expect(by({ ...ok, textIssues: [{ rule: 'banned_word', detail: 'x', message: 'x', where: 'image' }] })['cod-revisor-limpo']).toBe(false);
  });
});

describe('relatório', () => {
  const v = (id, pass, group) => ({ id, pass, group, reason: '' });
  const rows = [
    { caseId: 'x', run: 1, tags: ['marca'], costUsd: 0.1, verdicts: [v('a', true, 'pedido'), v('b', false, 'pedido'), v('o1', true, 'oficio'), v('c1', false, 'codigo')] },
    { caseId: 'x', run: 2, tags: ['marca'], costUsd: 0.1, verdicts: [v('a', true, 'pedido'), v('b', true, 'pedido'), v('o1', true, 'oficio'), v('c1', true, 'codigo')] },
  ];
  const meta = { stamp: 't', text: 'm1', image: 'm2', judge: 'm3' };

  it('resume por caso, por exigência e por tag; ofício junta o julgado e o código', () => {
    const s = summarize(rows, meta);
    expect(s.meta).toMatchObject({ runs: 2, costUsd: 0.2 });
    expect(s.overall).toMatchObject({ pedido: 0.75, oficio: 0.75, rounds: 1, costPerPost: 0.1 });
    expect(s.cases.x).toMatchObject({ runs: 2, pedido: 0.75, oficio: 0.75, req: { a: 1, b: 0.5, o1: 1, c1: 0.5 } });
    expect(s.tags.marca).toEqual({ pedido: 0.75, oficio: 0.75 });
    expect(renderSummary(s)).toContain('| x | 75% | 75% | b 50%, c1 50% |');
  });

  it('rodada em que o juiz falhou sai da nota e aparece na contagem', () => {
    const s = summarize([...rows, { caseId: 'x', run: 3, tags: ['marca'], judgeFailed: true, verdicts: [], costUsd: 0.05 }], meta);
    expect(s.overall.pedido).toBe(0.75);
    expect(s.meta).toMatchObject({ judgeFailures: 1, runs: 2, costUsd: 0.25 });
    expect(renderSummary(s)).toContain('1 sem nota (o juiz falhou)');
  });

  it('compara dois resumos em pontos percentuais', () => {
    const before = summarize(rows.slice(0, 1), meta);
    const after = summarize(rows.slice(1), meta);
    const out = compare(before, after);
    expect(out).toContain('Pedido: 50% → 100% (+50 pp)');
    expect(out).toContain('| x | 50% | 100% | +50 pp |');
  });
});

describe('conjunto de casos', () => {
  it('ids únicos; empresa existe; toda exigência tem id único no caso, texto e onde olhar', () => {
    expect(new Set(CASES.map((c) => c.id)).size).toBe(CASES.length);
    for (const c of CASES) {
      expect(COMPANIES[c.company], c.id).toBeTruthy();
      expect(c.tags.length, c.id).toBeGreaterThan(0);
      expect(c.idea.length, c.id).toBeGreaterThan(10);
      const ids = [...c.requirements, ...CRAFT].map((r) => r.id);
      expect(new Set(ids).size, c.id).toBe(ids.length);
      for (const r of c.requirements) {
        expect(['image', 'caption'], `${c.id}/${r.id}`).toContain(r.in);
        expect(r.text.length, `${c.id}/${r.id}`).toBeGreaterThan(10);
      }
    }
  });

  it('cada empresa tem perfil com @ igual ao handle, logo e voz', () => {
    for (const [key, c] of Object.entries(COMPANIES)) {
      expect(c.profile.instagramHandle, key).toBe(`@${c.handle}`);
      expect(c.logo.dataUri, key).toMatch(/^data:image\/svg\+xml;base64,/);
      expect(c.voice.length, key).toBeGreaterThan(5);
    }
  });
});
