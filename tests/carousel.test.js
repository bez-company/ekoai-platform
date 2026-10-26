// Carrossel (SPEC 023, ADR 0025), a parte pura: o contrato do redator (2 a 6 lâminas, papel pela posição), o prompt,
// as regras entre lâminas, os specs de cada lâmina e o render da família lamina-item nos extremos de texto.
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { buildCopyPrompt, imageTextsOf, keepWhatPassed, parseCopy } from '../platform/src/lib/agents.ts';
import { inSlide, layoutForRole, reviewSlides, slideSpecs, storedSlides } from '../platform/src/lib/design/carousel.ts';
import { brandFromProfile, compatibleLayouts, isLayout, roleAt, slidePositions } from '../platform/src/lib/design/model.ts';
import { renderPng } from '../platform/src/lib/design/render.ts';
import { blocking } from '../platform/src/lib/design/review.ts';
import { profileFromRow } from '../platform/src/lib/company-profile-model.ts';

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
  it('lê de 2 a 6 lâminas; o papel vem da posição, não do que o modelo escreveu', () => {
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
    expect(parseCopy(json([FIVE[0]]), null, 'carousel')).toEqual({ ok: false, error: 'O carrossel precisa de 2 a 6 lâminas, e vieram 1.' });
    expect(parseCopy(json([...FIVE, ...FIVE.slice(1, 3)]), null, 'carousel').error).toMatch(/e vieram 7/);
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
    expect(carousel).toContain('"slides":[');
    expect(carousel).not.toContain('"texts":{"kicker":"...","title":"...","sub":"...","items"');
    const single = buildCopyPrompt(input);
    expect(single).not.toContain('CARROSSEL');
    expect(single).toContain('"items":["...","..."]');
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
