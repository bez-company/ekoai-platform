import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable } from 'node:stream';

const BODY = Buffer.from('0123456789'.repeat(10)); // 100 bytes
const file = {
  getMetadata: vi.fn(),
  createReadStream: vi.fn(),
};
vi.mock('@/lib/media', async (orig) => ({ ...(await orig()), mediaFile: () => file }));

const { GET } = await import('../platform/src/app/api/media/[...key]/route.ts');

const UUID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const call = (segments, headers = {}) =>
  GET(new Request('http://x/api/media/' + segments.join('/'), { headers }), { params: Promise.resolve({ key: segments }) });

beforeEach(() => {
  file.getMetadata.mockReset().mockResolvedValue([{ size: String(BODY.length) }]);
  file.createReadStream.mockReset().mockImplementation((range) => Readable.from(range ? BODY.subarray(range.start, range.end + 1) : BODY));
});

describe('GET /api/media', () => {
  it('devolve o arquivo inteiro com tipo, tamanho e cache imutável', async () => {
    const res = await call(['images', `${UUID}.png`]);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('content-length')).toBe('100');
    expect(res.headers.get('cache-control')).toContain('immutable');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.from(await res.arrayBuffer())).toEqual(BODY);
  });

  it('atende Range com 206 e Content-Range', async () => {
    const res = await call(['images', `${UUID}.mp4`], { range: 'bytes=10-19' });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe('bytes 10-19/100');
    expect(res.headers.get('content-length')).toBe('10');
    expect(file.createReadStream).toHaveBeenCalledWith({ start: 10, end: 19 });
    expect(Buffer.from(await res.arrayBuffer())).toEqual(BODY.subarray(10, 20));
  });

  it('chave fora do formato nem chega no bucket', async () => {
    const res = await call(['images', '..', 'x.png']);
    expect(res.status).toBe(404);
    expect(file.getMetadata).not.toHaveBeenCalled();
  });

  it('objeto inexistente é 404; falha do bucket é 502', async () => {
    file.getMetadata.mockRejectedValueOnce(Object.assign(new Error('nf'), { code: 404 }));
    expect((await call(['images', `${UUID}.png`])).status).toBe(404);
    file.getMetadata.mockRejectedValueOnce(new Error('boom'));
    expect((await call(['images', `${UUID}.png`])).status).toBe(502);
  });
});
