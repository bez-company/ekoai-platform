// Leitura da grade (SPEC 023, BEZ-200): token da conta na chamada, cache de 10 minutos, e queda para os posts
// da Ekoai quando a Meta falha ou o Instagram não está conectado.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../platform/src/lib/social-accounts.ts', () => ({ instagramCredentials: async () => ({ accountId: 'ig1', token: 'tok' }) }));
const published = { items: [] };
vi.mock('../platform/src/lib/published-feed.ts', () => ({ listPublished: async () => published.items }));

const { readGrid, clearGridCache } = await import('../platform/src/lib/instagram-grid.ts');
const { UserError } = await import('../platform/src/lib/errors.ts');

const CDN = 'https://scontent.cdninstagram.com/v/a.jpg';
const t = { tenantId: 'acme' };
const ok = (data) => async () => ({ ok: true, status: 200, json: async () => ({ data }) });
const media = (id) => ({ id, media_type: 'IMAGE', media_url: CDN, permalink: `https://www.instagram.com/p/${id}/`, timestamp: '2026-10-20T12:00:00+0000' });

beforeEach(() => {
  clearGridCache();
  published.items = [{ id: 'p1', channel: 'instagram', imageUrl: '/api/media/images/x.png', publishedAt: '2026-10-19T12:00:00.000Z' }, { id: 'p2', channel: 'twitter', imageUrl: '/api/media/images/y.png', publishedAt: null }];
});

describe('readGrid', () => {
  it('lê da Meta com o token da conta e os campos pedidos', async () => {
    const fetchFn = vi.fn(ok([media('a'), media('b')]));
    const view = await readGrid(t, { fetchFn });
    expect(view).toMatchObject({ source: 'meta', reason: null });
    expect(view.items.map((i) => i.id)).toEqual(['a', 'b']);
    const url = new URL(String(fetchFn.mock.calls[0][0]));
    expect(url.pathname).toMatch(/\/ig1\/media$/);
    expect(url.searchParams.get('access_token')).toBe('tok');
    expect(url.searchParams.get('fields')).toContain('thumbnail_url');
  });

  it('repete a leitura só depois de 10 minutos', async () => {
    const fetchFn = vi.fn(ok([media('a')]));
    await readGrid(t, { fetchFn, nowMs: 0 });
    await readGrid(t, { fetchFn, nowMs: 9 * 60_000 });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    await readGrid(t, { fetchFn, nowMs: 11 * 60_000 });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('conta sem posts: lista vazia da Meta, sem aviso', async () => {
    expect(await readGrid(t, { fetchFn: ok([]) })).toEqual({ source: 'meta', items: [], reason: null });
  });

  it('a Meta falha (HTTP ou rede): cai nos posts da Ekoai no Instagram e diz o motivo', async () => {
    for (const fetchFn of [async () => ({ ok: false, status: 500, json: async () => ({}) }), async () => { throw new Error('boom https://x?access_token=tok'); }]) {
      clearGridCache();
      const view = await readGrid(t, { fetchFn });
      expect(view).toMatchObject({ source: 'ekoai', reason: 'meta_failed' });
      expect(view.items.map((i) => i.id)).toEqual(['p1']);
    }
  });

  it('Instagram não conectado ou vencido: posts da Ekoai e o motivo; sem posts, none', async () => {
    const off = async () => { throw new UserError('Nenhum Instagram conectado. Conecte em Configurações, Redes.'); };
    const old = async () => { throw new UserError('A conexão do Instagram venceu. Reconecte em Configurações, Redes.'); };
    expect(await readGrid(t, { credentials: off })).toMatchObject({ source: 'ekoai', reason: 'not_connected' });
    expect(await readGrid(t, { credentials: old })).toMatchObject({ source: 'ekoai', reason: 'expired' });
    published.items = [];
    expect(await readGrid(t, { credentials: off })).toEqual({ source: 'none', items: [], reason: 'not_connected' });
  });

  it('erro que não é do usuário sobe, em vez de virar grade vazia', async () => {
    await expect(readGrid(t, { credentials: async () => { throw new Error('banco fora'); } })).rejects.toThrow('banco fora');
  });
});
