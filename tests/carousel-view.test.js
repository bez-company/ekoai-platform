// O carrossel em Aprovar (SPEC 023, BEZ-311): o que a tela lê da pendência, o selo da lista e o texto alternativo de
// cada lâmina; e o envio de cada lâmina à Meta com o texto alternativo dela.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { carouselBadge, carouselOf } from '../platform/src/lib/carousel-view.ts';
import { slideAltText } from '../platform/src/lib/design/carousel.ts';
import { publishCarousel } from '../platform/src/lib/channels/instagram.ts';

const images = (n) => Array.from({ length: n }, (_, i) => ({ id: i + 1, url: `https://app.test/api/media/images/${i}.png`, path: `images/${i}.png` }));
const pending = (over = {}) => ({
  generation: { variations: [{ id: 1, format: 'carousel' }] },
  images: images(5),
  seed: { slide_titles: ['Seu bolo está pronto?', 'A massa desgruda', 'O palito sai limpo', 'O topo volta ao toque', 'Quer um bolo assim?'], review: [] },
  ...over,
});

describe('o carrossel da pendência', () => {
  it('uma imagem por lâmina, o papel pela posição e o título de cada uma', () => {
    const view = carouselOf(pending());
    expect(view.slides.map((s) => s.role)).toEqual(['cover', 'content', 'content', 'content', 'cta']);
    expect(view.slides[1]).toMatchObject({ title: 'A massa desgruda', url: 'https://app.test/api/media/images/1.png', warning: null });
  });

  it('o aviso do revisor vai para a lâmina que ele nomeia, sem o prefixo', () => {
    const view = carouselOf(pending({ seed: { slide_titles: [], review: [{ rule: 'contrast', message: 'Lâmina 4: Contraste baixo no título (1,9:1).' }, { rule: 'accent', message: 'Sem lâmina nesta frase.' }, { rule: 'contrast', message: 'Lâmina 4: outra' }] } }));
    expect(view.slides.map((s) => s.warning)).toEqual([null, null, null, 'Contraste baixo no título (1,9:1).', null]);
    expect(view.slides[0].title).toBe('Lâmina 1');
  });

  it('post de uma imagem, ou sem as lâminas, não é carrossel', () => {
    expect(carouselOf(pending({ generation: { variations: [{ id: 1, format: 'single' }] } }))).toBeNull();
    expect(carouselOf(pending({ images: images(1) }))).toBeNull();
    expect(carouselOf({ generation: undefined, images: undefined, seed: undefined })).toBeNull();
    expect(carouselOf(pending({ images: [{ id: 1, url: null }, { id: 2, url: null }] }))).toBeNull();
  });

  it('o selo e o texto alternativo de cada lâmina', () => {
    expect(carouselBadge(5)).toBe('Carrossel · 5 lâminas');
    expect(slideAltText({ title: 'O palito sai limpo.', sub: 'Espete no centro.' }, 2, 5)).toBe('Lâmina 3 de 5: O palito sai limpo. Espete no centro.');
    expect(slideAltText({ title: 'Quer um bolo assim?' }, 4, 5)).toBe('Lâmina 5 de 5: Quer um bolo assim?');
  });
});

describe('publishCarousel', () => {
  const creds = { accountId: 'ig1', token: 'tok' };
  afterEach(() => vi.unstubAllGlobals());

  function stubGraph({ rejectAlt = false } = {}) {
    const posts = [];
    let n = 0;
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      const u = new URL(String(url));
      if (init?.method === 'POST') {
        const form = new URLSearchParams(String(init.body));
        posts.push({ path: u.pathname, form });
        if (rejectAlt && form.has('alt_text')) return { ok: false, status: 400, text: async () => 'alt_text' };
        return { ok: true, status: 200, json: async () => ({ id: u.pathname.endsWith('media_publish') ? 'post1' : `c${++n}` }) };
      }
      return { ok: true, status: 200, json: async () => ({ status_code: 'FINISHED' }) };
    }));
    return posts;
  }

  it('cada lâmina vira um container filho com o texto alternativo dela; o pai junta os filhos', async () => {
    const posts = stubGraph();
    const urls = ['https://m/a.png', 'https://m/b.png', 'https://m/c.png'];
    const out = await publishCarousel(creds, urls, 'legenda', {}, ['Lâmina 1 de 3: a', 'Lâmina 2 de 3: b', '']);
    const children = posts.filter((p) => p.form.get('is_carousel_item') === 'true');
    expect(children.map((p) => p.form.get('alt_text'))).toEqual(['Lâmina 1 de 3: a', 'Lâmina 2 de 3: b', null]);
    expect(children.map((p) => p.form.get('image_url'))).toEqual(urls);
    const parent = posts.find((p) => p.form.get('media_type') === 'CAROUSEL');
    expect(parent.form.get('children')).toBe('c1,c2,c3');
    expect(parent.form.get('caption')).toBe('legenda');
    expect(out).toMatchObject({ id: 'post1', slides: 3, alt_text: { sent: 2, dropped: 0 } });
  });

  it('a Meta recusa o texto alternativo: a lâmina sai sem ele e o resultado conta', async () => {
    const posts = stubGraph({ rejectAlt: true });
    const out = await publishCarousel(creds, ['https://m/a.png', 'https://m/b.png'], 'x', {}, ['alt a', 'alt b']);
    expect(out.alt_text).toEqual({ sent: 0, dropped: 2 });
    expect(posts.filter((p) => p.form.get('is_carousel_item') === 'true' && !p.form.has('alt_text'))).toHaveLength(2);
  });

  it('sem texto alternativo, o envio é o de antes; em ensaio para antes do media_publish', async () => {
    const posts = stubGraph();
    const out = await publishCarousel(creds, ['https://m/a.png', 'https://m/b.png'], 'x', { rehearsal: true });
    expect(out.alt_text).toEqual({ sent: 0, dropped: 0 });
    expect(out.rehearsal).toBe(true);
    expect(posts.some((p) => p.path.endsWith('media_publish'))).toBe(false);
  });

  it('recusa menos de 2 e mais de 10 lâminas', async () => {
    stubGraph();
    await expect(publishCarousel(creds, ['https://m/a.png'], 'x')).rejects.toThrow(/2\+/);
    await expect(publishCarousel(creds, Array.from({ length: 11 }, (_, i) => `https://m/${i}.png`), 'x')).rejects.toThrow(/10/);
  });
});
