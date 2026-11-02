import { describe, it, expect, vi } from 'vitest';
import { parseCaptions, readInstagramPosts } from '../platform/src/lib/site-read/instagram.ts';
import { UserError } from '../platform/src/lib/errors.ts';

const POST = (over = {}) => ({ id: '1', caption: 'Bolo de pote novo no cardápio, vem experimentar com a gente! #docepontomarilia', permalink: 'https://www.instagram.com/p/AAA/', timestamp: '2026-10-30T12:00:00+0000', media_type: 'IMAGE', ...over });
const t = { tenantId: 'acme' };
const creds = async () => ({ accountId: '1784', token: 'SEGREDO-TOKEN' });
const ok = (body) => vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));

describe('legendas da resposta da Meta', () => {
  it('cada legenda vira um texto com o link do post como origem', () => {
    const pages = parseCaptions({ data: [POST(), POST({ id: '2', permalink: 'https://instagram.com/reel/BBB/', caption: 'Quarta de massa na mão, entrega no mesmo dia em Marília.' })] });
    expect(pages).toHaveLength(2);
    expect(pages[0]).toEqual({ url: 'https://www.instagram.com/p/AAA/', text: POST().caption, source: 'instagram' });
    expect(pages[1].url).toBe('https://instagram.com/reel/BBB/');
  });

  it('sem legenda, legenda curta, link que não é do Instagram ou http ficam de fora', () => {
    const pages = parseCaptions({ data: [POST({ caption: undefined }), POST({ caption: 'oi' }), POST({ permalink: 'https://evil.com/p/1/' }), POST({ permalink: 'http://instagram.com/p/1/' }), POST({ permalink: 'https://instagram.com.evil.com/p/1/' }), POST({ id: 'bom' })] });
    expect(pages).toHaveLength(1);
  });

  it('legenda grande é cortada, no máximo 20 e resposta torta não quebra', () => {
    const many = Array.from({ length: 40 }, (_, i) => POST({ id: String(i), permalink: `https://www.instagram.com/p/${i}/`, caption: 'x'.repeat(2000) }));
    const pages = parseCaptions({ data: many });
    expect(pages).toHaveLength(20);
    expect(pages[0].text).toHaveLength(800);
    for (const junk of [null, 'texto', 42, {}, { data: 'x' }, { data: [null, 7, 'a'] }]) expect(parseCaptions(junk), JSON.stringify(junk)).toEqual([]);
  });
});

describe('ler o Instagram da conta', () => {
  it('pede só os campos de legenda, com o token da própria conta, e devolve as páginas', async () => {
    const fetchFn = ok({ data: [POST()] });
    const out = await readInstagramPosts(t, { fetchFn, credentials: creds });
    expect(out.state).toBe('ok');
    expect(out.pages).toHaveLength(1);
    const url = new URL(fetchFn.mock.calls[0][0]);
    expect(url.pathname).toMatch(/\/1784\/media$/);
    expect(url.searchParams.get('fields')).toBe('caption,permalink,timestamp,media_type');
    expect(url.searchParams.get('access_token')).toBe('SEGREDO-TOKEN');
  });

  it('sem conexão ou com a conexão vencida, não chama a Meta e diz o motivo', async () => {
    const fetchFn = ok({ data: [] });
    const none = await readInstagramPosts(t, { fetchFn, credentials: async () => { throw new UserError('Nenhum Instagram conectado. Conecte em Configurações, Redes.'); } });
    const old = await readInstagramPosts(t, { fetchFn, credentials: async () => { throw new UserError('A conexão do Instagram venceu. Reconecte em Configurações, Redes.'); } });
    expect(none).toEqual({ state: 'not_connected', pages: [] });
    expect(old).toEqual({ state: 'expired', pages: [] });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('falha da Meta ou da rede vira "failed" sem derrubar a leitura e sem pôr o token no log', async () => {
    const lines = [];
    const spy = vi.spyOn(console, 'warn').mockImplementation((l) => void lines.push(String(l)));
    const bad = await readInstagramPosts(t, { fetchFn: vi.fn(async () => new Response('{}', { status: 400 })), credentials: creds });
    const down = await readInstagramPosts(t, { fetchFn: vi.fn(async () => { throw new Error('ECONNRESET https://graph.instagram.com/x?access_token=SEGREDO-TOKEN'); }), credentials: creds });
    spy.mockRestore();
    expect(bad).toEqual({ state: 'failed', pages: [] });
    expect(down).toEqual({ state: 'failed', pages: [] });
    expect(lines).toHaveLength(2); // o aviso saiu de verdade (o teste não é vazio) e sem o token
    expect(lines.join('\n')).not.toContain('SEGREDO-TOKEN');
    expect(lines.join('\n')).toMatch(/Graph API 400/);
  });

  it('erro que não é de conexão sobe (é bug, não motivo para a tela)', async () => {
    await expect(readInstagramPosts(t, { credentials: async () => { throw new Error('banco fora'); } })).rejects.toThrow('banco fora');
  });
});
