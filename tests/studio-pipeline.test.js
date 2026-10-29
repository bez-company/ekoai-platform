import { describe, it, expect } from 'vitest';
import { StudioError, runStudio } from '../platform/src/lib/studio/pipeline.ts';
import { LEVEL_PLANS } from '../platform/src/lib/studio/config.ts';

const brand = {
  name: 'Casa Aurora',
  handle: 'casaaurora',
  voice: 'descontraída',
  profile: { niche: 'Padaria', offering: 'Pães', audience: 'Famílias', region: 'Marília', pains: [], differentiators: [], voiceFormal: 3, voiceTechnical: 3, voiceSerious: 3, bannedWords: ['imperdível'], colorPrimary: '#3A1F1A', colorAccent: '#E8A33D', fontHeading: 'Playfair Display', fontBody: 'Inter', ctaDefault: 'whatsapp' },
  facts: ['Fornada nova todo dia às 7h'],
  never: [],
  logo: null,
  logoLooks: null,
  hasLogoVariants: false,
};

const scores = (n) => ({ conceito: n, hierarquia: n, tipografia: n, composicao: n, acabamento: n, originalidade: n, marca: n, legibilidade: n, texto: n });
const copy = (headline = 'Pão bom não tem pressa.') => JSON.stringify({ headline, support: 'Um dia inteiro de preparo.', extras: [], caption: 'x'.repeat(120), hashtags: ['#pao'], altText: 'Cartaz' });
const html = (tag = 'ok') => `===NOTES===\nnota\n===HTML===\n<!doctype html><html><body>${tag}</body></html>`;

// O modelo de mentira: cada etapa responde pelo que o teste configurou; guarda as chamadas e soma custo por etapa.
function fakeModel(script = {}, perCall = 0.01) {
  const calls = [];
  const state = { usd: 0, steps: {} };
  const counters = {};
  return {
    calls,
    get costUsd() {
      return state.usd;
    },
    get costByStep() {
      return state.steps;
    },
    async text(call) {
      calls.push(call);
      counters[call.step] = (counters[call.step] ?? 0) + 1;
      state.usd += perCall;
      state.steps[call.step] = { calls: (state.steps[call.step]?.calls ?? 0) + 1, usd: (state.steps[call.step]?.usd ?? 0) + perCall };
      const out = script[call.step];
      const value = typeof out === 'function' ? out(counters[call.step], call) : out;
      if (value === undefined) throw new Error(`sem resposta para ${call.step}`);
      return value;
    },
    async image(call) {
      calls.push({ step: 'imagem', ...call });
      state.usd += 0.1;
      return new Uint8Array([9, 9, 9]);
    },
  };
}

const route = (territory) => JSON.stringify({ read: 'r', objective: 'educar', insight: 'i', routes: [{ territory, bigIdea: 'ideia', hook: 'gancho', visual: 'v' }] });
const art = (assets = []) => JSON.stringify({ concept: 'c', composition: 'k', palette: { bg: '#3A1F1A', ink: '#FFFFFF', accent: '#E8A33D' }, typography: { display: 'Playfair Display', body: 'Inter' }, details: [], logo: { tone: 'on-dark', place: 'canto' }, assets });
const critic = (n, verdict = 'ship', fixes = []) => JSON.stringify({ scores: scores(n), slop: [], fixes, verdict, summary: 's' });
const reviewOk = JSON.stringify({ ok: true, issues: [] });

// O render de mentira: HTML com a palavra DEFECT mede um defeito de margem.
const renderer = (log = []) => ({
  async render(input) {
    log.push(input);
    return { png: new Uint8Array([1, 2, 3]), issues: input.html.includes('DEFECT') ? [{ rule: 'safe_margin', detail: '"x" (margem)' }] : [] };
  },
});

const base = { brand, request: 'post sobre o pão', effort: 'refinado', style: 'cartaz-tipografico', imageQuality: 'padrao', ratio: '4:5', seed: 7, logos: {} };
const happy = () => ({ marketing: route('cartaz-tipografico'), redator: copy(), arte: art(), designer: html(), critico: critic(8.5), revisor: reviewOk });

describe('pipeline do estúdio (SPEC 030, F2)', () => {
  it('caminho feliz: cada agente uma vez, na ordem, sem refino quando o crítico aprova', async () => {
    const model = fakeModel(happy());
    const out = await runStudio({ model, renderer: renderer() }, base);
    expect(model.calls.map((c) => c.step)).toEqual(['marketing', 'redator', 'arte', 'designer', 'critico', 'revisor']);
    expect(out.copy.headline).toBe('Pão bom não tem pressa.');
    expect(out.territory).toBe('cartaz-tipografico');
    expect(out.score).toBeGreaterThanOrEqual(8);
    expect(out.gate.ok).toBe(true);
    expect(out.capped).toBe(false);
    expect(out.html).toContain('<body>ok</body>');
  });

  it('cada papel usa o modelo do nível: Refinado põe o designer em Flash e o resto em Pro', async () => {
    const model = fakeModel(happy());
    await runStudio({ model, renderer: renderer() }, base);
    const by = Object.fromEntries(model.calls.map((c) => [c.step, c.model]));
    expect(by.designer).toBe('fast');
    expect(by.marketing).toBe('smart');
    expect(by.critico).toBe('smart');
    expect(by.revisor).toBe('smart');
    const auto = fakeModel(happy());
    await runStudio({ model: auto, renderer: renderer() }, { ...base, effort: 'autoral' });
    expect(auto.calls.find((c) => c.step === 'designer').model).toBe('smart');
  });

  it('texto reprovado pelo revisor por regra volta ao redator com o motivo', async () => {
    const model = fakeModel({ ...happy(), redator: (n) => (n === 1 ? copy('Pão imperdível') : copy('Pão bom não tem pressa.')) });
    const out = await runStudio({ model, renderer: renderer() }, base);
    expect(model.calls.filter((c) => c.step === 'redator')).toHaveLength(2);
    expect(model.calls.filter((c) => c.step === 'redator')[1].prompt).toContain('imperdível');
    expect(out.copy.headline).toBe('Pão bom não tem pressa.');
  });

  it('resposta fora do contrato repete uma vez; falhando de novo, o erro diz a etapa', async () => {
    const flaky = fakeModel({ ...happy(), marketing: (n) => (n === 1 ? 'não é json' : route('cartaz-tipografico')) });
    await runStudio({ model: flaky, renderer: renderer() }, base);
    expect(flaky.calls.filter((c) => c.step === 'marketing')).toHaveLength(2);
    const broken = fakeModel({ ...happy(), marketing: 'lixo' });
    await expect(runStudio({ model: broken, renderer: renderer() }, base)).rejects.toMatchObject({ name: 'Error', step: 'marketing' });
    await expect(runStudio({ model: fakeModel({ ...happy(), marketing: 'lixo' }), renderer: renderer() }, base)).rejects.toBeInstanceOf(StudioError);
  });

  it('defeito medido no render volta ao designer antes do crítico', async () => {
    const model = fakeModel({ ...happy(), designer: html('DEFECT'), conserto: html('limpo') });
    const out = await runStudio({ model, renderer: renderer() }, base);
    expect(model.calls.map((c) => c.step)).toContain('conserto');
    expect(out.html).toContain('limpo');
    expect(out.layoutIssues).toEqual([]);
  });

  it('o embelezador que piora é descartado: fica a melhor versão', async () => {
    const model = fakeModel({
      ...happy(),
      designer: html('primeira'),
      embelezador: html('polida'),
      critico: (n) => (n === 1 ? critic(6, 'revise', [{ severity: 'alta', fix: 'aumentar o título', target: 'layout' }]) : critic(5, 'revise')),
    });
    const out = await runStudio({ model, renderer: renderer() }, base);
    expect(model.calls.filter((c) => c.step === 'embelezador')).toHaveLength(1);
    expect(out.html).toContain('primeira');
    expect(out.score).toBe(6);
  });

  it('embelezador com defeito novo no render é descartado sem gastar crítica', async () => {
    const model = fakeModel({ ...happy(), critico: critic(6, 'revise', [{ severity: 'alta', fix: 'x', target: 'layout' }]), embelezador: html('DEFECT') });
    const out = await runStudio({ model, renderer: renderer() }, base);
    expect(model.calls.filter((c) => c.step === 'critico')).toHaveLength(1);
    expect(out.iterations.some((i) => i.discarded)).toBe(true);
    expect(out.html).not.toContain('DEFECT');
  });

  it('passou do teto de custo: fecha com a melhor versão, sem refino nem conserto', async () => {
    const model = fakeModel({ ...happy(), critico: critic(5, 'revise', [{ severity: 'alta', fix: 'x', target: 'layout' }]) }, LEVEL_PLANS.refinado.capUsd);
    const out = await runStudio({ model, renderer: renderer() }, base);
    expect(model.calls.map((c) => c.step)).not.toContain('embelezador');
    expect(out.capped).toBe(true);
  });

  it('revisor final reprovando leva a um conserto do designer', async () => {
    const model = fakeModel({ ...happy(), revisor: (n) => (n === 1 ? JSON.stringify({ ok: false, issues: [{ rule: 'legibilidade', detail: '@ ilegível', fix: 'mover' }] }) : reviewOk), conserto: html('corrigido') });
    const out = await runStudio({ model, renderer: renderer() }, base);
    expect(model.calls.map((c) => c.step)).toContain('conserto');
    expect(out.html).toContain('corrigido');
    expect(out.gate.ok).toBe(true);
  });

  it('Pro faz 2 rascunhos e devolve o outro como alternativa', async () => {
    const model = fakeModel({ ...happy(), designer: (n) => html(`rascunho ${n}`), critico: (n) => critic(n === 1 ? 7 : 8.5) });
    const out = await runStudio({ model, renderer: renderer() }, { ...base, effort: 'pro' });
    expect(model.calls.filter((c) => c.step === 'designer')).toHaveLength(2);
    expect(out.alternatives).toHaveLength(1);
  });

  it('estilo com imagem: gera a imagem na qualidade escolhida, sem rosto nem criança, e o designer a vê', async () => {
    const asset = { id: 'hero', role: 'fundo', aspect: '4:5', prompt: 'A surreal photographic scene with a loaf of bread as a building at dusk' };
    const model = fakeModel({ ...happy(), marketing: route('surreal-fotografico'), arte: art([asset]) });
    const out = await runStudio({ model, renderer: renderer() }, { ...base, style: 'surreal-fotografico', imageQuality: 'alta' });
    const img = model.calls.find((c) => c.step === 'imagem');
    expect(img.quality).toBe('alta');
    expect(img.prompt).toContain('no recognizable faces');
    expect(img.prompt).toContain('no children');
    expect(model.calls.find((c) => c.step === 'designer').images).toHaveLength(1);
    expect(Object.keys(out.assets)).toEqual(['hero']);
  });

  it('estilo minimalista nunca gera imagem, mesmo que a direção de arte peça', async () => {
    const asset = { id: 'hero', role: 'fundo', aspect: '4:5', prompt: 'A surreal photographic scene with a loaf of bread as a building at dusk' };
    const model = fakeModel({ ...happy(), arte: art([asset]) });
    const out = await runStudio({ model, renderer: renderer() }, base);
    expect(model.calls.some((c) => c.step === 'imagem')).toBe(false);
    expect(out.assets).toEqual({});
  });
});
