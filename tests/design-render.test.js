// O motor de render (SPEC 012 entrega 4, ADR 0017): o mesmo design dá o mesmo PNG, as três famílias
// saem no tamanho certo, o texto cabe e o revisor de layout aprova o caminho feliz. Os PNGs vão para
// /tmp/design-out para conferência visual.
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderPng, pngSize } from '../platform/src/lib/design/render.ts';
import { brandFromProfile, brandPhotoLayout, defaultLayout } from '../platform/src/lib/design/model.ts';
import { compose, FAMILIES_BY_KIND } from '../platform/src/lib/design/families.ts';

const FONT_DIR = join(import.meta.dirname, '../platform/fonts');
const OUT = '/tmp/design-out';
mkdirSync(OUT, { recursive: true });

const profile = { colorPrimary: '#B83262', colorAccent: '#F2A9C4', fontHeading: 'Playfair Display', fontBody: 'Inter', instagramHandle: '@doceponto' };
const brand = brandFromProfile(profile);
// Logo fictício: um círculo com as iniciais, em SVG embutido.
const logoSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="72" viewBox="0 0 160 72"><circle cx="36" cy="36" r="34" fill="#B83262"/><text x="36" y="46" font-size="28" text-anchor="middle" fill="#fff" font-family="sans-serif" font-weight="700">dp</text><text x="80" y="46" font-size="26" fill="#4A2C2A" font-family="serif" font-weight="700">doce</text></svg>`;
const logo = { dataUri: `data:image/svg+xml;base64,${Buffer.from(logoSvg).toString('base64')}`, width: 160, height: 72 };
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

const informativo = {
  kind: 'informativo', ratio: '4:5', layout: 'lista-numerada',
  texts: { kicker: 'Dica da Doce Ponto', title: 'Seu bolo está pronto?', sub: '3 sinais para conferir sem abrir o forno', items: ['A massa desgruda da borda', 'O palito sai limpo', 'O topo volta ao toque'] },
  brand, logo,
};
const destaque = { kind: 'informativo', ratio: '1:1', layout: 'titulo-destaque', texts: { kicker: 'Encomendas', title: 'Bolo de festa sem pressa: encomende com 3 dias', sub: 'A gente avisa quando sair do forno.' }, brand, logo };
const visualSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F1DCC9"/><stop offset="1" stop-color="#D4AE8D"/></linearGradient></defs><rect width="1080" height="1350" fill="url(#g)"/><ellipse cx="540" cy="900" rx="300" ry="90" fill="#FFF8EE"/></svg>`;
const atmosfera = { kind: 'atmosfera', ratio: '4:5', layout: 'foto-titulo', texts: { kicker: 'Quarta-feira de massa na mão', title: 'Bolo bom não tem pressa' }, brand, logo, visual: { dataUri: `data:image/svg+xml;base64,${Buffer.from(visualSvg).toString('base64')}` } };

describe('render', () => {
  it('as três famílias saem no tamanho do Instagram e sem achado de layout', () => {
    for (const [name, spec] of [['lista', informativo], ['destaque', destaque], ['foto', atmosfera]]) {
      const out = renderPng(spec, { fontDir: FONT_DIR });
      writeFileSync(join(OUT, `${name}.png`), out.png);
      writeFileSync(join(OUT, `${name}.svg`), out.svg);
      expect(pngSize(out.png), name).toEqual({ width: 1080, height: spec.ratio === '1:1' ? 1080 : 1350 });
      expect(out.issues, `${name}: ${JSON.stringify(out.issues)}`).toEqual([]);
      expect(out.overflow).toEqual([]);
    }
  });

  it('o mesmo design gera o mesmo PNG; mudar o texto muda o PNG', () => {
    const a = renderPng(informativo, { fontDir: FONT_DIR }).png;
    const b = renderPng(informativo, { fontDir: FONT_DIR }).png;
    expect(sha(a)).toBe(sha(b));
    const c = renderPng({ ...informativo, texts: { ...informativo.texts, title: 'Outro título' } }, { fontDir: FONT_DIR }).png;
    expect(sha(c)).not.toBe(sha(a));
  });

  it('todo texto fica dentro da margem e acima do tamanho mínimo, em 1:1 e 4:5', () => {
    for (const ratio of ['1:1', '4:5']) {
      for (const spec of [informativo, destaque, atmosfera]) {
        const c = compose({ ...spec, ratio });
        for (const box of c.boxes) {
          expect(box.x, box.id).toBeGreaterThanOrEqual(64);
          expect(box.x + box.w, box.id).toBeLessThanOrEqual(1080 - 64);
          expect(box.y, box.id).toBeGreaterThanOrEqual(64);
          expect(box.y + box.h, `${spec.layout} ${ratio} ${box.id}`).toBeLessThanOrEqual(c.height - 64);
        }
      }
    }
  });

  it('título longo demais encolhe até o mínimo e, se não couber, vira motivo de recusa', () => {
    const long = { ...informativo, texts: { ...informativo.texts, title: 'Um título enorme que fala de muitas coisas ao mesmo tempo e não cabe em três linhas de jeito nenhum mesmo' } };
    const out = renderPng(long, { fontDir: FONT_DIR });
    const title = out.boxes.find((b) => b.id === 'title');
    expect(title.size).toBe(56);
    expect(out.issues.map((i) => i.rule)).toContain('text_too_long');
  });

  it('sem logo e sem @, o post sai sem a zona de assinatura; sem visual, a atmosfera usa a cor profunda', () => {
    const plain = brandFromProfile({ colorPrimary: null, colorAccent: null, fontHeading: null, fontBody: null, instagramHandle: null });
    expect(plain).toMatchObject({ primary: '#1F2937', fontHeading: 'Sora', fontBody: 'Inter', handle: null });
    const out = renderPng({ ...atmosfera, brand: plain, logo: null, visual: null }, { fontDir: FONT_DIR });
    writeFileSync(join(OUT, 'foto-sem-visual.png'), out.png);
    expect(out.boxes.map((b) => b.id)).toEqual(['title', 'kicker']);
    expect(out.issues).toEqual([]);
  });

  it('escolhe a família pelo tipo e pelo texto', () => {
    expect(defaultLayout('atmosfera', { title: 'x' })).toBe('foto-titulo');
    expect(defaultLayout('informativo', { title: 'x', items: ['a', 'b'] })).toBe('lista-numerada');
    expect(defaultLayout('informativo', { title: 'x' })).toBe('titulo-destaque');
  });

  // BEZ-251: a foto da pessoa dentro do layout da marca. O texto fica sobre a cor da marca, então
  // foto clara ou escura não muda o contraste; as duas famílias saem diferentes do "de fundo".
  describe('foto no layout da marca (Janela e Arco)', () => {
    const photoSvg = (top, bottom) => `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350"><defs><linearGradient id="p" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient></defs><rect width="1080" height="1350" fill="url(#p)"/><rect x="380" y="420" width="320" height="420" rx="40" fill="#FFFFFF" opacity="0.8"/><circle cx="760" cy="760" r="90" fill="#B83262"/></svg>`;
    const photos = { clara: photoSvg('#F6D9C4', '#FBF1EC'), escura: photoSvg('#2A1A19', '#6B3A22') };
    const base = { kind: 'atmosfera', texts: { kicker: 'Casamentos em Marília', title: 'Mesas de doces para o seu casamento' }, brand, logo };

    it('Janela e Arco saem no tamanho certo, sem achado do revisor, com foto clara e escura', () => {
      for (const layout of ['foto-janela', 'foto-arco']) {
        for (const ratio of ['4:5', '1:1']) {
          for (const [tone, svg] of Object.entries(photos)) {
            const spec = { ...base, layout, ratio, visual: { dataUri: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}` } };
            const out = renderPng(spec, { fontDir: FONT_DIR });
            writeFileSync(join(OUT, `${layout}-${ratio.replace(':', 'x')}-${tone}.png`), out.png);
            expect(pngSize(out.png)).toEqual({ width: 1080, height: ratio === '1:1' ? 1080 : 1350 });
            expect(out.issues, `${layout} ${ratio} ${tone}: ${JSON.stringify(out.issues)}`).toEqual([]);
            expect(out.overflow).toEqual([]);
            for (const box of out.boxes) {
              expect(box.x, box.id).toBeGreaterThanOrEqual(64);
              expect(box.x + box.w, box.id).toBeLessThanOrEqual(1080 - 64);
              expect(box.y + box.h, `${layout} ${ratio} ${box.id}`).toBeLessThanOrEqual(out.height - 64);
            }
          }
        }
      }
    });

    it('o texto não depende da foto: a mesma caixa de título com foto clara e escura', () => {
      for (const layout of ['foto-janela', 'foto-arco']) {
        const boxesFor = (svg) => compose({ ...base, layout, ratio: '4:5', visual: { dataUri: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}` } }).boxes;
        expect(boxesFor(photos.clara)).toEqual(boxesFor(photos.escura));
      }
    });

    it('fica diferente do "de fundo" e sem foto usa um tom da marca', () => {
      const visual = { dataUri: `data:image/svg+xml;base64,${Buffer.from(photos.clara).toString('base64')}` };
      const fundo = sha(renderPng({ ...base, layout: 'foto-titulo', ratio: '4:5', visual }, { fontDir: FONT_DIR }).png);
      for (const layout of ['foto-janela', 'foto-arco']) {
        expect(sha(renderPng({ ...base, layout, ratio: '4:5', visual }, { fontDir: FONT_DIR }).png)).not.toBe(fundo);
        expect(renderPng({ ...base, layout, ratio: '4:5', visual: null }, { fontDir: FONT_DIR }).issues).toEqual([]);
      }
    });

    it('Janela por padrão; cada outra direção alterna com o Arco; as duas estão no catálogo da atmosfera', () => {
      expect([1, 2, 3, 4].map(brandPhotoLayout)).toEqual(['foto-janela', 'foto-arco', 'foto-janela', 'foto-arco']);
      expect(FAMILIES_BY_KIND.atmosfera).toEqual(['foto-titulo', 'foto-janela', 'foto-arco']);
    });
  });
});
