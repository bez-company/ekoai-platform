import { describe, it, expect } from 'vitest';
import { shortId, distributionUtm, bioLink, linkCommentText, LINK_POLICY } from '../platform/src/lib/utm.ts';

const ID = '3f2a9c1e-7b4d-4e2a-9c11-aa00bb11cc22';
const SITE = 'https://exemplo.com.br';

describe('utm.ts', () => {
  it('shortId usa d + 8 hex do uuid', () => {
    expect(shortId(ID)).toBe('d3f2a9c1e');
  });

  it('shortId recusa id inválido', () => {
    expect(() => shortId('abc')).toThrow(/inválido/);
  });

  it('distributionUtm monta os 4 parâmetros e a URL', () => {
    const utm = distributionUtm({ channel: 'linkedin', distributionId: ID, campaignSlug: 'quanto-custa-um-projeto', baseUrl: SITE });
    expect(utm).toMatchObject({ source: 'linkedin', medium: 'organico', campaign: 'quanto-custa-um-projeto', content: 'd3f2a9c1e' });
    const url = new URL(utm.url);
    expect(url.origin).toBe(SITE);
    expect(url.searchParams.get('utm_content')).toBe('d3f2a9c1e');
    expect(url.searchParams.get('utm_campaign')).toBe('quanto-custa-um-projeto');
  });

  it('sem campanha ativa cai em sempre-on', () => {
    expect(distributionUtm({ channel: 'instagram', distributionId: ID, baseUrl: SITE })?.campaign).toBe('sempre-on');
  });

  it('sem site da conta não há link rastreado (nenhuma URL padrão)', () => {
    expect(distributionUtm({ channel: 'instagram', distributionId: ID })).toBeNull();
    expect(distributionUtm({ channel: 'instagram', distributionId: ID, baseUrl: '' })).toBeNull();
    expect(bioLink()).toBeNull();
  });

  it('respeita baseUrl com path e query existentes', () => {
    const utm = distributionUtm({ channel: 'linkedin', distributionId: ID, baseUrl: `${SITE}/planos?ref=x` });
    const url = new URL(utm.url);
    expect(url.pathname).toBe('/planos');
    expect(url.searchParams.get('ref')).toBe('x');
    expect(url.searchParams.get('utm_source')).toBe('linkedin');
  });

  it('bioLink mede por campanha, com perfil como padrão', () => {
    expect(new URL(bioLink({ campaignSlug: 'lancamento-2027-01', baseUrl: SITE })).searchParams.get('utm_campaign')).toBe('lancamento-2027-01');
    const bio = new URL(bioLink({ baseUrl: SITE }));
    expect(bio.searchParams.get('utm_medium')).toBe('bio');
    expect(bio.searchParams.get('utm_campaign')).toBe('perfil');
  });

  it('política: LinkedIn no 1º comentário, Instagram na bio', () => {
    expect(LINK_POLICY.linkedin).toBe('first_comment');
    expect(LINK_POLICY.instagram).toBe('bio');
  });

  it('texto do comentário leva a URL inteira', () => {
    const utm = distributionUtm({ channel: 'linkedin', distributionId: ID, baseUrl: SITE });
    expect(linkCommentText(utm)).toContain(utm.url);
  });
});
