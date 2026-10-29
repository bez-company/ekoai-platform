import { describe, it, expect } from 'vitest';
import { fillTemplate, leftoverTexts, parseTemplate, parseTemplateFill, resolvePalette, runTemplatePost, sentinelHtml } from '../platform/src/lib/studio/templates.ts';

const html = (extra = '') => `<!doctype html><html><head><style>:root{--bg:#111;--ink:#fff;--accent:#f80}</style></head><body><h1 data-fit="headline">{{slot:headline}}</h1><p data-fit="support">{{slot:support}}</p><small>{{handle}}</small>${extra}</body></html>`;
const tpl = (over = {}) => ({ id: 'cartaz', meta: { tone: 'dark', needsImage: false, imageSlot: null, slots: { headline: { max: 40 }, support: { max: 80 } }, summary: 'Cartaz tipográfico' }, html: html(), ...over });
const brand = { name: 'Casa Aurora', handle: 'casaaurora', voice: 'descontraída', profile: { niche: 'Padaria', offering: 'Pães', audience: 'Famílias', region: 'Marília', pains: [], differentiators: [], voiceFormal: 3, voiceTechnical: 3, voiceSerious: 3, bannedWords: [], colorPrimary: '#3A1F1A', colorAccent: '#E8A33D', fontHeading: 'Playfair Display', fontBody: 'Inter', ctaDefault: 'whatsapp' }, facts: [], never: [], logo: null, logoLooks: null, hasLogoVariants: false };
const fillJson = (over = {}) => JSON.stringify({ template: 'cartaz', slots: { headline: 'Pão bom não tem pressa', support: 'Fermentação natural, todo dia.' }, caption: 'x'.repeat(120), hashtags: ['#pao'], altText: 'Cartaz', palette: { bg: '#3A1F1A', ink: '#FFFFFF', accent: '#E8A33D' }, imagePrompt: null, ...over });

describe('template de post (SPEC 030)', () => {
  it('aceita o template válido e recusa script, slot não declarado e imagem sem marcador', () => {
    expect(parseTemplate(tpl()).ok).toBe(true);
    expect(parseTemplate(tpl({ html: html('<script>x()</script>') }))).toMatchObject({ ok: false });
    expect(parseTemplate(tpl({ html: html('<i>{{slot:inventado}}</i>') }))).toMatchObject({ ok: false });
    expect(parseTemplate(tpl({ meta: { ...tpl().meta, needsImage: true, imageSlot: 'espaço livre à esquerda' } }))).toMatchObject({ ok: false });
    expect(parseTemplate(tpl({ meta: { ...tpl().meta, slots: { support: { max: 80 } } } }))).toMatchObject({ ok: false });
    expect(parseTemplate(tpl({ meta: { ...tpl().meta, slots: { headline: { max: 1 } } } }))).toMatchObject({ ok: false });
    expect(parseTemplate(null)).toMatchObject({ ok: false });
  });

  it('preenche slots escapados, o @ e a paleta e as fontes da marca como variáveis', () => {
    const out = fillTemplate(tpl(), { slots: { headline: 'Pão & "café"', support: 'x' }, handle: 'casaaurora', palette: { bg: '#3A1F1A', ink: '#FFFFFF', accent: '#E8A33D' }, fonts: { display: 'Playfair Display', body: 'Inter' } });
    expect(out).toContain('Pão &amp; &quot;café&quot;');
    expect(out).toContain('@casaaurora');
    expect(out).toContain('--bg:#3A1F1A');
    expect(out).toContain('--display:"Playfair Display"');
    expect(out).not.toContain('{{slot:');
  });

  it('texto acima do limite é cortado no limite, e o slot sem texto some, menos o headline', () => {
    const ok = parseTemplateFill(JSON.parse(fillJson({ slots: { headline: 'a'.repeat(60) } })), [tpl()]);
    expect(ok.ok).toBe(true);
    expect(ok.value.slots.headline.length).toBeLessThanOrEqual(40);
    expect(ok.value.slots.support).toBeUndefined();
    expect(parseTemplateFill(JSON.parse(fillJson({ slots: { support: 'só apoio' } })), [tpl()])).toMatchObject({ ok: false });
    expect(parseTemplateFill(JSON.parse(fillJson({ caption: 'curta' })), [tpl()])).toMatchObject({ ok: false });
    expect(parseTemplateFill(JSON.parse(fillJson({ template: 'outro' })), [tpl()]).value.template).toBe('cartaz');
  });

  it('a paleta mantém o contraste do texto e cai na marca onde o modelo erra', () => {
    expect(resolvePalette({ bg: '#FFFFFF', ink: '#FEFEFE', accent: '' }, ['#3A1F1A', '#E8A33D'], 'light').ink).toBe('#111111');
    expect(resolvePalette({ bg: '', ink: '', accent: '' }, ['#3A1F1A', '#E8A33D'], 'dark')).toMatchObject({ bg: '#3A1F1A', accent: '#E8A33D' });
  });

  it('lint: sobrou texto fixo fora dos slots?', () => {
    const t = tpl({ html: html('<em>FASE 01</em>') });
    expect(sentinelHtml(t)).toContain('Zq1x');
    const visible = [{ text: 'Zq1x' }, { text: 'Zq2x' }, { text: '@conta' }, { text: 'FASE 01' }, { text: '”', ghost: true }];
    expect(leftoverTexts(visible)).toEqual(['FASE 01']);
  });
});

function fakeModel(replies) {
  const calls = [];
  const queue = [...replies];
  return { calls, costUsd: 0.002, costByStep: {}, async text(c) { calls.push(c); return queue.shift() ?? queue[0] ?? fillJson(); }, async image(c) { calls.push({ step: 'imagem', ...c }); return new Uint8Array([9]); } };
}
const renderer = (issuesFor = () => []) => ({ async render(i) { return { png: new Uint8Array([1]), issues: issuesFor(i) }; } });
const base = { brand, request: 'post sobre o pão', library: [tpl()], seed: 3, ratio: '4:5', imageQuality: 'padrao', colors: ['#3A1F1A', '#E8A33D'], logos: {} };

describe('executor do template', () => {
  it('uma chamada curta de modelo preenche o template e renderiza', async () => {
    const model = fakeModel([fillJson()]);
    const out = await runTemplatePost({ model, renderer: renderer() }, base);
    expect(model.calls).toHaveLength(1);
    expect(model.calls[0]).toMatchObject({ model: 'fast', step: 'preenchimento', json: true });
    expect(out.headline).toBe('Pão bom não tem pressa');
    expect(out.tries).toBe(1);
    expect(out.html).toContain('Pão bom não tem pressa');
    expect(out.textIssues).toEqual([]);
  });

  it('resposta fora do contrato repete uma vez; falhando de novo, o erro diz a etapa', async () => {
    const flaky = fakeModel(['lixo', fillJson()]);
    await runTemplatePost({ model: flaky, renderer: renderer() }, base);
    expect(flaky.calls).toHaveLength(2);
    await expect(runTemplatePost({ model: fakeModel(['lixo', 'lixo']), renderer: renderer() }, base)).rejects.toThrow(/preenchimento/);
  });

  it('defeito medido leva a uma segunda tentativa com outro template, só se a pessoa não fixou o modelo', async () => {
    const other = tpl({ id: 'numero', html: html('<b>{{slot:headline}}</b>') });
    const bad = (i) => (i.html.includes('<b>') ? [] : [{ rule: 'safe_margin', detail: 'x' }]);
    const model = fakeModel([fillJson(), fillJson({ template: 'numero' })]);
    const out = await runTemplatePost({ model, renderer: renderer(bad) }, { ...base, library: [tpl(), other], seed: 1 });
    expect(out.tries).toBe(2);
    expect(out.template).toBe('numero');
    const fixed = await runTemplatePost({ model: fakeModel([fillJson()]), renderer: renderer(() => [{ rule: 'safe_margin', detail: 'x' }]) }, { ...base, library: [tpl(), other], style: 'cartaz' });
    expect(fixed.tries).toBe(1);
  });

  it('o logo na versão errada para o fundo troca de versão sem chamar o modelo', async () => {
    const t = tpl({ html: html('<img src="{{logo:on-light}}">') });
    let first = true;
    const r = { async render(i) { const wrong = i.html.includes('{{logo:on-light}}') ; if (first) { first = false; return { png: new Uint8Array([1]), issues: [{ rule: 'logo_contrast', detail: 'x' }] }; } return { png: new Uint8Array([2]), issues: wrong ? [{ rule: 'logo_contrast', detail: 'x' }] : [] }; } };
    const model = fakeModel([fillJson()]);
    const out = await runTemplatePost({ model, renderer: r }, { ...base, library: [t] });
    expect(model.calls).toHaveLength(1);
    expect(out.html).toContain('{{logo:on-dark}}');
  });

  it('template com imagem gera a imagem na qualidade escolhida, sem rosto nem criança', async () => {
    const t = tpl({ html: html('<img src="{{asset:hero}}">'), meta: { ...tpl().meta, needsImage: true, imageSlot: 'objeto à direita, espaço livre à esquerda' } });
    const model = fakeModel([fillJson({ imagePrompt: 'A loaf of bread on a marble counter, soft side light, shallow depth of field' })]);
    const out = await runTemplatePost({ model, renderer: renderer() }, { ...base, library: [t], imageQuality: 'alta' });
    const img = model.calls.find((c) => c.step === 'imagem');
    expect(img.quality).toBe('alta');
    expect(img.prompt).toContain('no recognizable faces');
    expect(Object.keys(out.assets)).toEqual(['hero']);
  });

  it('biblioteca vazia falha com motivo', async () => {
    await expect(runTemplatePost({ model: fakeModel([]), renderer: renderer() }, { ...base, library: [] })).rejects.toThrow(/vazia/);
  });
});
