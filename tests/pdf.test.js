import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { createRequire } from 'node:module';
import { decodePng, pdfFromPngs } from '../platform/src/lib/pdf.ts';

const { Resvg } = createRequire(new URL('../platform/package.json', import.meta.url))('@resvg/resvg-js');

// PNG de verdade, do mesmo renderizador que grava as lâminas do carrossel.
const slide = (color, w = 108, h = 135, opacity = 1) =>
  new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="${color}" fill-opacity="${opacity}"/><circle cx="${w / 2}" cy="${h / 2}" r="20" fill="#ffffff"/></svg>`).render().asPng();

describe('PDF do carrossel (SPEC 028, BEZ-435)', () => {
  it('lê o PNG do renderizador e devolve os pixels em RGB', () => {
    const img = decodePng(slide('#ff0000'));
    expect([img.width, img.height]).toEqual([108, 135]);
    expect(img.rgb).toHaveLength(108 * 135 * 3);
    expect([...img.rgb.subarray(0, 3)]).toEqual([255, 0, 0]); // canto: vermelho
    const center = ((67 * 108) + 54) * 3;
    expect([...img.rgb.subarray(center, center + 3)]).toEqual([255, 255, 255]); // círculo branco
  });

  it('a transparência é composta sobre o branco', () => {
    const half = new Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="#000000" fill-opacity="0.5"/></svg>').render().asPng();
    const [r] = decodePng(half).rgb;
    expect(r).toBeGreaterThan(120);
    expect(r).toBeLessThan(135);
  });

  it('um PDF com uma página por lâmina, do tamanho da imagem, e com a tabela de objetos certa', () => {
    const pdf = pdfFromPngs([slide('#ff0000'), slide('#00ff00'), slide('#0000ff')], 'Seu bolo está pronto?');
    const text = pdf.toString('latin1');
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(text).toContain('/Count 3');
    expect((text.match(/\/MediaBox \[0 0 108 135\]/g) ?? []).length).toBe(3);
    // cada entrada de xref aponta para "N 0 obj"
    const xref = text.slice(text.indexOf('xref\n'));
    const offsets = [...xref.matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    expect(offsets).toHaveLength(3 + 3 * 3);
    offsets.forEach((o, i) => expect(text.slice(o, o + 12)).toContain(`${i + 1} 0 obj`));
    expect(Number(/startxref\n(\d+)/.exec(text)[1])).toBe(text.indexOf('xref\n'));
    // o título mantém os acentos (UTF-16 com BOM)
    expect(text).toContain('/Title <FEFF');
  });

  it('cada página guarda os pixels da lâmina (o stream abre e tem w*h*3 bytes)', () => {
    const pdf = pdfFromPngs([slide('#00ff00')]);
    const buf = pdf;
    const marker = Buffer.from('/Filter /FlateDecode');
    const at = buf.indexOf(marker);
    const start = buf.indexOf('stream\n', at) + 7;
    const end = buf.indexOf('\nendstream', start);
    const raw = inflateSync(buf.subarray(start, end));
    expect(raw).toHaveLength(108 * 135 * 3);
    expect([...raw.subarray(0, 3)]).toEqual([0, 255, 0]);
  });

  it('recusa o que não é PNG, PNG entrelaçado ou sem páginas', () => {
    expect(() => decodePng(Buffer.from('não sou png, mas tenho mais de trinta e três bytes de conteúdo'))).toThrow(/assinatura/);
    const png = Buffer.from(slide('#ff0000'));
    png[28] = 1; // flag de entrelaçamento no IHDR
    expect(() => decodePng(png)).toThrow(/entrelaçado/);
    expect(() => pdfFromPngs([])).toThrow(/sem páginas/);
  });

  it('um leitor de PDF de verdade abre o arquivo e conta as páginas', (ctx) => {
    try {
      execFileSync('pdfinfo', ['-v'], { stdio: 'ignore' });
    } catch {
      return ctx.skip();
    }
    const dir = mkdtempSync(join(tmpdir(), 'pdf-test-'));
    const file = join(dir, 'carrossel.pdf');
    writeFileSync(file, pdfFromPngs([slide('#ff0000'), slide('#00ff00'), slide('#0000ff'), slide('#ffff00'), slide('#ff00ff'), slide('#00ffff')], 'Carrossel'));
    const accented = join(dir, 'acento.pdf');
    writeFileSync(accented, pdfFromPngs([slide('#ff0000')], 'Seu bolo está pronto?'));
    expect(execFileSync('pdfinfo', ['-enc', 'UTF-8', accented], { encoding: 'utf8' })).toMatch(/Title:\s+Seu bolo está pronto\?/);
    const info = execFileSync('pdfinfo', [file], { encoding: 'utf8' });
    expect(info).toMatch(/Title:\s+Carrossel/);
    expect(info).toMatch(/Pages:\s+6/);
    expect(info).toMatch(/Page size:\s+108 x 135 pts/);
  });
});
