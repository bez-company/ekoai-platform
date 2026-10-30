import { describe, it, expect } from 'vitest';
import { chainProblem } from '../platform/src/lib/studio/generate.ts';
import { MIN_DELIVER_SCORE } from '../platform/src/lib/studio/config.ts';
import { reviewerPrompt } from '../platform/src/lib/studio/prompts.ts';

const ok = { gate: { ok: true, issues: [] }, layoutIssues: [], score: 8.1, verdict: 'ship', costUsd: 0.25, capped: false };

describe('portão da cadeia de agentes', () => {
  it('peça aprovada pelo revisor, sem defeito medido e com nota suficiente vai para Aprovar', () => {
    expect(chainProblem(ok)).toBeNull();
    expect(chainProblem({ ...ok, score: MIN_DELIVER_SCORE, verdict: 'revise' })).toBeNull();
  });

  it('nota abaixo do mínimo recusa, mesmo com o revisor e o layout limpos', () => {
    const why = chainProblem({ ...ok, score: 6.4, verdict: 'revise' });
    expect(why).toContain('abaixo do mínimo');
    expect(why).toContain('6.4');
  });

  it('revisor e layout dizem o motivo; sem motivo do revisor ainda recusa', () => {
    expect(chainProblem({ ...ok, gate: { ok: false, issues: [{ rule: 'text_drift', detail: 'palavra trocada', fix: 'x' }] } })).toContain('revisor=text_drift palavra trocada');
    expect(chainProblem({ ...ok, layoutIssues: [{ rule: 'safe_margin', detail: 'título' }] })).toContain('layout=safe_margin título');
    expect(chainProblem({ ...ok, gate: { ok: false, issues: [] } })).toContain('reprovou sem motivo');
  });
});

describe('revisor e designer concordam sobre a assinatura', () => {
  const brand = { name: 'Ekoai', handle: null, voice: 'v', profile: {}, facts: [], never: [], logo: { width: 72, height: 72 }, logoLooks: null, hasLogoVariants: false };
  it('a falta da assinatura da marca não é text_drift: o logo ou o @ bastam', () => {
    const text = reviewerPrompt({ brand, copy: { headline: 'Título', support: null, extras: [], caption: 'x', hashtags: [], altText: 'a' } });
    expect(text).toContain('OPCIONAL');
    expect(text).toContain('não conta como faltando');
  });
});
