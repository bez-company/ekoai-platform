import { describe, it, expect } from 'vitest';
import * as m from '../platform/src/lib/logo-model.ts';

const be32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const chunk = (type, data = []) => [...be32(data.length), ...[...type].map((c) => c.charCodeAt(0)), ...data, 0, 0, 0, 0]; // CRC não é conferido
const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const png = ({ w = 64, h = 64, idat = true, iend = true, tail = [] } = {}) =>
  new Uint8Array([...SIG, ...chunk('IHDR', [...be32(w), ...be32(h), 8, 6, 0, 0, 0]), ...(idat ? chunk('IDAT', [1, 2, 3]) : []), ...(iend ? chunk('IEND') : []), ...tail]);
const text = (s) => new TextEncoder().encode(s);
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect fill="#B83262"/></svg>';

describe('PNG', () => {
  it('aceita e devolve o mesmo arquivo', () => {
    const bytes = png();
    const r = m.inspectLogo(bytes);
    expect(r).toMatchObject({ ok: true, contentType: 'image/png', ext: 'png' });
    expect(Array.from(r.bytes)).toEqual(Array.from(bytes));
  });

  it('corta o que vem depois do IEND (nada escondido)', () => {
    const r = m.inspectLogo(png({ tail: [...text('<script>alert(1)</script>')] }));
    expect(r.ok).toBe(true);
    expect(r.bytes.length).toBe(png().length);
  });

  it('recusa PNG truncado, sem IHDR, sem IDAT, sem IEND ou enorme', () => {
    expect(m.inspectLogo(png().slice(0, 30)).error).toMatch(/corrompido ou incompleto/);
    expect(m.inspectLogo(png({ iend: false })).error).toMatch(/corrompido ou incompleto/);
    expect(m.inspectLogo(png({ idat: false })).error).toMatch(/corrompido/);
    expect(m.inspectLogo(new Uint8Array([...SIG, ...chunk('tEXt', [1, 2])])).error).toMatch(/corrompido/);
    expect(m.inspectLogo(png({ w: 0 })).error).toMatch(/corrompido/);
    expect(m.inspectLogo(png({ w: 5000, h: 100 })).error).toBe('O PNG tem 5000 por 100 pixels. Use até 4096 pixels de lado.');
  });

  it('chunk que declara tamanho maior que o arquivo é recusado', () => {
    const bad = new Uint8Array([...SIG, ...be32(13), ...text('IHDR'), ...be32(0xfffffff0), 0]);
    expect(m.inspectLogo(bad).ok).toBe(false);
  });
});

describe('SVG', () => {
  it('aceita e devolve reescrito', () => {
    const r = m.inspectLogo(text(SVG));
    expect(r).toMatchObject({ ok: true, contentType: 'image/svg+xml', ext: 'svg' });
    expect(new TextDecoder().decode(r.bytes)).toContain('<rect fill="#B83262"/>');
  });

  it('aceita com BOM e declaração xml', () => {
    expect(m.inspectLogo(text('﻿<?xml version="1.0"?>' + SVG)).ok).toBe(true);
  });

  it('SVG hostil volta com a mensagem do sanitizador', () => {
    const r = m.inspectLogo(text('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/<script>/);
  });

  it('SVG que não é UTF-8 é recusado', () => {
    expect(m.inspectLogo(new Uint8Array([...text('<svg xmlns="x">'), 0xff, 0xfe, ...text('</svg>')])).error).toMatch(/UTF-8/);
  });
});

describe('formato e tamanho', () => {
  it('o tipo vem dos bytes: JPG, GIF, PDF e HTML são recusados com a lista do que vale', () => {
    for (const bytes of [new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]), text('GIF89a....'), text('%PDF-1.7'), text('<html><body>oi</body></html>')]) {
      expect(m.inspectLogo(bytes).error).toMatch(/Não reconhecemos.*PNG ou SVG/);
    }
  });

  it('vazio e acima de 2 MB', () => {
    expect(m.inspectLogo(new Uint8Array()).error).toBe('O arquivo está vazio.');
    expect(m.inspectLogo(new Uint8Array(2 * 1024 * 1024 + 1)).error).toBe('O arquivo tem 2,0 MB. Use PNG ou SVG de até 2 MB.');
  });

  it('chave do bucket fica debaixo da pasta da conta', () => {
    expect(m.logoKey('doce', 'abc', 'png')).toBe('tenants/doce/logo/abc.png');
  });
});
