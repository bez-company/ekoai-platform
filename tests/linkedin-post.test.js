import { describe, it, expect } from 'vitest';
import { LINKEDIN_LIMITS, buildLinkedInPrompt, hookOf, linkedInBody, parseLinkedIn } from '../platform/src/lib/linkedin-post.ts';
import { profileFromRow } from '../platform/src/lib/company-profile-model.ts';

const profile = profileFromRow({ niche: 'Confeitaria', offering: 'Bolos sob encomenda', audience: 'Famílias', region: 'Marília', voice_formal: 3, voice_technical: 3, voice_serious: 3, banned_words: ['imperdível'], differentiators: ['Entrega no mesmo dia'], pains: [] });
const core = { angle: 'Três sinais de que o bolo está no ponto', points: ['A massa desgruda da borda', 'O palito sai limpo no centro', 'O topo volta ao toque'], proof: 'Entregamos no mesmo dia em Marília', question: 'Qual sinal você confere primeiro?' };
const input = { idea: 'sinais de que o bolo está pronto', goal: 'ensinar algo útil ao público', core, profile, facts: ['Entregamos no mesmo dia em Marília'], never: ['garantia de resultado'], rules: ['Frase curta'] };
const REASON = 'Quem também faz bolo de festa responde com o sinal que confere primeiro';
const post = (over = {}) => ({ text: 'O erro mais caro de uma confeitaria é tirar o bolo do forno cedo demais.\nEu só abro a porta quando três coisas acontecem:\n\n1. A borda descola da forma.\n\nQual sinal você confere primeiro?', hashtags: ['confeitaria'], share_reason: REASON, ...over });

describe('prompt do LinkedIn (SPEC 028, BEZ-424)', () => {
  it('parte do núcleo, com o que o LinkedIn pesa e as regras de abertura e de pergunta', () => {
    const p = buildLinkedInPrompt(input);
    expect(p).toContain('perfil pessoal');
    expect(p).toContain('## O que o LinkedIn pesa');
    for (const piece of ['Ângulo: Três sinais de que o bolo está no ponto', 'A massa desgruda da borda; O palito sai limpo no centro; O topo volta ao toque', 'Fato que sustenta: Entregamos no mesmo dia em Marília', 'Pergunta que o público responde: Qual sinal você confere primeiro?']) expect(p).toContain(piece);
    expect(p).toContain('duas primeiras linhas');
    expect(p).toContain('UMA pergunta que um colega de profissão responde');
    expect(p).toContain('não o cliente final');
    expect(p).toContain('reescreva-a para o colega');
    expect(p).toContain('Palavras proibidas: imperdível');
    expect(p).toContain('garantia de resultado');
    expect(p).toContain('{"text":"...","hashtags":["..."],"share_reason":"..."}');
  });

  it('não é um prompt de Instagram: sem legenda, chamada para a bio nem carrossel', () => {
    const p = buildLinkedInPrompt(input);
    expect(p).not.toMatch(/no Instagram|legenda|link na bio|CARROSSEL|visual_prompt/);
  });

  it('núcleo sem fato nem pergunta não deixa linha vazia, e a volta do revisor leva o motivo e a versão anterior', () => {
    const bare = buildLinkedInPrompt({ ...input, core: { ...core, proof: null, question: null } });
    expect(bare).not.toContain('Fato que sustenta');
    expect(bare).not.toContain('Pergunta que o público responde');
    const again = buildLinkedInPrompt({ ...input, feedback: [{ rule: 'banned_word', detail: 'imperdível', message: 'A palavra "imperdível" está na lista do que a marca nunca usa.', where: 'caption' }], previous: { text: 'Texto antigo', hashtags: [], shareReason: REASON } });
    expect(again).toContain('Corrija SÓ o que está abaixo');
    expect(again).toContain('"imperdível" está na lista');
    expect(again).toContain('Texto antigo');
    expect(buildLinkedInPrompt(input)).not.toContain('Corrija SÓ');
  });
});

describe('leitura do texto do LinkedIn', () => {
  it('guarda o texto, as hashtags limpas e a razão', () => {
    const r = parseLinkedIn(post({ hashtags: ['#Confeitaria', 'confeitaria', 'Bolo Caseiro!', 'a', 'b', 'c'] }));
    expect(r.ok).toBe(true);
    expect(r.value.hashtags).toEqual(['confeitaria', 'bolocaseiro', 'a']);
    expect(r.value.shareReason).toBe(REASON);
    expect(r.value.text.startsWith('O erro mais caro')).toBe(true);
  });

  it('tira o travessão, junta linhas em branco demais e corta no teto', () => {
    expect(parseLinkedIn(post({ text: 'Primeira linha — com travessão aqui.\nSegunda linha que segue o gancho.\n\n\n\n\nFim.' })).value.text).toBe('Primeira linha, com travessão aqui.\nSegunda linha que segue o gancho.\n\nFim.');
    const long = parseLinkedIn(post({ text: `Primeira linha longa o bastante.\nSegunda linha.\n${'palavra '.repeat(500)}` }));
    expect(long.value.text.length).toBeLessThanOrEqual(LINKEDIN_LIMITS.text);
  });

  it('sem texto, sem abertura ou sem razão, a resposta volta ao modelo com o motivo', () => {
    expect(parseLinkedIn(null).ok).toBe(false);
    expect(parseLinkedIn([]).ok).toBe(false);
    for (const text of [undefined, '', '   ', 42]) expect(parseLinkedIn(post({ text })).error).toContain('texto do post do LinkedIn');
    expect(parseLinkedIn(post({ text: 'Oi' })).error).toContain('abrir com uma frase');
    for (const share_reason of [undefined, '', 'para comentar', 7]) {
      const r = parseLinkedIn(post({ share_reason }));
      expect(r.ok).toBe(false);
      expect(r.error).toContain('share_reason');
    }
  });

  it('o gancho são as duas primeiras linhas, no teto, e o corpo leva as hashtags no fim', () => {
    expect(hookOf('Linha um.\n\nLinha dois.\nLinha três.')).toBe('Linha um.\nLinha dois.');
    expect(hookOf('x'.repeat(500))).toHaveLength(LINKEDIN_LIMITS.hook);
    expect(linkedInBody({ text: 'Texto.', hashtags: ['a', 'b'], shareReason: REASON })).toBe('Texto.\n\n#a #b');
    expect(linkedInBody({ text: 'Texto.', hashtags: [], shareReason: REASON })).toBe('Texto.');
  });
});
