import { describe, it, expect } from 'vitest';
import { POST_STATE_LABEL, activityLines, joinNames, postStateOf, postTitle, sortChannels, TITLE_MAX } from '../platform/src/lib/usage-posts-model.ts';

const base = { title: 'Ideia', createdAt: '2026-10-05T12:00:00Z', channels: ['instagram', 'linkedin'], state: 'published', generatedImages: 0, evaluated: [], publications: [], designEdits: 0, fixes: 0 };

describe('posts do mês em Fatura e uso (SPEC 031, entrega 2)', () => {
  it('o estado vem das publicações e das pendências: uma rede publicada basta, e falha só vale sem nada aberto', () => {
    expect(postStateOf(['published', 'failed'], 0)).toBe('published');
    expect(postStateOf(['scheduled'], 0)).toBe('scheduled');
    expect(postStateOf(['queued'], 1)).toBe('scheduled');
    expect(postStateOf(['publishing'], 0)).toBe('scheduled');
    expect(postStateOf([], 2)).toBe('to_approve');
    expect(postStateOf(['failed'], 0)).toBe('failed');
    expect(postStateOf([], 0)).toBe('none');
    expect(Object.values(POST_STATE_LABEL).every((l) => !/[–—]/.test(l))).toBe(true);
  });

  it('as redes saem sem repetição e na ordem do sistema', () => {
    expect(sortChannels(['twitter', 'instagram', 'twitter', 'linkedin'])).toEqual(['instagram', 'linkedin', 'twitter']);
    expect(sortChannels(['tiktok'])).toEqual([]);
    expect(joinNames([])).toBe('');
    expect(joinNames(['Instagram'])).toBe('Instagram');
    expect(joinNames(['Instagram', 'LinkedIn'])).toBe('Instagram e LinkedIn');
    expect(joinNames(['Instagram', 'LinkedIn', 'X'])).toBe('Instagram, LinkedIn e X');
  });

  it('o título é o pedido em uma linha, cortado no teto com reticências', () => {
    expect(postTitle('  três   sinais\nde bolo pronto  ')).toBe('três sinais de bolo pronto');
    const long = postTitle('palavra '.repeat(40));
    expect(long.length).toBeLessThanOrEqual(TITLE_MAX);
    expect(long.endsWith('…')).toBe(true);
  });

  it('o texto de "o que a Ekoai fez" só diz o que aconteceu', () => {
    const three = { ...base, channels: ['instagram', 'linkedin', 'twitter'], evaluated: ['instagram', 'linkedin', 'twitter'], publications: [{ channel: 'instagram', status: 'published' }, { channel: 'twitter', status: 'published' }, { channel: 'linkedin', status: 'failed' }] };
    expect(activityLines(three)).toEqual([
      'Texto do Instagram, do LinkedIn e do X, cada um para o sinal da rede',
      'Arte montada no layout da marca, sem imagem gerada',
      'Avaliação do potencial em cada rede',
      'Publicação no Instagram e X',
    ]);
    const one = { ...base, channels: ['linkedin'], generatedImages: 1, evaluated: ['linkedin'], publications: [] };
    expect(activityLines(one)).toEqual(['Texto do LinkedIn, para o sinal da rede', '1 imagem gerada por modelo', 'Avaliação do potencial no LinkedIn']);
    expect(activityLines({ ...base, channels: [], generatedImages: 3 })).toEqual(['3 imagens geradas por modelo']);
  });
});
