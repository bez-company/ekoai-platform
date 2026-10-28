import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  parseLinkedinTarget,
  buildEngagePrompt,
  normalizeOptions,
  checkRateLimit,
  shouldOfferCopy,
  parseDraftInput,
  parseCommentText,
  parseTargetInput,
  activityUrl,
  weekStartIso,
} from '../platform/src/lib/engage-model.ts';
import { commentOnPost } from '../platform/src/lib/channels/linkedin.ts';

describe('parseLinkedinTarget', () => {
  it('link de post pelo feed', () => {
    expect(parseLinkedinTarget('https://www.linkedin.com/feed/update/urn:li:activity:7251234567890123456/')).toEqual({
      ok: true,
      value: { kind: 'comentario', object: 'urn:li:activity:7251234567890123456', parentComment: null },
    });
  });

  it('link "copiar link do post" (/posts/...-activity-ID-...)', () => {
    const r = parseLinkedinTarget('https://www.linkedin.com/posts/joana-silva_engenharia-activity-7251234567890123456-AbCd?utm_source=share');
    expect(r.ok && r.value.object).toBe('urn:li:activity:7251234567890123456');
  });

  it('share, ugcPost e URN crua', () => {
    expect(parseLinkedinTarget('https://www.linkedin.com/feed/update/urn:li:ugcPost:123/').ok).toBe(true);
    expect(parseLinkedinTarget('urn:li:share:456')).toMatchObject({ ok: true, value: { object: 'urn:li:share:456' } });
  });

  it('link de comentário vira resposta, com a URN do comentário no formato da API', () => {
    const url = 'https://www.linkedin.com/feed/update/urn:li:activity:111/?commentUrn=urn%3Ali%3Acomment%3A%28activity%3A111%2C222%29';
    expect(parseLinkedinTarget(url)).toEqual({
      ok: true,
      value: { kind: 'resposta', object: 'urn:li:activity:111', parentComment: 'urn:li:comment:(urn:li:activity:111,222)' },
    });
  });

  it('recusa perfil, outro site e link sem post', () => {
    expect(parseLinkedinTarget('https://www.linkedin.com/in/joana/').ok).toBe(false);
    expect(parseLinkedinTarget('https://x.com/i/status/1').ok).toBe(false);
    expect(parseLinkedinTarget('https://www.linkedin.com/feed/').ok).toBe(false);
    expect(parseLinkedinTarget('').ok).toBe(false);
  });
});

describe('prompt e opções', () => {
  it('comentário proíbe citar o produto; resposta fala com a pessoa', () => {
    const c = buildEngagePrompt({ kind: 'comentario', targetText: 'post', author: 'Ana', rules: ['sem emoji'], avoid: ['soou vendedor'] });
    expect(c).toContain('Nunca cite a sua marca');
    expect(c).toContain('- sem emoji');
    expect(c).toContain('- soou vendedor');
    expect(c).toContain('post de Ana');
    const r = buildEngagePrompt({ kind: 'resposta', targetText: 'comentário' });
    expect(r).toContain('opções de resposta');
    expect(r).not.toContain('Nunca cite a sua marca');
  });

  it('normaliza a saída do modelo', () => {
    expect(normalizeOptions({ options: [' a ', 'a', '', { text: 'b' }, 'c', 'd'] })).toEqual(['a', 'b', 'c']);
    expect(normalizeOptions(null)).toEqual([]);
  });
});

describe('limites', () => {
  const limits = { weeklyGoal: 15, dailyCap: 2, minIntervalSeconds: 60 };
  const now = new Date('2026-10-16T15:00:00Z');

  it('libera dentro do limite e do intervalo', () => {
    expect(checkRateLimit({ postedToday: 1, lastPostedAt: '2026-10-16T14:58:00Z', now, limits })).toEqual({ ok: true });
  });

  it('barra no limite diário e antes do intervalo', () => {
    expect(checkRateLimit({ postedToday: 2, lastPostedAt: null, now, limits }).ok).toBe(false);
    const r = checkRateLimit({ postedToday: 0, lastPostedAt: '2026-10-16T14:59:30Z', now, limits });
    expect(r).toEqual({ ok: false, error: 'Espere 30 s antes do próximo comentário.' });
  });

  it('oferece copiar quando a API recusa', () => {
    expect(shouldOfferCopy('LinkedIn API 403: {"message":"Not enough permissions"}')).toBe(true);
    expect(shouldOfferCopy('LinkedIn API 429: throttled')).toBe(true);
    expect(shouldOfferCopy('fetch failed')).toBe(false);
  });

  it('semana começa na segunda 00h de Brasília', () => {
    expect(weekStartIso(new Date('2026-10-16T15:00:00Z'))).toBe('2026-10-12T03:00:00.000Z');
    expect(weekStartIso(new Date('2026-10-19T02:00:00Z'))).toBe('2026-10-12T03:00:00.000Z'); // domingo 23h BRT
  });
});

describe('validação na fronteira', () => {
  it('rascunho exige link válido e texto do post', () => {
    expect(parseDraftInput({ url: 'urn:li:activity:1', targetText: 'curto' }).ok).toBe(false);
    const r = parseDraftInput({ url: 'urn:li:activity:1', targetText: 'texto do post com mais de vinte caracteres', author: ' Ana ' });
    expect(r.ok && r.value.author).toBe('Ana');
  });

  it('comentário exige id e texto dentro do limite', () => {
    expect(parseCommentText({ id: 'x', text: 'ok' }).ok).toBe(true);
    expect(parseCommentText({ id: 'x', text: 'a'.repeat(1251) }).ok).toBe(false);
    expect(parseCommentText({ text: 'ok' }).ok).toBe(false);
  });

  it('conta-alvo: só perfil ou página, link normalizado', () => {
    const r = parseTargetInput({ name: 'Ana', profile_url: 'https://br.linkedin.com/in/ana-eng/details/?x=1' });
    expect(r).toEqual({ ok: true, value: { name: 'Ana', profile_url: 'https://www.linkedin.com/in/ana-eng/', note: null } });
    expect(parseTargetInput({ name: 'Ana', profile_url: 'https://www.linkedin.com/feed/' }).ok).toBe(false);
    expect(activityUrl('https://www.linkedin.com/in/ana-eng/')).toBe('https://www.linkedin.com/in/ana-eng/recent-activity/all/');
    expect(activityUrl('https://www.linkedin.com/company/abc/')).toBe('https://www.linkedin.com/company/abc/posts/');
  });
});

// A credencial vem da conta conectada (SPEC 028, BEZ-423), não do ambiente.
const CREDS = { token: 'tok', authorUrn: 'urn:li:person:me' };

describe('commentOnPost', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('resposta usa o comentário no path e manda parentComment', async () => {
    const calls = [];
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(init.body) });
      return new Response(null, { status: 201, headers: { 'x-restli-id': '999' } });
    }));
    const parent = 'urn:li:comment:(urn:li:activity:111,222)';
    await expect(commentOnPost(CREDS, 'urn:li:activity:111', 'boa', { parentComment: parent })).resolves.toEqual({ id: '999' });
    expect(calls[0].url).toContain(`/socialActions/${encodeURIComponent(parent)}/comments`);
    expect(calls[0].body).toEqual({ actor: 'urn:li:person:me', object: 'urn:li:activity:111', message: { text: 'boa' }, parentComment: parent });

    await commentOnPost(CREDS, 'urn:li:activity:111', 'oi');
    expect(calls[1].url).toContain(`/socialActions/${encodeURIComponent('urn:li:activity:111')}/comments`);
    expect(calls[1].body.parentComment).toBeUndefined();
  });
});
