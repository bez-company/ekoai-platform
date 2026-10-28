import { describe, it, expect } from 'vitest';
import { RUBRICS, bandOf, buildCriticPrompt, buildFixPrompt, criticFromStored, evidenceIsInPost, parseCritic, parseFix, weakCriteria } from '../platform/src/lib/signal-critic.ts';

const IG = { text: 'Salve este post: três sinais para conferir o bolo.\n\nChame a gente no WhatsApp para encomendar.', hashtags: ['bolo', 'confeitaria'], coverText: 'Dica da casa. Seu bolo está pronto?', shareReason: 'Quem faz bolo em casa guarda os sinais para consultar na hora de tirar do forno', signal: 'salvar' };
const LI = { text: 'O erro mais caro de uma confeitaria é tirar o bolo do forno cedo demais.\nEu só abro a porta quando a borda descola da forma.\n\nQual sinal você confere primeiro na sua cozinha?', hashtags: [], shareReason: 'Quem também faz bolo de festa responde com o sinal que confere primeiro', signal: 'responder' };
const ctx = { niche: 'Confeitaria', audience: 'Famílias', facts: ['Entregamos no mesmo dia em Marília'] };

// Uma resposta do modelo: nota e trecho por critério, na ordem da rubrica.
const answer = (channel, scores, quotes, suggestion = 'Faça o ajuste pedido') => ({ criteria: RUBRICS[channel].map((c, i) => ({ id: c.id, score: scores[i], evidence: quotes[i], suggestion: scores[i] === 2 ? null : suggestion })) });
const IG_QUOTES = ['Salve este post', 'três sinais para conferir', 'Seu bolo está pronto', 'o bolo', 'Chame a gente no WhatsApp'];
const LI_QUOTES = ['O erro mais caro de uma confeitaria', 'Eu só abro a porta quando a borda descola', 'borda descola da forma', 'Qual sinal você confere primeiro', 'Eu só abro a porta'];

describe('rubricas por rede (SPEC 028, BEZ-425)', () => {
  it('cada rede tem cinco critérios com rótulo e pergunta', () => {
    for (const channel of ['instagram', 'linkedin']) {
      expect(RUBRICS[channel]).toHaveLength(5);
      for (const c of RUBRICS[channel]) expect([c.id, c.label, c.ask].every((x) => typeof x === 'string' && x.length >= 3)).toBe(true);
    }
    expect(RUBRICS.instagram.map((c) => c.id)).toEqual(['envio', 'salvamento', 'gancho', 'fato', 'chamada']);
    expect(RUBRICS.linkedin.map((c) => c.id)).toEqual(['gancho', 'especificidade', 'leitura', 'pergunta', 'voz']);
  });

  it('o prompt traz o post, os fatos, os critérios, a exigência de citar o trecho e o formato', () => {
    const p = buildCriticPrompt('instagram', IG, ctx);
    for (const piece of ['Salve este post: três sinais', 'Texto da capa: Dica da casa. Seu bolo está pronto?', 'Entregamos no mesmo dia em Marília', 'envio (Envio)', 'chamada (Chamada)', 'COPIE um trecho exato', 'não deve fingir que sabe', '{"criteria":[{"id":"envio"']) expect(p).toContain(piece);
    expect(buildCriticPrompt('linkedin', LI, ctx)).toContain('gancho (Gancho nas duas primeiras linhas)');
    expect(p).not.toMatch(/[–—]/);
  });
});

describe('leitura da avaliação', () => {
  it('guarda nota, trecho e sugestão, e calcula a faixa', () => {
    const r = parseCritic(answer('instagram', [2, 2, 2, 1, 2], IG_QUOTES), 'instagram', IG);
    expect(r.ok).toBe(true);
    expect(r.value.band).toBe('forte');
    expect(r.value.criteria.map((c) => c.score)).toEqual([2, 2, 2, 1, 2]);
    expect(r.value.criteria[0]).toMatchObject({ id: 'envio', label: 'Envio', evidence: 'Salve este post', suggestion: null });
    expect(r.value.criteria[3].suggestion).toBe('Faça o ajuste pedido');
  });

  it('nota sem trecho vale 0, e trecho que não está no post limita a 1 (o juiz otimista cai)', () => {
    const noQuote = parseCritic(answer('instagram', [2, 2, 2, 2, 2], ['', IG_QUOTES[1], IG_QUOTES[2], IG_QUOTES[3], IG_QUOTES[4]]), 'instagram', IG);
    expect(noQuote.value.criteria[0].score).toBe(0);
    const invented = parseCritic(answer('instagram', [2, 2, 2, 2, 2], ['Mande para quem organiza a festa', ...IG_QUOTES.slice(1)]), 'instagram', IG);
    expect(invented.value.criteria[0]).toMatchObject({ score: 1, evidence: null });
    expect(evidenceIsInPost('SALVE ESTE POST!', IG)).toBe(true);
    expect(evidenceIsInPost('seu bolo esta pronto', IG)).toBe(true);
    expect(evidenceIsInPost('ok', IG)).toBe(false);
  });

  it('tetos por código: LinkedIn sem pergunta, Instagram que pede salvar sem pedir, capa longa', () => {
    const noQuestion = { ...LI, text: LI.text.replace('?', '.') };
    const a = parseCritic(answer('linkedin', [2, 2, 2, 2, 2], LI_QUOTES.map((q) => q.replace('?', ''))), 'linkedin', noQuestion);
    expect(a.value.criteria.find((c) => c.id === 'pergunta')).toMatchObject({ score: 0, evidence: 'O texto não tem nenhuma pergunta.' });
    const b = parseCritic(answer('instagram', [2, 2, 2, 2, 2], IG_QUOTES), 'instagram', { ...IG, text: 'Três sinais para conferir o bolo. Chame a gente no WhatsApp.' });
    expect(b.value.criteria.find((c) => c.id === 'chamada').score).toBe(0);
    const c = parseCritic(answer('instagram', [2, 2, 2, 2, 2], IG_QUOTES), 'instagram', { ...IG, coverText: 'uma capa com muito mais de doze palavras escritas aqui só para passar do limite combinado agora' });
    expect(c.value.criteria.find((x) => x.id === 'gancho').score).toBe(1);
    const d = parseCritic(answer('linkedin', [2, 2, 2, 2, 2], LI_QUOTES), 'linkedin', { ...LI, text: `${'a'.repeat(170)}\nsegunda linha\n\nQual sinal você confere primeiro?` });
    expect(d.value.criteria.find((x) => x.id === 'gancho').score).toBe(1);
  });

  it('resposta incompleta ou com nota inválida volta com o motivo', () => {
    expect(parseCritic(null, 'instagram', IG).ok).toBe(false);
    expect(parseCritic({}, 'instagram', IG).error).toContain('criteria');
    const partial = { criteria: answer('instagram', [2, 2, 2, 2, 2], IG_QUOTES).criteria.slice(0, 4) };
    expect(parseCritic(partial, 'instagram', IG).error).toContain('"chamada"');
    expect(parseCritic(answer('instagram', [3, 2, 2, 2, 2], IG_QUOTES), 'instagram', IG).error).toContain('0, 1 ou 2');
    expect(parseCritic(answer('instagram', ['dois', 2, 2, 2, 2], IG_QUOTES), 'instagram', IG).error).toContain('"envio"');
  });

  it('a faixa: forte de 1,6, médio de 1, o resto fraco', () => {
    const at = (scores) => bandOf(scores.map((score) => ({ score })));
    expect(at([2, 2, 2, 1, 1])).toBe('forte');
    expect(at([2, 1, 1, 1, 1])).toBe('medio');
    expect(at([2, 0, 1, 1, 0])).toBe('fraco');
    expect(at([0, 0, 0, 0, 0])).toBe('fraco');
  });

  it('o conserto atende só a nota 0 que tem sugestão', () => {
    const r = parseCritic(answer('instagram', [2, 1, 2, 0, 0], IG_QUOTES, 'Acrescente o fato.'), 'instagram', IG);
    expect(weakCriteria(r.value).map((c) => c.id)).toEqual(['fato', 'chamada']);
    const noSuggestion = { ...r.value, criteria: r.value.criteria.map((c) => ({ ...c, suggestion: null })) };
    expect(weakCriteria(noSuggestion)).toEqual([]);
  });

  it('a avaliação lida do banco passa pelo mesmo crivo', () => {
    const r = parseCritic(answer('linkedin', [2, 2, 2, 2, 1], LI_QUOTES), 'linkedin', LI);
    expect(criticFromStored(JSON.parse(JSON.stringify({ ...r.value, fixed: true })))).toEqual({ ...r.value, fixed: true });
    for (const bad of [null, 'x', [], { channel: 'tiktok', criteria: [] }, { channel: 'linkedin' }, { channel: 'linkedin', criteria: [{ id: 'gancho', score: 5 }] }]) expect(criticFromStored(bad)).toBeNull();
  });
});

describe('conserto de uma volta', () => {
  const input = { channel: 'instagram', text: IG.text, instructions: ['Acrescente o fato: Entregamos no mesmo dia em Marília.'], facts: ctx.facts, never: ['garantia de resultado'], banned: ['imperdível'], limit: 900 };

  it('o prompt leva só as mudanças pedidas, os fatos, o que nunca se afirma e o texto atual', () => {
    const p = buildFixPrompt(input);
    for (const piece of ['legenda do Instagram', 'Faça só as mudanças abaixo', '- Acrescente o fato: Entregamos no mesmo dia em Marília.', 'garantia de resultado', 'Palavras proibidas: imperdível', 'até 900 caracteres', 'Salve este post: três sinais', '{"text":"..."}']) expect(p).toContain(piece);
    expect(buildFixPrompt({ ...input, channel: 'linkedin' })).toContain('texto do post de LinkedIn');
  });

  it('o texto do conserto sai limpo e no teto, e vazio é recusado', () => {
    expect(parseFix({ text: 'Um texto — com travessão' }, 900)).toEqual({ ok: true, text: 'Um texto, com travessão' });
    expect(parseFix({ text: 'x'.repeat(2000) }, 900).text).toHaveLength(900);
    for (const bad of [null, {}, { text: '  ' }, { text: 4 }]) expect(parseFix(bad, 900).ok).toBe(false);
  });
});
