import { describe, it, expect } from 'vitest';
import { CASES, COMPANIES, LINKEDIN_CRAFT, sendRequirement } from '../evals/cases.js';
import { ALL_CASES } from '../evals/all-cases.js';
import { buildLinkedInJudgePrompt, parseJudge, verdictOf } from '../evals/judge.js';
import { linkedinChecks } from '../evals/metrics.js';
import { compare, renderSummary, summarize } from '../evals/report.js';

const v = (id, pass, group) => ({ id, pass, group, reason: pass ? '' : 'não' });
const row = (over = {}) => ({ caseId: 'c1', run: 1, tags: ['lista'], rounds: 1, costUsd: 0.01, verdicts: [], ...over });

describe('casos com teste do envio e texto de LinkedIn (SPEC 028, BEZ-417)', () => {
  const withSend = CASES.filter((c) => c.sendTarget);
  const withLi = CASES.filter((c) => c.linkedin);

  it('o teste do envio e o LinkedIn existem em casos de conteúdo, escritos à mão', () => {
    expect(withSend.length).toBeGreaterThanOrEqual(8);
    expect(withLi.length).toBeGreaterThanOrEqual(6);
    for (const c of withSend) {
      expect(typeof c.sendTarget, c.id).toBe('string');
      expect(c.sendTarget.length, c.id).toBeGreaterThan(15);
      expect(c.sendTarget, c.id).not.toMatch(/[–—]/);
      expect(c.tags, c.id).not.toContain('marca');
      expect(COMPANIES[c.company], c.id).toBeTruthy();
    }
    // o caso de LinkedIn também tem o teste do envio: os dois medem o mesmo conteúdo
    for (const c of withLi) expect(c.sendTarget, c.id).toBeTruthy();
    expect(ALL_CASES.filter((c) => c.linkedin)).toHaveLength(withLi.length);
  });

  it('a exigência do envio cita a pessoa que receberia e vale para a legenda', () => {
    const r = sendRequirement('um amigo que adia o dentista');
    expect(r).toMatchObject({ id: 'envio', in: 'caption' });
    expect(r.text).toContain('um amigo que adia o dentista');
    expect(r.text).toContain('motivo claro');
  });

  it('a régua do LinkedIn tem sete exigências com id único e o prefixo li-', () => {
    expect(LINKEDIN_CRAFT).toHaveLength(7);
    expect(new Set(LINKEDIN_CRAFT.map((r) => r.id)).size).toBe(7);
    for (const r of LINKEDIN_CRAFT) {
      expect(r.id).toMatch(/^li-/);
      expect(r.text).not.toMatch(/[–—]/);
    }
  });
});

describe('juiz do texto de LinkedIn', () => {
  const company = COMPANIES.aurora;
  const reqs = LINKEDIN_CRAFT.map((r) => ({ ...r, group: 'linkedin' }));
  const text = 'O pão endurece no mesmo dia.\nEu aprendi a evitar isso na padaria.\n\nQual dica você usa?';

  it('o prompt traz o pedido, a empresa, o texto e cada exigência, sem imagem', () => {
    const p = buildLinkedInJudgePrompt({ idea: 'Três dicas para o pão não endurecer', requirements: reqs, text, company });
    for (const piece of ['Três dicas para o pão não endurecer', company.name, 'O pão endurece no mesmo dia.', '- li-gancho:', '- li-pergunta:', 'Julgue só o que está escrito no texto', '{"items":[{"id":"..."']) expect(p).toContain(piece);
    expect(p).not.toMatch(/imagem anexada|na imagem/i);
  });

  it('a resposta do juiz serve ao mesmo parser: exigência sem resposta reprova', () => {
    const judged = parseJudge({ items: [{ id: 'li-gancho', pass: true, reason: 'ok' }, { id: 'li-pergunta', pass: false, reason: 'sem pergunta' }], seen: 'promete evitar o pão duro' }, reqs);
    expect(judged.answered).toBe(2);
    expect(judged.items.find((i) => i.id === 'li-gancho').pass).toBe(true);
    expect(judged.items.find((i) => i.id === 'li-voz')).toMatchObject({ pass: false });
    expect(verdictOf(reqs[0], judged.items[0], [])).toMatchObject({ pass: true, by: 'judge' });
  });
});

describe('checagens por código do LinkedIn', () => {
  const ok = { post: { text: 'O pão endurece no mesmo dia, e a gente aprendeu a evitar isso.\nTrês hábitos mudaram a nossa fornada.\n\nQual dica você usa?', hashtags: ['pao'], shareReason: 'Quem também faz pão responde com a própria dica' }, issues: [] };
  const by = (input) => Object.fromEntries(linkedinChecks(input).map((c) => [c.id, c.pass]));

  it('texto bom passa em tudo', () => {
    expect(Object.values(by(ok)).every(Boolean)).toBe(true);
  });

  it('pega travessão, falta de pergunta, abertura curta ou longa, texto grande, hashtags e razão', () => {
    const post = (over) => ({ ...ok, post: { ...ok.post, ...over } });
    expect(by(post({ text: 'Primeira linha — com travessão aqui.\nSegunda.\n\nQual?' }))['cod-li-sem-travessao']).toBe(false);
    expect(by(post({ text: 'Primeira linha sem pergunta nenhuma aqui.\nSegunda linha.' }))['cod-li-pergunta']).toBe(false);
    expect(by(post({ text: 'Oi\nSegunda linha.\n\nQual?' }))['cod-li-abertura']).toBe(false);
    expect(by(post({ text: `${'a'.repeat(170)}\nSegunda.\n\nQual?` }))['cod-li-abertura']).toBe(false);
    expect(by(post({ text: `Primeira linha boa o bastante.\n${'palavra '.repeat(300)}\nQual?` }))['cod-li-tamanho']).toBe(false);
    expect(by(post({ hashtags: ['a', 'b', 'c', 'd'] }))['cod-li-hashtags']).toBe(false);
    expect(by(post({ shareReason: 'para comentar' }))['cod-li-razao']).toBe(false);
    expect(by({ ...ok, issues: [{ rule: 'banned_word', detail: 'x', message: 'x', where: 'caption' }] })['cod-li-revisor-limpo']).toBe(false);
  });
});

describe('relatório com envio, LinkedIn e avaliador', () => {
  const rows = [
    row({ caseId: 'a', verdicts: [v('r1', true, 'pedido'), v('envio', true, 'envio'), v('li-gancho', true, 'linkedin'), v('cod-li-pergunta', false, 'linkedin-codigo')], critic: { band: 'forte', fixed: false }, linkedinCritic: { band: 'medio', fixed: true } }),
    row({ caseId: 'b', verdicts: [v('r1', true, 'pedido'), v('envio', false, 'envio')], critic: { band: 'fraco', fixed: true }, linkedinCritic: null }),
    row({ caseId: 'c', verdicts: [v('r1', true, 'pedido')], critic: null }),
  ];
  const summary = summarize(rows, { stamp: 's', text: 't', image: 'i', judge: 'j' });

  it('a nota de envio e a de LinkedIn saem separadas das de pedido e ofício', () => {
    expect(summary.overall.envio).toBe(0.5);
    expect(summary.overall.linkedin).toBe(0.5);
    expect(summary.overall.pedido).toBe(1);
    expect(summary.cases.a).toMatchObject({ envio: 1, linkedin: 0.5 });
    expect(summary.cases.c).toMatchObject({ envio: null, linkedin: null });
  });

  it('conta as faixas do avaliador e quantos conserto valeram, por rede', () => {
    expect(summary.overall.critic).toEqual({ total: 2, forte: 1, medio: 0, fraco: 1, fixed: 1 });
    expect(summary.overall.linkedinCritic).toEqual({ total: 1, forte: 0, medio: 1, fraco: 0, fixed: 1 });
  });

  it('o relatório mostra envio, LinkedIn e avaliador só quando existem', () => {
    const md = renderSummary(summary);
    for (const piece of ['Envio (alguém mandaria?): 50%', 'LinkedIn: 50%', 'Avaliador de sinais, Instagram: 2 posts, 1 fortes, 0 médios, 1 fracos; o conserto de uma volta valeu em 1.', '| Caso | Pedido | Ofício | Envio | LinkedIn |']) expect(md).toContain(piece);
    const old = summarize([row({ verdicts: [v('r1', true, 'pedido')] })], { stamp: 's', text: 't', image: 'i', judge: 'j' });
    const mdOld = renderSummary(old);
    expect(mdOld).not.toContain('Envio (alguém');
    expect(mdOld).not.toContain('Avaliador de sinais');
  });

  it('o antes e depois traz o envio e o LinkedIn quando o depois tem, e não quebra com baseline antigo', () => {
    const before = summarize([row({ verdicts: [v('r1', true, 'pedido')] })], { stamp: 'a', text: 't', image: 'i', judge: 'j' });
    const text = compare(before, summary);
    expect(text).toContain('Envio (alguém mandaria?): - → 50%');
    expect(compare(before, before)).not.toContain('Envio (alguém');
  });
});
