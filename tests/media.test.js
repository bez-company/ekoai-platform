import { describe, it, expect } from 'vitest';
import { parseMediaKey, parseRange } from '../platform/src/lib/media.ts';
import { mediaKeyFor, mediaUrlFor, contentTypeFor } from '../src/utils/storage.js';

const UUID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

describe('chave de mídia (/api/media)', () => {
  it('aceita só images|documents com UUID e extensão conhecida', () => {
    expect(parseMediaKey(['images', `${UUID}.png`])).toEqual({ key: `images/${UUID}.png`, contentType: 'image/png' });
    expect(parseMediaKey(['documents', `${UUID}.pdf`])?.contentType).toBe('application/pdf');
    expect(parseMediaKey(['images', `${UUID}.mp4`])?.contentType).toBe('video/mp4');
  });

  it('recusa caminho fora do formato, traversal e outras pastas', () => {
    for (const segments of [
      ['images', '..', 'secret.png'],
      ['images', `${UUID}.png`, 'extra'],
      ['..', 'images', `${UUID}.png`],
      ['other', `${UUID}.png`],
      ['images', 'logo.png'],
      ['images', `${UUID}.exe`],
      ['images', `${UUID}.png%00.html`],
      ['images', `${UUID.toUpperCase()}.png`],
      [],
    ]) {
      expect(parseMediaKey(segments)).toBeNull();
    }
  });

  it('a chave que os jobs geram passa na validação da plataforma', () => {
    for (const file of ['a/b/slide-1.png', 'x.PDF', 'clip.mp4', 'foto.jpeg']) {
      const key = mediaKeyFor(file);
      expect(parseMediaKey(key.split('/'))).not.toBeNull();
    }
    expect(mediaKeyFor('c.pdf').startsWith('documents/')).toBe(true);
    expect(contentTypeFor('c.pdf')).toBe('application/pdf');
  });

  it('a URL devolvida junta a base e a chave sem barra dupla', () => {
    process.env.MEDIA_BASE_URL = 'https://app.exemplo/api/media/';
    expect(mediaUrlFor('images/x.png')).toBe('https://app.exemplo/api/media/images/x.png');
    delete process.env.MEDIA_BASE_URL;
    expect(() => mediaUrlFor('images/x.png')).toThrow(/MEDIA_BASE_URL/);
  });
});

describe('Range', () => {
  it('intervalo fechado, aberto e sufixo', () => {
    expect(parseRange('bytes=0-99', 1000)).toEqual({ start: 0, end: 99 });
    expect(parseRange('bytes=900-', 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange('bytes=500-5000', 1000)).toEqual({ start: 500, end: 999 });
  });

  it('cabeçalho ausente, vazio, múltiplo ou fora do arquivo devolve o arquivo inteiro', () => {
    expect(parseRange(null, 1000)).toBeNull();
    expect(parseRange('bytes=-', 1000)).toBeNull();
    expect(parseRange('bytes=0-1,5-6', 1000)).toBeNull();
    expect(parseRange('bytes=2000-3000', 1000)).toBeNull();
    expect(parseRange('bytes=50-10', 1000)).toBeNull();
    expect(parseRange('items=0-1', 1000)).toBeNull();
  });
});
