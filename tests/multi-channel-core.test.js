import { describe, it, expect } from 'vitest';
import { CORE_LIMITS, buildCopyPrompt, parseCopy, parseCore } from '../platform/src/lib/agents.ts';
import { GENERATED_CHANNELS, STEPS } from '../platform/src/lib/generation-model.ts';
import { parsePostRequest } from '../platform/src/lib/post-requests.ts';
import { profileFromRow } from '../platform/src/lib/company-profile-model.ts';

const profile = profileFromRow({ niche: 'Alimentação', offering: 'Bolos', audience: 'Famílias', voice_formal: 3, voice_technical: 3, voice_serious: 3, banned_words: [], differentiators: [], pains: [] });
const input = { idea: 'sinais de que o bolo está pronto', kind: 'informativo', profile, facts: [], never: [], rules: [] };
const CORE = { angle: 'Três sinais de que o bolo está no ponto', points: ['A massa desgruda da borda', 'O palito sai limpo no centro', 'O topo volta ao toque'], proof: 'Entregamos no mesmo dia em Marília', question: 'Qual sinal você confere primeiro?' };
const raw = (over = {}) => ({ kind: 'informativo', angle: 'dica', texts: { title: 'Seu bolo está pronto?' }, caption: 'Legenda', hashtags: ['bolo'], signal: 'salvar', share_reason: 'Quem faz bolo em casa guarda os sinais para consultar na hora de tirar do forno', core: CORE, ...over });

describe('pedido para mais de uma rede (SPEC 028, BEZ-424)', () => {
  it('o pedido aceita channels, sem repetir, e sem channels fica como era', () => {
    expect(parsePostRequest({ idea: 'x' }).value.channels).toBeUndefined();
    expect(parsePostRequest({ idea: 'x', channels: ['instagram'] }).value.channels).toEqual(['instagram']);
    expect(parsePostRequest({ idea: 'x', channels: ['instagram', 'instagram'] }).value.channels).toEqual(['instagram']);
  });

  it('channels vazio, fora da lista ou que não é lista volta com o motivo e o campo', () => {
    for (const channels of [[], 'instagram', {}, ['tiktok'], ['instagram', 3], [null]]) {
      const r = parsePostRequest({ idea: 'x', channels });
      expect(r.ok, JSON.stringify(channels)).toBe(false);
      expect(r.field).toBe('channels');
    }
  });

  it('rede que a geração ainda não escreve é recusada com o próximo passo, em vez de ficar de fora em silêncio', () => {
    expect(GENERATED_CHANNELS).toEqual(['instagram']);
    const r = parsePostRequest({ idea: 'x', channels: ['instagram', 'linkedin', 'twitter'] });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('Ainda não dá para criar posts para o LinkedIn e o X. Escolha só o Instagram por enquanto.');
  });

  it('as etapas novas existem para registrar o custo de cada passo', () => {
    for (const step of ['core', 'adapt', 'critic', 'fix', 'publish']) expect(STEPS).toContain(step);
  });

  it('o prompt pede o núcleo só quando há outra rede', () => {
    const solo = buildCopyPrompt({ ...input, channels: ['instagram'] });
    expect(solo).not.toContain('- core:');
    expect(solo).not.toContain('"core":');
    expect(buildCopyPrompt(input)).not.toContain('- core:');
    const multi = buildCopyPrompt({ ...input, channels: ['instagram', 'linkedin', 'twitter'] });
    expect(multi).toContain('- core:');
    expect(multi).toContain('LinkedIn e X');
    expect(multi).toContain('elas NÃO leem a legenda do Instagram');
    expect(multi).toContain('"core":{"angle":"...","points":["...","..."],"proof":null,"question":null},"caption"');
    expect(buildCopyPrompt({ ...input, channels: ['instagram', 'linkedin'], format: 'carousel' })).toContain('"core":{"angle"');
  });

  it('o parser guarda o núcleo quando pedido, e ignora quando não', () => {
    const r = parseCopy(raw(), null, 'single', null, null, true);
    expect(r.ok).toBe(true);
    expect(r.value.core).toEqual(CORE);
    expect(parseCopy(raw(), null).value.core).toBeUndefined();
  });

  it('sem núcleo utilizável, a resposta volta ao modelo com o motivo', () => {
    for (const core of [undefined, null, 'x', [], {}, { angle: 'a' }, { angle: 'a', points: ['só um'] }, { angle: '', points: ['um', 'dois'] }, { angle: 'a', points: ['  ', ''] }]) {
      const r = parseCopy(raw({ core }), null, 'single', null, null, true);
      expect(r.ok, JSON.stringify(core)).toBe(false);
      expect(r.error).toContain('núcleo da ideia');
    }
  });

  it('o núcleo sai limpo: sem travessão, no teto, fato e pergunta opcionais', () => {
    const c = parseCore({ angle: 'Um ângulo — com travessão', points: ['a'.repeat(300), 'b', 'c', 'd', 'e', 'f'], proof: '  ', question: undefined });
    expect(c.angle).toBe('Um ângulo, com travessão');
    expect(c.points).toHaveLength(CORE_LIMITS.points);
    expect(c.points[0]).toHaveLength(CORE_LIMITS.point);
    expect(c.proof).toBeNull();
    expect(c.question).toBeNull();
    expect(parseCore(CORE)).toEqual(CORE);
  });
});
