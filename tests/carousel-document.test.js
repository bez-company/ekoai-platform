import { describe, it, expect } from 'vitest';
import { contentTypeFor } from '../src/utils/storage.js';
import { documentTitle } from '../src/channels/linkedin.js';
import { documentTitle as documentTitleTs } from '../platform/src/lib/channels/linkedin.ts';
import { mediaKindOf } from '../platform/src/lib/scheduling.ts';

describe('carrossel → PDF do LinkedIn', () => {
  it('contentTypeFor reconhece PDF e PNG', () => {
    expect(contentTypeFor('tmp/carousel-1.pdf')).toBe('application/pdf');
    expect(contentTypeFor('tmp/slide.PNG')).toBe('image/png');
    expect(contentTypeFor('x.bin')).toBe('application/octet-stream');
  });

  it('documentTitle encurta o gancho e tem fallback (Node e TS iguais)', () => {
    const long = 'a'.repeat(120);
    for (const fn of [documentTitle, documentTitleTs]) {
      expect(fn('  3 sinais\n de margem  ')).toBe('3 sinais de margem');
      expect(fn(long)).toHaveLength(80);
      expect(fn('')).toBe('Documento');
    }
  });

  it('mediaKindOf: documento no LinkedIn, carrossel só com slides prontos', () => {
    expect(mediaKindOf('linkedin', { id: 1, format: 'carousel', slideUrls: ['a', 'b'], documentUrl: 'p.pdf' }, null)).toBe('document');
    expect(mediaKindOf('instagram', { id: 1, format: 'carousel', slideUrls: ['a', 'b'] }, 'x.png')).toBe('carousel');
    expect(mediaKindOf('instagram', { id: 1, format: 'carousel' }, 'x.png')).toBe('image');
    expect(mediaKindOf('linkedin', { id: 1, format: 'text' }, null)).toBe('text');
  });
});
