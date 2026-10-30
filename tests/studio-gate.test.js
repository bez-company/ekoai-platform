import { describe, it, expect } from 'vitest';
import { chainProblem, withRetries } from '../platform/src/lib/studio/generate.ts';
import { MIN_DELIVER_SCORE } from '../platform/src/lib/studio/config.ts';
import { designerPrompt, reviewerPrompt } from '../platform/src/lib/studio/prompts.ts';
import { audienceLabel, parseCopy } from '../platform/src/lib/studio/parse.ts';
import { extraVariants, handleProblem, marksIn, markKey } from '../platform/src/lib/studio/marks.ts';

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

describe('tentar de novo antes de cair no Rápido (BEZ-479)', () => {
  const plan = { attempts: 3, totalCapUsd: 1.8, typicalUsd: 0.6 };
  const attempt = (problem, costUsd = 0.5) => ({ value: 'peça', problem, costUsd });

  it('passou na primeira: não gasta de novo', async () => {
    let calls = 0;
    const out = await withRetries(async () => (calls += 1, attempt(null)), plan);
    expect(calls).toBe(1);
    expect(out.passed).not.toBeNull();
    expect(out.tries).toBe(1);
  });

  it('recusou na primeira e passou na segunda: a segunda recebe a lição da primeira', async () => {
    const seen = [];
    const out = await withRetries(async (n, lessons) => (seen.push([n, [...lessons]]), attempt(n === 1 ? 'layout=safe_margin título' : null)), plan);
    expect(out.passed).not.toBeNull();
    expect(out.tries).toBe(2);
    expect(out.spentUsd).toBeCloseTo(1.0, 5);
    expect(seen).toEqual([[1, []], [2, ['layout=safe_margin título']]]);
  });

  it('esgota as tentativas: devolve a última recusa com os motivos de todas', async () => {
    const out = await withRetries(async (n) => attempt(`motivo ${n}`, 0.3), plan);
    expect(out.passed).toBeNull();
    expect(out.tries).toBe(3);
    expect(out.problems).toEqual(['motivo 1', 'motivo 2', 'motivo 3']);
  });

  it('sem saldo para outra tentativa típica, para antes (nunca passa do teto)', async () => {
    const out = await withRetries(async (n) => attempt(`motivo ${n}`, 0.9), { attempts: 3, totalCapUsd: 1.8, typicalUsd: 0.6 });
    expect(out.tries).toBe(2);
    expect(out.spentUsd).toBeCloseTo(1.8, 5);
  });
});

describe('o designer recebe as lições das tentativas anteriores', () => {
  const brand = { name: 'Ekoai', handle: null, voice: 'v', profile: { niche: 'n', offering: 'o', audience: 'a', fontHeading: 'Sora', fontBody: 'Inter', colorPrimary: '#111111', colorAccent: '#e8522f' }, facts: [], never: [], logo: null, logoLooks: null, hasLogoVariants: false };
  const copy = { headline: 'Título', support: null, extras: [], caption: 'c', hashtags: [], altText: 'a' };
  const art = { concept: 'c', composition: 'x', palette: { bg: '#111111', ink: '#ffffff', accent: '#e8522f' }, typography: { display: 'Sora', body: 'Inter' }, details: [], logo: { tone: 'on-dark', place: 'canto' }, assets: [] };
  const base = { brand, request: 'pedido', copy, art, territory: { id: 'cartaz-tipografico', name: 'Cartaz', brief: 'b', image: 'none' }, ratio: '4:5', images: [] };

  it('lições entram no prompt e sem lições a seção some', () => {
    const withLessons = designerPrompt({ ...base, lessons: ['layout=text_overlap "a" e "b"'] });
    expect(withLessons).toContain('LIÇÕES DAS TENTATIVAS ANTERIORES');
    expect(withLessons).toContain('text_overlap');
    expect(designerPrompt(base)).not.toContain('LIÇÕES DAS TENTATIVAS ANTERIORES');
  });
});

describe('rótulo de público no texto (BEZ-504)', () => {
  const copy = (over) => ({ headline: 'Seu site em um dia', support: null, extras: [], caption: 'x'.repeat(300), hashtags: ['#site'], altText: 'a', ...over });

  it('reprova "todo X que não ..." no título, no apoio, nos extras e na legenda', () => {
    for (const bad of ['Para todo empreendedor que não sabe programar', 'Todos os donos de loja que não têm site', 'toda empresa que não usa dados']) {
      expect(audienceLabel(bad), bad).not.toBeNull();
      expect(parseCopy(copy({ headline: bad })).ok, bad).toBe(false);
      expect(parseCopy(copy({ support: bad })).ok, bad).toBe(false);
      expect(parseCopy(copy({ caption: `${bad} ${'x'.repeat(300)}` })).ok, bad).toBe(false);
    }
  });

  it('deixa passar frase que fala com a pessoa', () => {
    for (const ok of ['Todo mundo erra no começo', 'Quem não sabe programar também cria', 'Seu site em um dia']) expect(parseCopy(copy({ headline: ok })).ok, ok).toBe(true);
  });
});

describe('logo e @ da marca ligáveis (BEZ-502)', () => {
  const html = '<body><img src="{{logo:on-dark}}"><span data-handle>@conta</span></body>';

  it('descobre o que a peça tem para ligar e desligar', () => {
    expect(marksIn(html, true)).toEqual({ logo: true, handle: true });
    expect(marksIn(html, false)).toEqual({ logo: false, handle: true });
    expect(marksIn('<body><p>oi</p></body>', true)).toEqual({ logo: false, handle: false });
  });

  it('renderiza as outras combinações, nunca a inteira nem a que não existe', () => {
    expect(extraVariants({ logo: true, handle: true }).map(markKey).sort()).toEqual(['00', '01', '10']);
    expect(extraVariants({ logo: false, handle: true }).map(markKey)).toEqual(['00']);
    expect(extraVariants({ logo: false, handle: false })).toEqual([]);
  });

  it('refuga a peça sem o @ só quando a conta tem @', () => {
    expect(handleProblem('<body></body>', 'conta')).toMatch(/data-handle/);
    expect(handleProblem(html, 'conta')).toBeNull();
    expect(handleProblem('<body></body>', null)).toBeNull();
  });
});
