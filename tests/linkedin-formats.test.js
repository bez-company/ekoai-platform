import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { publishText, uploadVideoFromUrl } from '../platform/src/lib/channels/linkedin.ts';

// A credencial vem da conta conectada (SPEC 028, BEZ-423), não do ambiente.
const CREDS = { token: 'tok', authorUrn: 'urn:li:person:abc' };
import { parseApproveIdea } from '../platform/src/lib/ideas-model.ts';
import { canAutoPublish } from '../platform/src/lib/capabilities.ts';

describe('aprovar sem imagem', () => {
  it('a tela da ideia manda noImage por rede', () => {
    const r = parseApproveIdea({ briefId: 'b', items: [{ pendingId: 'p', captionId: 1, artId: 1, noImage: true }] });
    expect(r.ok && r.value.items[0].noImage).toBe(true);
  });
});

describe('matriz de capacidades', () => {
  it('LinkedIn publica texto, imagem, documento e vídeo pela API', () => {
    for (const f of ['text', 'single', 'carousel', 'video']) expect(canAutoPublish('linkedin', f)).toBe(true);
  });
});

describe('vídeo no LinkedIn', () => {
  beforeEach(() => {
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('sobe as partes na ordem e finaliza com os ETags', async () => {
    const calls = [];
    const responses = [
      () => new Response(new Uint8Array(10), { status: 200 }), // download
      () => new Response(JSON.stringify({
        value: {
          video: 'urn:li:video:V1',
          uploadToken: 't',
          uploadInstructions: [
            { uploadUrl: 'https://up/1', firstByte: 0, lastByte: 5 },
            { uploadUrl: 'https://up/2', firstByte: 6, lastByte: 9 },
          ],
        },
      }), { status: 200 }),
      () => new Response(null, { status: 200, headers: { etag: 'e1' } }),
      () => new Response(null, { status: 200, headers: { etag: 'e2' } }),
      () => new Response('', { status: 200 }), // finalize sem corpo
    ];
    vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
      calls.push({ url: String(url), init });
      return responses.shift()();
    }));

    await expect(uploadVideoFromUrl(CREDS, 'https://cdn/v.mp4')).resolves.toBe('urn:li:video:V1');
    expect(JSON.parse(calls[1].init.body).initializeUploadRequest).toMatchObject({ owner: 'urn:li:person:abc', fileSizeBytes: 10 });
    expect(calls[2].init.body).toHaveLength(6);
    expect(calls[3].init.body).toHaveLength(4);
    expect(JSON.parse(calls[4].init.body).finalizeUploadRequest).toEqual({ video: 'urn:li:video:V1', uploadToken: 't', uploadedPartIds: ['e1', 'e2'] });
  });

  it('parte sem ETag falha com mensagem clara', async () => {
    const responses = [
      () => new Response(new Uint8Array(4), { status: 200 }),
      () => new Response(JSON.stringify({ value: { video: 'urn:li:video:V2', uploadInstructions: [{ uploadUrl: 'https://up/1', firstByte: 0, lastByte: 3 }] } }), { status: 200 }),
      () => new Response(null, { status: 200 }),
    ];
    vi.stubGlobal('fetch', vi.fn(async () => responses.shift()()));
    await expect(uploadVideoFromUrl(CREDS, 'https://cdn/v.mp4')).rejects.toThrow(/ETag/);
  });
});

describe('publicar como página (BEZ-455)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('o post sai com a página como autora e o upload da imagem tem a página como dona', async () => {
    const calls = [];
    const responses = [
      () => new Response(JSON.stringify({ value: { uploadUrl: 'https://up/img', image: 'urn:li:image:I1' } }), { status: 200 }), // initializeUpload
      () => new Response(new Uint8Array(4), { status: 200 }), // baixa a imagem
      () => new Response(null, { status: 201 }), // envia a imagem
      () => new Response(JSON.stringify({}), { status: 201, headers: { 'x-restli-id': 'urn:li:share:S1' } }), // cria o post
    ];
    vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
      calls.push({ url: String(url), init });
      return responses.shift()();
    }));
    await publishText({ token: 'tok', authorUrn: 'urn:li:organization:111' }, 'Texto do post', 'https://cdn/img.png');
    const init = calls.find((c) => c.url.includes('initializeUpload'));
    expect(JSON.parse(init.init.body).initializeUploadRequest.owner).toBe('urn:li:organization:111');
    const post = calls.find((c) => c.url.endsWith('/posts'));
    expect(JSON.parse(post.init.body)).toMatchObject({ author: 'urn:li:organization:111', commentary: 'Texto do post', lifecycleState: 'PUBLISHED' });
  });
});
