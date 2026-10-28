// Studio livre (SPEC 027): a cena é o layout em camadas. Abrir o layout numa cena e desenhar a cena sem mexer em nada dá o mesmo post
// (em todas as famílias), a logo entra sem placa, e o corpo que volta da tela é validado na fronteira.
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { compose } from '../platform/src/lib/design/families.ts';
import { brandFromProfile } from '../platform/src/lib/design/model.ts';
import { renderPng } from '../platform/src/lib/design/render.ts';
import { openScene, sceneContext } from '../platform/src/lib/design/scene-render.ts';
import { layerHeight, layerLines, parseScene, sceneBoxes, sceneSvg, sceneTexts } from '../platform/src/lib/design/scene.ts';
import { fontDir, fontFilesFor } from '../platform/src/lib/design/fonts.ts';
import { COMPANIES } from '../evals/cases.js';

const { Resvg } = createRequire(new URL('../platform/package.json', import.meta.url))('@resvg/resvg-js');
const FONT_DIR = join(import.meta.dirname, '../platform/fonts');
const svgUri = (s) => `data:image/svg+xml;base64,${Buffer.from(s).toString('base64')}`;
const photo = { dataUri: svgUri('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="500"><rect width="400" height="500" fill="#7a5a3a"/><circle cx="200" cy="200" r="120" fill="#e8c890"/></svg>') };
const c = COMPANIES.aurora;
const base = { kind: 'informativo', ratio: '4:5', brand: brandFromProfile(c.profile), logo: c.logo, visual: null };
const SPECS = {
  'titulo-destaque': { ...base, layout: 'titulo-destaque', texts: { kicker: 'Dica da casa', title: 'Seu bolo está pronto? Três sinais para conferir', sub: 'Sem abrir o forno.' } },
  'lista-numerada': { ...base, layout: 'lista-numerada', texts: { kicker: 'Passo a passo', title: 'Como saber se o bolo assou', items: ['A massa desgruda da borda', 'O palito sai limpo', 'O topo volta ao toque'] } },
  'foto-titulo': { ...base, kind: 'atmosfera', layout: 'foto-titulo', visual: photo, texts: { kicker: 'Bastidores', title: 'A fornada das sete' } },
  'foto-janela': { ...base, kind: 'atmosfera', layout: 'foto-janela', visual: photo, texts: { kicker: 'Bastidores', title: 'A fornada das sete' } },
  marca: { ...base, layout: 'marca', background: 'dark', texts: { title: '' }, brandName: 'Casa Aurora', placements: { logo: 'c', name: 'bc', handle: 'br' } },
  'lamina-item': { ...base, layout: 'lamina-item', look: 'titulo-destaque', slide: { n: 2, of: 4, item: 1, items: 2 }, texts: { title: 'A massa desgruda da borda', sub: 'Passe a ponta de uma faca.' } },
};

const raster = (svg) => new Resvg(svg, { font: { fontFiles: fontFilesFor(['Inter', 'Sora', 'Playfair Display', 'Poppins', 'Montserrat', 'Lato'], FONT_DIR), loadSystemFonts: false, defaultFontFamily: 'Inter' } }).render().pixels;
// Fração de pixels que mudou mais que o ruído de antialiasing.
const diff = (a, b) => {
  let bad = 0;
  for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 60) bad += 1;
  return bad / (a.length / 4);
};

describe('abrir o layout numa cena', () => {
  for (const [name, spec] of Object.entries(SPECS)) {
    it(`${name}: a cena sem mexer desenha o mesmo post`, () => {
      const { scene, ctx } = openScene(spec);
      expect(scene.layers.length, name).toBeGreaterThan(0);
      expect(diff(raster(compose(spec).svg), raster(sceneSvg(scene, ctx))), name).toBeLessThan(0.0002);
    });
  }

  it('cada texto vira uma camada com o papel e o fundo que o revisor usa; a logo vira camada própria', () => {
    const { scene } = openScene(SPECS['titulo-destaque']);
    const by = (role) => scene.layers.find((l) => l.type === 'text' && l.role === role);
    expect(by('title')).toMatchObject({ name: 'Título', bold: true });
    expect(by('title').lines.length).toBeGreaterThan(1);
    expect(by('kicker').name).toBe('Selo');
    expect(by('handle').text).toBe('@casaaurora');
    expect(scene.layers.find((l) => l.type === 'logo')).toMatchObject({ variant: 'main', name: 'Logo' });
  });

  it('o logo entra exatamente como foi enviado: o desenho não tem placa nem moldura', () => {
    const { scene, ctx } = openScene(SPECS['foto-titulo']);
    const svg = sceneSvg(scene, ctx);
    expect(svg).not.toMatch(/<rect [^>]*rx="18"/);
    expect(svg).toContain(c.logo.dataUri);
  });

  it('o PNG do render com cena é o do servidor, e o revisor confere as caixas das camadas', () => {
    const spec = SPECS['titulo-destaque'];
    const { scene } = openScene(spec);
    const plain = renderPng(spec, { fontDir: FONT_DIR });
    const withScene = renderPng({ ...spec, scene }, { fontDir: FONT_DIR });
    expect(withScene.png.subarray(1, 4).toString()).toBe('PNG');
    expect(withScene.issues).toEqual(plain.issues);
    // Empurrar o título para fora da margem vira achado do revisor.
    const out = { ...scene, layers: scene.layers.map((l) => (l.role === 'title' ? { ...l, x: -40 } : l)) };
    expect(renderPng({ ...spec, scene: out }, { fontDir: FONT_DIR }).issues.some((i) => i.rule === 'safe_margin')).toBe(true);
  });
});

describe('edição na cena', () => {
  it('texto editado quebra pela conta do motor e as linhas guardadas saem do caminho', () => {
    const { scene } = openScene(SPECS['titulo-destaque']);
    const title = scene.layers.find((l) => l.role === 'title');
    const edited = { ...title, text: 'Um título novo e bem mais comprido que o antigo', lines: undefined };
    expect(layerLines(edited).length).toBeGreaterThan(1);
    expect(layerHeight(edited)).toBeGreaterThan(title.size);
    expect(layerLines({ ...edited, w: 4000 })).toHaveLength(1);
  });

  it('linhas guardadas que não são mais o texto da camada nunca são desenhadas', () => {
    const { scene } = openScene(SPECS['titulo-destaque']);
    const title = scene.layers.find((l) => l.role === 'title');
    expect(layerLines(title)).toEqual(title.lines);
    expect(layerLines({ ...title, text: 'Outro texto' })).toEqual(['Outro texto']);
  });

  it('sceneBoxes dá um id por camada de texto e esconde o que está oculto', () => {
    const { scene } = openScene(SPECS['lista-numerada']);
    const hidden = { ...scene, layers: scene.layers.map((l, i) => (i === 0 ? { ...l, hidden: true } : l)) };
    expect(sceneBoxes(hidden).length).toBe(sceneBoxes(scene).length - 1);
    expect(new Set(sceneBoxes(scene).map((b) => b.id)).size).toBe(sceneBoxes(scene).length);
  });
});

describe('validação da cena na fronteira', () => {
  const limits = { width: 1080, height: 1350 };
  const good = () => JSON.parse(JSON.stringify(openScene(SPECS['titulo-destaque']).scene));
  it('aceita a cena que a Ekoai abre', () => {
    expect(parseScene(good(), limits).ok).toBe(true);
  });
  it('recusa formato errado, id repetido, fonte fora da lista, número fora do limite e camadas demais', () => {
    expect(parseScene(null, limits).ok).toBe(false);
    expect(parseScene({ ...good(), v: 2 }, limits).ok).toBe(false);
    const dup = good(); dup.layers[1].id = dup.layers[0].id;
    expect(parseScene(dup, limits)).toMatchObject({ ok: false, field: 'scene.layers.1.id' });
    const font = good(); font.layers[0].font = 'Comic Sans';
    expect(parseScene(font, limits)).toMatchObject({ ok: false, field: 'scene.layers.0.font' });
    const far = good(); far.layers[0].x = 1e9;
    expect(parseScene(far, limits).ok).toBe(false);
    const many = good(); many.layers = Array.from({ length: 61 }, (_, i) => ({ ...many.layers[0], id: `l${i}` }));
    expect(parseScene(many, limits).ok).toBe(false);
    const type = good(); type.layers[0].type = 'script';
    expect(parseScene(type, limits).ok).toBe(false);
  });
  it('limpa o texto: sem controle nem quebra de linha, e corta o que passa do limite', () => {
    const s = good(); s.layers[0].text = 'oi\u0007\nmundo';
    expect(parseScene(s, limits).value.layers[0].text).toBe('oi mundo');
    const big = good(); big.layers[0].text = 'a'.repeat(601);
    expect(parseScene(big, limits).ok).toBe(false);
  });
});

describe('o que o revisor de texto lê da cena (BEZ-338)', () => {
  it('a lâmina de item do carrossel não entrega o contador "N de M" nem o número do círculo ao revisor', () => {
    const { scene } = openScene(SPECS['lamina-item']);
    const all = scene.layers.filter((l) => l.type === 'text').map((l) => l.text);
    expect(all.some((t) => /^\d+ de \d+$/i.test(t.trim())), 'o selo da lâmina leva o contador').toBe(true);
    const read = sceneTexts(scene);
    expect(read.some((t) => /^\d+ de \d+$/i.test(t.trim()))).toBe(false);
    expect(read).toContain('A massa desgruda da borda');
  });

  it('só o texto inteiro no formato do contador sai: "3 de 4 clientes recomendam" continua sendo conferido', () => {
    const { scene } = openScene(SPECS['titulo-destaque']);
    const first = scene.layers.find((l) => l.type === 'text');
    const claim = { ...scene, layers: scene.layers.map((l) => (l === first ? { ...l, text: '3 de 4 clientes recomendam' } : l)) };
    expect(sceneTexts(claim)).toContain('3 de 4 clientes recomendam');
    const counter = { ...scene, layers: scene.layers.map((l) => (l === first ? { ...l, text: '3 DE 4' } : l)) };
    expect(sceneTexts(counter)).not.toContain('3 DE 4');
  });
});
