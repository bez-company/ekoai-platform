import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseCopy, cleanAltText, altTextFromTexts, finalAltText, LIMITS } from '../platform/src/lib/agents.ts';
import { publishSingle } from '../platform/src/lib/channels/instagram.ts';

const base = { kind: 'informativo', angle: 'dica', texts: { kicker: 'Dica da casa', title: 'Seu bolo está pronto?', items: ['A massa desgruda da borda', 'O palito sai limpo'] }, caption: 'Três sinais.', hashtags: ['bolo'] };

describe('texto alternativo do redator (BEZ-203)', () => {
  it('vem do modelo, limpo de hashtag, link e travessão', () => {
    const out = parseCopy({ ...base, alt_text: 'Arte rosa com o título  Seu bolo está pronto? — e dois sinais. #bolo https://x.y/z' }, null);
    expect(out.ok).toBe(true);
    expect(out.value.altText).toBe('Arte rosa com o título Seu bolo está pronto?, e dois sinais.');
  });

  it('sem alt_text do modelo: a foto sem texto usa a descrição; o resto, o texto da imagem', () => {
    const out = parseCopy(base, null);
    expect(out.value.altText).toBe('');
    expect(finalAltText({ fromWriter: '', texts: out.value.texts, banned: [] })).toBe('Arte do post com o texto: Dica da casa. Seu bolo está pronto. A massa desgruda da borda. O palito sai limpo.');
    expect(finalAltText({ fromWriter: '', photoDescription: 'Forno a lenha aceso', texts: out.value.texts, banned: [] })).toBe('Forno a lenha aceso');
    expect(finalAltText({ fromWriter: 'Do redator', photoDescription: 'Forno', texts: out.value.texts, banned: [] })).toBe('Do redator');
    expect(altTextFromTexts({ title: 'Bolo bom não tem pressa' })).toBe('Arte do post com o texto: Bolo bom não tem pressa.');
  });

  it('corta em 1000 caracteres, na última palavra', () => {
    const long = ('palavra ').repeat(200);
    const out = cleanAltText(long);
    expect(out.length).toBeLessThanOrEqual(LIMITS.altText);
    expect(out.endsWith('palavra')).toBe(true);
    expect(cleanAltText('  ')).toBeNull();
    expect(cleanAltText(42)).toBeNull();
  });

  it('palavra proibida da empresa: volta para o texto da imagem', () => {
    expect(finalAltText({ fromWriter: 'Um bolo imperdível na mesa', texts: { title: 'Bolo de pote' }, banned: ['imperdível'] })).toBe('Arte do post com o texto: Bolo de pote.');
    expect(finalAltText({ fromWriter: 'Um bolo na mesa', texts: { title: 'Bolo de pote' }, banned: ['imperdível'] })).toBe('Um bolo na mesa');
  });
});

describe('alt_text no container do Instagram', () => {
  afterEach(() => vi.unstubAllGlobals());
  const creds = { accountId: '1789', token: 'tok' };

  function graph(responses) {
    const calls = [];
    vi.stubGlobal('fetch', async (url, init) => {
      const u = String(url);
      const body = init?.body ? Object.fromEntries(new URLSearchParams(String(init.body))) : null;
      calls.push({ url: u, body });
      if (u.includes('fields=status_code')) return new Response(JSON.stringify({ status_code: 'FINISHED' }), { status: 200 });
      const next = responses.shift() ?? { status: 200, body: { id: 'x' } };
      return new Response(JSON.stringify(next.body), { status: next.status });
    });
    return calls;
  }

  it('manda alt_text na criação do container, não no media_publish', async () => {
    const calls = graph([{ status: 200, body: { id: 'c1' } }, { status: 200, body: { id: 'p1' } }]);
    const out = await publishSingle(creds, 'https://app.test/img.png', 'legenda', 'Bolo de pote na bancada');
    expect(out).toEqual({ id: 'p1', channel: 'instagram', alt_text: 'sent' });
    const media = calls.filter((c) => c.body);
    expect(media[0].url).toMatch(/\/1789\/media$/);
    expect(media[0].body).toMatchObject({ image_url: 'https://app.test/img.png', alt_text: 'Bolo de pote na bancada' });
    expect(media[1].url).toMatch(/media_publish$/);
    expect(media[1].body.alt_text).toBeUndefined();
  });

  it('Instagram recusa o campo (400): cria de novo sem ele e o post sai', async () => {
    const calls = graph([{ status: 400, body: { error: { message: '(#100) Invalid parameter', code: 100 } } }, { status: 200, body: { id: 'c2' } }, { status: 200, body: { id: 'p2' } }]);
    const out = await publishSingle(creds, 'https://app.test/img.png', 'legenda', 'Bolo');
    expect(out.alt_text).toBe('dropped');
    const media = calls.filter((c) => c.body && c.url.endsWith('/media'));
    expect(media).toHaveLength(2);
    expect(media[1].body.alt_text).toBeUndefined();
  });

  it('erro que não é do campo (500, token) não é engolido; sem texto alternativo, nada muda', async () => {
    graph([{ status: 500, body: { error: { message: 'down' } } }]);
    await expect(publishSingle(creds, 'https://app.test/img.png', 'l', 'Bolo')).rejects.toThrow(/IG API 500/);
    const calls = graph([{ status: 200, body: { id: 'c3' } }, { status: 200, body: { id: 'p3' } }]);
    expect((await publishSingle(creds, 'https://app.test/img.png', 'l')).alt_text).toBe('none');
    expect(calls.find((c) => c.body)?.body.alt_text).toBeUndefined();
  });
});
