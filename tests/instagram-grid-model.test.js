// Prévia do post na grade (SPEC 023, BEZ-200): o parser da Graph API valida formato e host antes de qualquer
// uso, e a conta do corte da miniatura bate com o que o Instagram recorta.
import { describe, it, expect } from 'vitest';
import { cropBands, gridNotice, isMetaImageUrl, parseGridMedia } from '../platform/src/lib/instagram-grid-model.ts';

const CDN = 'https://scontent-gru1-1.cdninstagram.com/v/t51/abc.jpg?stp=dst';
const item = (over = {}) => ({ id: '1', media_type: 'IMAGE', media_url: CDN, permalink: 'https://www.instagram.com/p/abc/', timestamp: '2026-10-20T12:00:00+0000', ...over });

describe('parser da grade', () => {
  it('imagem e carrossel usam media_url; vídeo usa a capa', () => {
    const out = parseGridMedia({
      data: [
        item({ id: 'a', media_type: 'CAROUSEL_ALBUM' }),
        item({ id: 'b', media_type: 'VIDEO', media_url: 'https://video.cdninstagram.com/v.mp4', thumbnail_url: CDN }),
        item({ id: 'c' }),
      ],
    });
    expect(out.map((i) => [i.id, i.type, i.imageUrl])).toEqual([['a', 'CAROUSEL_ALBUM', CDN], ['b', 'VIDEO', CDN], ['c', 'IMAGE', CDN]]);
  });

  it('descarta o que está fora do contrato e segue com o resto', () => {
    const out = parseGridMedia({
      data: [
        item({ id: 'host', media_url: 'https://evil.example.com/x.jpg' }),
        item({ id: 'http', media_url: 'http://scontent.cdninstagram.com/x.jpg' }),
        item({ id: 'parecido', media_url: 'https://cdninstagram.com.evil.example/x.jpg' }),
        item({ id: 'sem-imagem', media_url: undefined }),
        item({ id: 'video-sem-capa', media_type: 'VIDEO', thumbnail_url: undefined }),
        item({ id: 'tipo', media_type: 'STORY' }),
        { media_url: CDN, media_type: 'IMAGE' },
        null,
        item({ id: 'ok' }),
      ],
    });
    expect(out.map((i) => i.id)).toEqual(['ok']);
  });

  it('resposta que não é uma lista vira lista vazia, sem lançar', () => {
    expect(parseGridMedia(null)).toEqual([]);
    expect(parseGridMedia({ data: 'x' })).toEqual([]);
    expect(parseGridMedia({ error: { message: 'x' } })).toEqual([]);
    expect(parseGridMedia(undefined)).toEqual([]);
  });

  it('ordena do mais novo, normaliza o fuso, limita a 8 e só aceita permalink do Instagram', () => {
    const data = Array.from({ length: 12 }, (_, i) => item({ id: `p${i}`, timestamp: `2026-10-${String(10 + i).padStart(2, '0')}T12:00:00+0000` }));
    const out = parseGridMedia({ data });
    expect(out).toHaveLength(8);
    expect(out[0].id).toBe('p11');
    expect(out[0].timestamp).toBe('2026-10-21T12:00:00.000Z');
    expect(parseGridMedia({ data: [item({ permalink: 'https://evil.example.com/p/x' })] })[0].permalink).toBeNull();
    expect(parseGridMedia({ data: [item()] })[0].permalink).toBe('https://www.instagram.com/p/abc/');
  });

  it('só aceita https na CDN da Meta, sem usuário e senha na URL', () => {
    expect(isMetaImageUrl(CDN)).toBe(true);
    expect(isMetaImageUrl('https://instagram.fgru1-1.fna.fbcdn.net/x.jpg')).toBe(true);
    expect(isMetaImageUrl('https://user:pw@scontent.cdninstagram.com/x.jpg')).toBe(false);
    expect(isMetaImageUrl('javascript:alert(1)')).toBe(false);
    expect(isMetaImageUrl(42)).toBe(false);
  });
});

describe('corte da miniatura', () => {
  it('4:5 na miniatura vertical perde 3,13% de cada lado; na quadrada, 10% em cima e embaixo', () => {
    expect(cropBands('4:5', '3:4')).toEqual({ axis: 'x', percent: 3.13 });
    expect(cropBands('4:5', '1:1')).toEqual({ axis: 'y', percent: 10 });
  });

  it('quadrado na miniatura vertical perde 12,5% de cada lado; sem corte quando as proporções coincidem', () => {
    expect(cropBands('1:1', '3:4')).toEqual({ axis: 'x', percent: 12.5 });
    expect(cropBands('1:1', '1:1')).toEqual({ axis: null, percent: 0 });
    expect(cropBands('desconhecido', '3:4')).toEqual({ axis: null, percent: 0 });
  });
});

describe('aviso da grade', () => {
  it('não avisa quando a leitura veio da Meta; avisa e diz o próximo passo nos outros casos', () => {
    expect(gridNotice({ source: 'meta', items: [], reason: null })).toBeNull();
    expect(gridNotice({ source: 'none', items: [], reason: 'not_connected' })).toMatchObject({ tone: 'info', action: 'connect' });
    expect(gridNotice({ source: 'none', items: [], reason: 'expired' })).toMatchObject({ tone: 'warning', action: 'connect' });
    expect(gridNotice({ source: 'ekoai', items: [], reason: 'meta_failed' })).toMatchObject({ tone: 'warning', action: 'retry' });
  });
});
