// O renderizador do estúdio com um Chromium de verdade. Não custa nada (sem modelo), mas precisa de um Chrome: onde não houver
// (CI sem navegador), os testes são pulados. CHROME_PATH aponta para um binário fora dos lugares comuns.
import { describe, it, expect, afterAll } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromiumRenderer } from '../platform/src/lib/studio/chromium-renderer.ts';

const CANDIDATES = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].filter(Boolean);
const chrome = CANDIDATES.find((p) => existsSync(p));
const renderer = chrome ? chromiumRenderer({ executablePath: chrome, fontDir: join(import.meta.dirname, '../platform/fonts') }) : null;
afterAll(async () => renderer?.close());

const doc = (body) => `<!doctype html><html><body style="margin:0;width:1080px;height:1350px;position:relative;overflow:hidden;background:#222;font-family:Inter">${body}</body></html>`;
const png = (b) => ({ w: new DataView(b.buffer, b.byteOffset).getUint32(16), h: new DataView(b.buffer, b.byteOffset).getUint32(20) });
const rules = (r) => r.issues.map((i) => i.rule);
const base = { ratio: '4:5', assets: {}, logos: {} };

describe.skipIf(!renderer)('renderizador Chromium do estúdio', () => {
  it('desenha o PNG no tamanho do post, e quadrado em 1:1', async () => {
    const r = await renderer.render({ ...base, html: doc('<h1 style="position:absolute;left:96px;top:300px;font-size:120px;color:#fff;margin:0">Título</h1>') });
    expect(png(r.png)).toEqual({ w: 1080, h: 1350 });
    expect(rules(r)).toEqual([]);
    const sq = await renderer.render({ ...base, ratio: '1:1', html: doc('<h1 style="position:absolute;left:96px;top:300px;font-size:120px;color:#fff;margin:0">Título</h1>') });
    expect(png(sq.png)).toEqual({ w: 1080, h: 1080 });
  }, 60_000);

  it('mede texto fora da margem, miúdo e sobreposto', async () => {
    const r = await renderer.render({ ...base, html: doc('<p style="position:absolute;left:10px;top:600px;font-size:40px;color:#fff;margin:0">Colado na borda</p><p style="position:absolute;left:96px;top:200px;font-size:14px;color:#fff;margin:0">Miúdo demais para o celular</p><p style="position:absolute;left:96px;top:800px;font-size:90px;color:#fff;margin:0">Sobreposto</p><p style="position:absolute;left:96px;top:810px;font-size:90px;color:#fff;margin:0">Outro texto</p>') });
    expect(rules(r)).toEqual(expect.arrayContaining(['safe_margin', 'font_size', 'text_overlap']));
  }, 60_000);

  it('texto com pouco contraste contra o fundo reprova', async () => {
    const r = await renderer.render({ ...base, html: doc('<p style="position:absolute;left:96px;top:600px;font-size:60px;color:#2a2a2a;margin:0">Quase invisível aqui</p>') });
    expect(rules(r)).toContain('contrast_low');
  }, 60_000);

  it('o logo na versão errada para o fundo é apontado; a certa passa', async () => {
    const dark = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="100"><rect width="300" height="100" fill="#111"/></svg>').toString('base64');
    const light = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="100"><rect width="300" height="100" fill="#eee"/></svg>').toString('base64');
    const logos = { 'on-light': dark, 'on-dark': light };
    const wrong = await renderer.render({ ratio: '4:5', assets: {}, logos, html: doc('<img src="{{logo:on-light}}" style="position:absolute;left:96px;top:96px;width:300px;height:100px">') });
    expect(rules(wrong)).toContain('logo_contrast');
    const right = await renderer.render({ ratio: '4:5', assets: {}, logos, html: doc('<img src="{{logo:on-dark}}" style="position:absolute;left:96px;top:96px;width:300px;height:100px">') });
    expect(rules(right)).not.toContain('logo_contrast');
  }, 60_000);

  it('entrelinha apertada: a caixa de uma linha toca a da outra, mas se as letras não se tocam não é defeito', async () => {
    // Duas linhas grandes com line-height de 0.7: as caixas se cruzam, a tinta não (letras sem descendente na de cima e sem ascendente na de baixo).
    const tight = doc('<h1 style="position:absolute;left:96px;top:200px;margin:0;font:700 200px/0.7 Inter;color:#fff">Mas ox</h1><h1 style="position:absolute;left:96px;top:370px;margin:0;font:700 200px/0.7 Inter;color:#e8522f">aoao</h1>');
    expect(rules(await renderer.render({ ...base, html: tight }))).not.toContain('text_overlap');
  }, 60_000);

  it('letras que de fato se tocam são sobreposição', async () => {
    const stacked = doc('<h1 style="position:absolute;left:96px;top:300px;margin:0;font:700 200px/1 Inter;color:#fff">Mensagem</h1><h1 style="position:absolute;left:96px;top:330px;margin:0;font:700 200px/1 Inter;color:#e8522f">Mensagem</h1>');
    expect(rules(await renderer.render({ ...base, html: stacked }))).toContain('text_overlap');
  }, 60_000);

  it('texto que sangra de propósito (data-bleed) não é defeito; sem a marca, fora do quadro é', async () => {
    const big = (attr) => doc(`<b ${attr} style="position:absolute;left:600px;top:-120px;font-size:900px;line-height:1;color:#e8522f">1</b><p style="position:absolute;left:96px;top:900px;font-size:48px;color:#fff;margin:0">Linha de contexto</p>`);
    const marked = await renderer.render({ ...base, html: big('data-bleed') });
    expect(rules(marked)).not.toContain('off_canvas');
    expect(rules(marked)).not.toContain('safe_margin');
    const plain = await renderer.render({ ...base, html: big('') });
    expect(rules(plain)).toContain('off_canvas');
  }, 60_000);

  it('logo pequeno: o símbolo quadrado de 72 px passa; 40 px e o lockup baixo de 100x30 reprovam', async () => {
    const svg = (w, h) => 'data:image/svg+xml;base64,' + Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#eee"/></svg>`).toString('base64');
    const run = async (w, h) => renderer.render({ ratio: '4:5', assets: {}, logos: { 'on-light': svg(w, h), 'on-dark': svg(w, h) }, html: doc(`<img src="{{logo:on-dark}}" style="position:absolute;left:96px;top:96px;width:${w}px;height:${h}px">`) });
    expect(rules(await run(72, 72))).not.toContain('logo_small');
    expect(rules(await run(40, 40))).toContain('logo_small');
    expect(rules(await run(100, 30))).toContain('logo_small');
    expect(rules(await run(160, 56))).not.toContain('logo_small');
  }, 120_000);

  it('logo com quadrado de fundo: a cor do quadrado some e fica só o ícone, no fundo que o post tiver', async () => {
    const { KEY_LOGOS } = await import('../platform/src/lib/studio/browser-scripts.ts');
    const puppeteer = (await import('puppeteer-core')).default;
    const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      // Quadrado quase preto (#16171A) com um ícone branco, como a logo da Ekoai; o post tem outro fundo (#2A1B3D).
      const svg = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" fill="#16171A"/><circle cx="60" cy="60" r="28" fill="#FFFFFF"/></svg>').toString('base64');
      await page.setContent(`<body style="margin:0;background:#2A1B3D"><img data-logo src="${svg}" width="120" height="120"></body>`);
      const keyed = await page.evaluate(`${KEY_LOGOS}()`);
      expect(keyed).toBe(1);
      const alpha = await page.evaluate(`(() => { const img = document.querySelector('img'); const c = document.createElement('canvas'); c.width = 120; c.height = 120; const x = c.getContext('2d'); x.drawImage(img, 0, 0); const px = (a, b) => [...x.getImageData(a, b, 1, 1).data]; return { corner: px(3, 3), center: px(60, 60) }; })()`);
      expect(alpha.corner[3]).toBe(0);
      expect(alpha.center).toEqual([255, 255, 255, 255]);
      // Logo sem fundo de uma cor (cantos transparentes) não é tocada.
      const clear = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><circle cx="60" cy="60" r="28" fill="#FFFFFF"/></svg>').toString('base64');
      await page.setContent(`<body><img data-logo src="${clear}" width="120" height="120"></body>`);
      expect(await page.evaluate(`${KEY_LOGOS}()`)).toBe(0);
    } finally {
      await browser.close();
    }
  }, 90_000);

  it('data-fit encolhe o texto até caber na caixa de tamanho fixo', async () => {
    const r = await renderer.render({ ...base, html: doc('<div data-fit="headline" style="position:absolute;left:96px;top:300px;width:400px;height:160px;overflow:hidden;font-size:120px;line-height:1;color:#fff">Uma frase bem longa que não cabe</div>') });
    expect(rules(r)).not.toContain('text_clipped');
    expect(r.texts.some((t) => t.text.includes('Uma frase bem longa'))).toBe(true);
  }, 60_000);

  it('hide some a logo e o @ da marca (data-handle ou texto solto) sem mexer no resto', async () => {
    const dot = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><circle cx="60" cy="60" r="28" fill="#FFFFFF"/></svg>').toString('base64');
    const html = doc(`<h1 style="position:absolute;left:96px;top:300px;font-size:120px;color:#fff;margin:0">Título</h1><img data-logo src="${dot}" style="position:absolute;left:96px;top:1100px;width:120px;height:120px"><span data-handle style="position:absolute;left:300px;top:1150px;font-size:32px;color:#fff">@marca</span><p style="position:absolute;left:96px;top:1000px;font-size:32px;color:#fff;margin:0">@solta</p>`);
    const all = await renderer.render({ ...base, html });
    expect(all.texts.map((t) => t.text)).toEqual(expect.arrayContaining(['Título', '@marca', '@solta']));
    const bare = await renderer.render({ ...base, html, hide: { logo: true, handle: true } });
    expect(bare.texts.map((t) => t.text)).toEqual(['Título']);
    const noLogo = await renderer.render({ ...base, html, hide: { logo: true } });
    expect(noLogo.texts.map((t) => t.text)).toEqual(expect.arrayContaining(['@marca', '@solta']));
    expect(Buffer.from(bare.png).equals(Buffer.from(all.png))).toBe(false);
  }, 90_000);

  it('não fala com a rede e tira script: o HTML malicioso renderiza sem efeito', async () => {
    const r = await renderer.render({ ...base, html: doc('<script>document.body.innerHTML="HACK"</script><img src="http://example.invalid/x.png" style="position:absolute;left:96px;top:96px;width:50px;height:50px"><p style="position:absolute;left:96px;top:300px;font-size:80px;color:#fff;margin:0">Intacto</p>') });
    expect(r.texts.map((t) => t.text)).toEqual(['Intacto']);
  }, 60_000);
});
