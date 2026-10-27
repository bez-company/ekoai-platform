// Carrossel (SPEC 023, ADR 0025), a parte pura: o contrato do redator (2 a 10 lâminas, papel pela posição), o prompt,
// as regras entre lâminas, os specs de cada lâmina e o render da família lamina-item nos extremos de texto.
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { buildCopyPrompt, imageTextsOf, keepWhatPassed, parseCopy } from '../platform/src/lib/agents.ts';
import { inSlide, layoutForRole, reviewSlides, slideSpecs, storedSlides } from '../platform/src/lib/design/carousel.ts';
import { brandFromProfile, compatibleLayouts, isLayout, roleAt, slidePositions } from '../platform/src/lib/design/model.ts';
import { renderPng } from '../platform/src/lib/design/render.ts';
import { blocking } from '../platform/src/lib/design/review.ts';
import { profileFromRow } from '../platform/src/lib/company-profile-model.ts';
import { changedSlides, flatSlide, putSlide, slideDiffs, slideSummary, slidesOf } from '../platform/src/lib/design/slide-edit.ts';
import { slideLayouts } from '../platform/src/lib/design/carousel.ts';
import { parseEditBody, parseFormatBody } from '../platform/src/lib/design/edit-model.ts';
import { fieldKeys } from '../platform/src/lib/design-edit-events.ts';

const FONT_DIR = join(import.meta.dirname, '../platform/fonts');
const slide = (title, extra = {}) => ({ texts: { title, ...extra } });
const json = (slides, over = {}) => ({ kind: 'informativo', angle: 'três sinais', slides, caption: 'Bolo bom não tem pressa. Chame no WhatsApp.', hashtags: ['bolo'], alt_text: 'Carrossel sobre bolo.', ...over });
const FIVE = [
  { role: 'cover', texts: { kicker: 'Dica da casa', title: 'Seu bolo está pronto?', sub: 'Três sinais, sem abrir o forno' } },
  slide('A massa desgruda da borda', { sub: 'Passe a ponta de uma faca.' }),
  slide('O palito sai limpo'),
  slide('O topo volta ao toque'),
  slide('Quer um bolo assim?', { sub: 'Chame a gente no WhatsApp.', kicker: 'não deve ficar' }),
];

const profile = profileFromRow({ niche: 'Alimentação', offering: 'Bolos', audience: 'Famílias', voice_formal: 3, voice_technical: 3, voice_serious: 3, banned_words: [], differentiators: [], pains: [] });
const brand = brandFromProfile({ colorPrimary: '#B83262', colorAccent: '#F2A9C4', fontHeading: 'Playfair Display', fontBody: 'Inter', instagramHandle: 'doceponto' });

describe('contrato das lâminas', () => {
  it('com a quantidade pedida, só aceita exatamente essa (SPEC 025) e o prompt a exige', () => {
    expect(parseCopy(json(FIVE), null, 'carousel', 5).ok).toBe(true);
    expect(parseCopy(json(FIVE), null, 'carousel', 6)).toEqual({ ok: false, error: 'A pessoa pediu 6 lâminas, e vieram 5. Escreva exatamente 6.' });
    expect(parseCopy(json(FIVE), null, 'carousel', null).ok).toBe(true);
  });

  it('lê de 2 a 10 lâminas; o papel vem da posição, não do que o modelo escreveu', () => {
    const r = parseCopy(json(FIVE.map((s) => ({ ...s, role: 'content' }))), null, 'carousel');
    expect(r.ok).toBe(true);
    expect(r.value.slides.map((s) => s.role)).toEqual(['cover', 'content', 'content', 'content', 'cta']);
    expect(r.value.texts).toEqual(r.value.slides[0].texts);
    expect(r.value.texts.sub).toBe('Três sinais, sem abrir o forno');
  });

  it('a chamada não leva selo e item solto não existe na lâmina', () => {
    const r = parseCopy(json([...FIVE.slice(0, 4), { ...FIVE[4], texts: { ...FIVE[4].texts, items: ['x', 'y'] } }]), null, 'carousel');
    expect(r.value.slides[4].texts).toEqual({ title: 'Quer um bolo assim?', sub: 'Chame a gente no WhatsApp.' });
  });

  it('recusa fora da faixa e lâmina sem título, com o motivo que volta ao modelo', () => {
    expect(parseCopy(json([FIVE[0]]), null, 'carousel')).toEqual({ ok: false, error: 'O carrossel precisa de 2 a 10 lâminas, e vieram 1.' });
    expect(parseCopy(json([...FIVE, ...FIVE, ...FIVE.slice(0, 1)]), null, 'carousel').error).toMatch(/e vieram 11/);
    // dez lâminas (o teto do Instagram) passam
    expect(parseCopy(json([...FIVE, ...FIVE]), null, 'carousel').ok).toBe(true);
    expect(parseCopy(json([FIVE[0], slide('   ')]), null, 'carousel').error).toBe('A lâmina 2 veio sem título.');
    expect(parseCopy(json(undefined), null, 'carousel').ok).toBe(false);
    expect(parseCopy(json('x'), null, 'carousel').ok).toBe(false);
  });

  it('duas lâminas são capa e chamada; o limite de 64 caracteres vale por lâmina', () => {
    const r = parseCopy(json([slide('a'.repeat(100)), slide('Chame no WhatsApp')]), null, 'carousel');
    expect(r.value.slides.map((s) => s.role)).toEqual(['cover', 'cta']);
    expect(r.value.slides[0].texts.title).toHaveLength(64);
  });

  it('sem pedir carrossel, o texto de uma imagem segue como era', () => {
    const r = parseCopy({ kind: 'informativo', texts: { title: 'Oi', items: ['a', 'b'] }, caption: 'x', hashtags: [] }, null);
    expect(r.value.slides).toBeUndefined();
    expect(r.value.texts.items).toEqual(['a', 'b']);
  });

  it('o texto da imagem de revisão junta todas as lâminas', () => {
    const copy = parseCopy(json(FIVE), null, 'carousel').value;
    expect(imageTextsOf(copy)).toContain('O palito sai limpo');
    expect(imageTextsOf(copy)).toHaveLength(9);
  });

  it('a volta do revisor só na legenda mantém as lâminas como estavam', () => {
    const previous = parseCopy(json(FIVE), null, 'carousel').value;
    const next = parseCopy(json(FIVE.map((s) => ({ ...s, texts: { ...s.texts, title: 'outro' } })), { caption: 'nova legenda' }), null, 'carousel').value;
    const kept = keepWhatPassed(previous, next, [{ rule: 'banned_word', detail: 'x', message: 'x', where: 'caption' }]);
    expect(kept.slides).toEqual(previous.slides);
    expect(kept.caption).toBe('nova legenda');
  });
});

describe('prompt', () => {
  const input = { idea: 'três sinais de bolo pronto', kind: null, profile, facts: [], never: [], rules: [] };
  it('pede as lâminas só no carrossel', () => {
    const carousel = buildCopyPrompt({ ...input, format: 'carousel' });
    expect(carousel).toContain('CARROSSEL');
    expect(carousel).toContain('UMA foto só, para a capa');
    expect(carousel).toContain('"slides":[');
    expect(carousel).not.toContain('"texts":{"kicker":"...","title":"...","sub":"...","items"');
    const single = buildCopyPrompt(input);
    expect(single).not.toContain('CARROSSEL');
    expect(single).not.toContain('UMA foto só, para a capa');
    expect(single).toContain('"items":["...","..."]');
  });

  it('com a quantidade escolhida, o prompt pede exatamente essa; sem ela, a faixa de 2 a 10', () => {
    expect(buildCopyPrompt({ ...input, format: 'carousel', slideCount: 7 })).toContain('EXATAMENTE 7 lâminas');
    expect(buildCopyPrompt({ ...input, format: 'carousel' })).toContain('de 2 a 10 lâminas');
  });
});

describe('regras entre lâminas', () => {
  it('capa com mais de 12 palavras trava e diz a lâmina', () => {
    const issues = reviewSlides([slide('um dois três quatro cinco seis sete oito nove dez onze doze treze'), slide('fim')]);
    expect(issues).toMatchObject([{ rule: 'cover_long', message: expect.stringContaining('Lâmina 1') }]);
    expect(reviewSlides([slide('Seu bolo está pronto?'), slide('fim')])).toEqual([]);
  });

  it('título repetido (sem acento e caixa) trava na lâmina que repete', () => {
    const issues = reviewSlides([slide('Capa'), slide('O palito sai limpo'), slide('o palito SAI limpo!'), slide('Fim')]);
    expect(issues).toMatchObject([{ rule: 'slide_duplicate', message: 'Lâmina 3: repete o título da lâmina 2. Cada lâmina diz uma coisa.' }]);
    expect(blocking(issues)).toHaveLength(1);
  });

  it('achado de texto aponta a lâmina onde o trecho está', () => {
    const slides = [slide('Capa'), slide('Solução rápida'), slide('Fim')];
    const issue = { rule: 'accent', detail: 'solucao', message: '"solucao" parece estar sem acento.', where: 'image' };
    expect(inSlide({ ...issue, detail: 'solução' }, slides).message).toMatch(/^Lâmina 2: /);
    expect(inSlide(issue, slides).message).toBe(issue.message);
    expect(inSlide({ ...issue, where: 'caption', detail: 'solução' }, slides).message).toBe(issue.message);
  });
});

describe('lâminas desenhadas', () => {
  const common = { kind: 'informativo', ratio: '4:5', brand, logo: null };
  const slides = parseCopy(json(FIVE), null, 'carousel').value.slides;

  it('a família de cada papel e a posição de cada lâmina', () => {
    expect(layoutForRole('cover', 'informativo', false)).toBe('titulo-destaque');
    expect(layoutForRole('cover', 'atmosfera', true)).toBe('foto-titulo');
    expect(layoutForRole('cover', 'atmosfera', false)).toBe('titulo-destaque');
    expect(layoutForRole('content', 'atmosfera', true)).toBe('lamina-item');
    expect(layoutForRole('cta', 'informativo', false)).toBe('titulo-destaque');
    const specs = slideSpecs(slides, common);
    expect(specs.map((s) => s.layout)).toEqual(['titulo-destaque', 'lamina-item', 'lamina-item', 'lamina-item', 'titulo-destaque']);
    expect(specs.map((s) => s.slide)).toEqual([
      { n: 1, of: 5 },
      { n: 2, of: 5, item: 1, items: 3 },
      { n: 3, of: 5, item: 2, items: 3 },
      { n: 4, of: 5, item: 3, items: 3 },
      { n: 5, of: 5 },
    ]);
  });

  it('só a capa leva o visual', () => {
    const specs = slideSpecs(slides, { ...common, kind: 'atmosfera', visual: { dataUri: 'data:image/png;base64,AAAA' } });
    expect(specs.map((s) => !!s.visual)).toEqual([true, false, false, false, false]);
    expect(specs[0].layout).toBe('foto-titulo');
  });

  it('o design guarda papel, layout, texto e chave de cada lâmina', () => {
    const specs = slideSpecs(slides, common);
    const stored = storedSlides(specs, slides.map((s) => s.role), ['a', 'b', 'c', 'd', 'e']);
    expect(stored[1]).toEqual({ role: 'content', layout: 'lamina-item', texts: slides[1].texts, pngKey: 'b' });
    expect(stored).toHaveLength(5);
  });

  it('desenha todas as lâminas em 1080 de largura, sem aviso que trava, nos dois formatos', () => {
    for (const ratio of ['4:5', '1:1']) {
      for (const spec of slideSpecs(slides, { ...common, ratio })) {
        const r = renderPng(spec, { fontDir: FONT_DIR });
        expect(r.png.subarray(1, 4).toString()).toBe('PNG');
        expect(r.width).toBe(1080);
        expect(r.height).toBe(ratio === '4:5' ? 1350 : 1080);
        expect(blocking(r.issues), `${spec.layout} ${ratio}`).toEqual([]);
      }
    }
  });

  it('título e subtítulo nos limites cabem na lâmina de item; passando do limite o revisor avisa', () => {
    const long = slideSpecs([{ role: 'cover', texts: { title: 'Capa' } }, { role: 'content', texts: { title: 'Guarde o bolo recheado na geladeira por até dois dias inteiros'.slice(0, 64), sub: 'Tampe bem, deixe longe do sol e tire da geladeira meia hora antes de servir.'.padEnd(100, ' mais um pouco').slice(0, 100) } }, { role: 'cta', texts: { title: 'Fim' } }], common)[1];
    expect(blocking(renderPng(long, { fontDir: FONT_DIR }).issues)).toEqual([]);
    const huge = { ...long, texts: { title: 'palavra '.repeat(40), sub: 'texto '.repeat(60) } };
    expect(renderPng(huge, { fontDir: FONT_DIR }).issues.some((i) => i.rule === 'text_too_long')).toBe(true);
  });

  it('o mesmo spec gera o mesmo PNG', () => {
    const spec = slideSpecs(slides, common)[1];
    expect(renderPng(spec, { fontDir: FONT_DIR }).png.equals(renderPng(spec, { fontDir: FONT_DIR }).png)).toBe(true);
  });
});

describe('modelo', () => {
  it('papel e posição', () => {
    expect([0, 1, 2, 3].map((i) => roleAt(i, 4))).toEqual(['cover', 'content', 'content', 'cta']);
    expect(slidePositions(['cover', 'cta'])).toEqual([{ n: 1, of: 2 }, { n: 2, of: 2 }]);
  });

  it('lamina-item é layout válido, e só aparece como opção para quem já está nele', () => {
    expect(isLayout('lamina-item')).toBe(true);
    expect(compatibleLayouts('informativo', { title: 'x' }, false)).toEqual(['titulo-destaque']);
    expect(compatibleLayouts('informativo', { title: 'x' }, false, 'lamina-item')).toEqual(['titulo-destaque', 'lamina-item']);
  });
});

describe('ajuste por lâmina (puro)', () => {
  const slide = (role, layout, title, extra = {}) => ({ role, layout, texts: { title }, pngKey: `k-${title}`, ...extra });
  const design = {
    layout: 'titulo-destaque',
    texts: { title: 'Capa' },
    rules: ['r1'],
    slides: [slide('cover', 'titulo-destaque', 'Capa'), slide('content', 'lamina-item', 'Item um', { logoCorner: 'br' }), slide('cta', 'titulo-destaque', 'Fim')],
  };
  const ctx = { kind: 'informativo', layout: 'titulo-destaque', ratio: '4:5', goal: null };

  it('a lâmina vira um design plano que o painel já entende; o resto do design fica', () => {
    const flat = flatSlide(design, 1);
    expect(flat).toMatchObject({ layout: 'lamina-item', texts: { title: 'Item um' }, logoCorner: 'br', rules: ['r1'] });
    expect(flat.slides).toBeUndefined();
    expect(flatSlide({ layout: 'titulo-destaque', texts: { title: 'x' } }, 0)).toEqual({ layout: 'titulo-destaque', texts: { title: 'x' } });
    expect(slidesOf(design)).toHaveLength(3);
    expect(slidesOf({ layout: 'titulo-destaque', texts: { title: 'x' } })).toBeNull();
  });

  it('voltar ao carrossel troca só a lâmina e guarda a chave do PNG; a capa acompanha o nível de cima', () => {
    const next = putSlide(design, 1, { ...flatSlide(design, 1), texts: { title: 'Item dois' }, logoHidden: true });
    expect(next.slides[1]).toEqual({ role: 'content', layout: 'lamina-item', texts: { title: 'Item dois' }, pngKey: 'k-Item um', logoCorner: 'br', logoHidden: true });
    expect(next.slides[0]).toBe(design.slides[0]);
    expect(next.texts).toEqual({ title: 'Capa' });
    const cover = putSlide(design, 0, { ...flatSlide(design, 0), texts: { title: 'Capa nova' }, colors: { title: '#112233' } });
    expect(cover.texts).toEqual({ title: 'Capa nova' });
    expect(cover.colors).toEqual({ title: '#112233' });
    expect(cover.slides[0].colors).toEqual({ title: '#112233' });
    expect(cover.rules).toEqual(['r1']);
    expect(putSlide(design, 7, flatSlide(design, 0))).toBe(design);
  });

  it('acha as lâminas que mudaram sem contar a chave do PNG', () => {
    const same = { ...design, slides: design.slides.map((s) => ({ ...s, pngKey: 'outra' })) };
    expect(changedSlides(design, same)).toEqual([]);
    const edited = putSlide(design, 2, { ...flatSlide(design, 2), texts: { title: 'Fim de novo' } });
    expect(changedSlides(design, edited)).toEqual([2]);
    expect(changedSlides(design, { ...design, slides: design.slides.slice(0, 2) })).toEqual([2]);
  });

  it('o diff leva a lâmina no campo e o resumo diz qual', () => {
    const edited = putSlide(design, 1, { ...flatSlide(design, 1), texts: { title: 'Item dois' }, layout: 'titulo-destaque' });
    expect(slideDiffs(design, edited, [1], ctx).map((d) => d.field)).toEqual(['layout', 'texts.title', 'logoCorner'].map((f) => `slides.1.${f}`).filter((f) => f !== 'slides.1.logoCorner'));
    expect(slideSummary(design, edited, [1], ctx)).toBe('Lâmina 2: 2 ajustes: layout trocado para título em destaque, título alterado');
    expect(slideSummary(design, edited, [0, 1], ctx)).toBe('2 lâminas ajustadas (1, 2)');
    expect(fieldKeys(slideDiffs(design, edited, [1], ctx))).toBe('layout,title');
  });

  it('os layouts de cada papel', () => {
    expect(slideLayouts('cover', 'informativo', false)).toEqual(['titulo-destaque']);
    expect(slideLayouts('cover', 'atmosfera', true)).toEqual(['foto-titulo', 'titulo-destaque']);
    expect(slideLayouts('content', 'informativo', false)).toEqual(['lamina-item', 'titulo-destaque']);
    expect(slideLayouts('cta', 'atmosfera', true)).toEqual(['titulo-destaque']);
  });

  it('o corpo do ajuste aceita a lâmina de 0 a 9 e recusa o resto', () => {
    const body = (slide) => ({ baseVersion: 1, design: { layout: 'titulo-destaque', texts: { title: 'x' } }, ...(slide === undefined ? {} : { slide }) });
    expect(parseEditBody(body(3)).value.slide).toBe(3);
    expect(parseEditBody(body(0)).value.slide).toBe(0);
    expect(parseEditBody(body()).value.slide).toBeUndefined();
    for (const bad of [-1, 10, 1.5, '2']) expect(parseEditBody(body(bad))).toMatchObject({ ok: false, field: 'slide' });
  });
});

describe('trocar de formato (corpo)', () => {
  it('pede a versão de partida e o formato de destino', () => {
    expect(parseFormatBody({ baseVersion: 2, to: 'single' })).toEqual({ ok: true, value: { baseVersion: 2, to: 'single' } });
    expect(parseFormatBody({ baseVersion: '3', to: 'carousel' }).value).toEqual({ baseVersion: 3, to: 'carousel' });
    expect(parseFormatBody({ baseVersion: 2, to: 'video' })).toMatchObject({ ok: false, field: 'to' });
    expect(parseFormatBody({ to: 'single' })).toMatchObject({ ok: false, field: 'baseVersion' });
    expect(parseFormatBody('x').ok).toBe(false);
  });
});
