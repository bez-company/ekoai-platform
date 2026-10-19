import { describe, it, expect } from 'vitest';
import { parseFeedbackInput, parseRuleInput, parseRulePatch } from '../platform/src/lib/learning.ts';

describe('validação na plataforma (learning.ts)', () => {
  it('feedback válido', () => {
    const r = parseFeedbackInput({ aspect: 'visual', note: ' fundo escuro ', channel: 'instagram', post_id: 'nao-uuid' });
    expect(r).toEqual({
      ok: true,
      value: {
        aspect: 'visual',
        sentiment: 'negativo',
        note: 'fundo escuro',
        channel: 'instagram',
        excerpt: null,
        pending_id: null,
        scheduled_post_id: null,
        post_id: null,
      },
    });
  });

  it('feedback sem aspecto, sem nota ou com rede inválida é recusado', () => {
    expect(parseFeedbackInput({ note: 'x' }).ok).toBe(false);
    expect(parseFeedbackInput({ aspect: 'tom', note: '   ' }).ok).toBe(false);
    expect(parseFeedbackInput({ aspect: 'tom', note: 'x', channel: 'tiktok' }).ok).toBe(false);
    expect(parseFeedbackInput(null).ok).toBe(false);
  });

  it('"todas" vira canal null', () => {
    const r = parseFeedbackInput({ aspect: 'tom', note: 'x', channel: 'todas' });
    expect(r.ok && r.value.channel).toBe(null);
  });

  it('regra: exige texto e aspecto', () => {
    expect(parseRuleInput({ rule: 'Sem emoji', aspect: 'tom', channel: 'todas' })).toEqual({
      ok: true,
      value: { rule: 'Sem emoji', aspect: 'tom', channel: null },
    });
    expect(parseRuleInput({ rule: '', aspect: 'tom' }).ok).toBe(false);
    expect(parseRuleInput({ rule: 'x', aspect: 'humor' }).ok).toBe(false);
  });

  it('patch: liga/desliga, reescreve, ou recusa vazio', () => {
    const id = '3f2a9c1e-7b4d-4e2a-9c11-aa00bb11cc22';
    expect(parseRulePatch({ id, active: false })).toEqual({ ok: true, value: { id, active: false } });
    const edit = parseRulePatch({ id, rule: 'Nova', aspect: 'cta', channel: 'twitter' });
    expect(edit.ok && edit.value.input).toEqual({ rule: 'Nova', aspect: 'cta', channel: 'twitter' });
    expect(parseRulePatch({ id }).ok).toBe(false);
    expect(parseRulePatch({ id: 'x', active: true }).ok).toBe(false);
  });
});
