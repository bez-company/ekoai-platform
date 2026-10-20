import { describe, it, expect } from 'vitest';
import * as f from '../platform/src/lib/company-profile-form.ts';

const profile = (over = {}) => ({
  niche: 'Alimentação', offering: 'Bolos', audience: 'Famílias', region: null, siteUrl: null, instagramHandle: null,
  differentiators: [], pains: [], voiceFormal: null, voiceTechnical: null, voiceSerious: null, bannedWords: [],
  logoAssetId: null, colorPrimary: null, colorAccent: null, fontHeading: null, fontBody: null, ctaDefault: null, postsPerWeek: null,
  updatedAt: '2026-10-20T00:00:00.000Z', ...over,
});

describe('progresso do perfil', () => {
  it('sem perfil 0%; só o obrigatório 60%; cada seção opcional soma 20%', () => {
    expect(f.profileProgress(null)).toEqual({ percent: 0, missing: ['voice', 'visual'] });
    expect(f.profileProgress(profile())).toEqual({ percent: 60, missing: ['voice', 'visual'] });
    expect(f.profileProgress(profile({ bannedWords: ['x'] }))).toEqual({ percent: 80, missing: ['visual'] });
    expect(f.profileProgress(profile({ postsPerWeek: 3 }))).toEqual({ percent: 80, missing: ['voice'] });
    expect(f.profileProgress(profile({ pains: ['a'], colorPrimary: '#B83262' }))).toEqual({ percent: 100, missing: [] });
  });

  it('o logo conta como visual', () => {
    expect(f.hasVisual(profile({ logoAssetId: 'abc' }))).toBe(true);
  });

  it('texto do progresso', () => {
    expect(f.progressText(f.profileProgress(null))).toMatch(/vazio/);
    expect(f.progressText(f.profileProgress(profile()))).toBe('Perfil 60% completo: faltam o jeito de falar e o visual.');
    expect(f.progressText(f.profileProgress(profile({ bannedWords: ['x'] })))).toBe('Perfil 80% completo: falta o visual.');
    expect(f.progressText(f.profileProgress(profile({ bannedWords: ['x'], postsPerWeek: 2 })))).toMatch(/Perfil completo/);
  });
});

describe('resumo do tom', () => {
  it('descreve só o que foi escolhido, com "levemente" nos pontos 2 e 4', () => {
    expect(f.toneSummary(profile({ voiceFormal: 4, voiceTechnical: 4, voiceSerious: 3 }))).toBe('Levemente descontraído, levemente simples');
    expect(f.toneSummary(profile({ voiceFormal: 5, voiceTechnical: 1 }))).toBe('Descontraído, técnico');
    expect(f.toneSummary(profile({ voiceSerious: 2 }))).toBe('Levemente sério');
    expect(f.toneSummary(profile({ voiceFormal: 3 }))).toBe('');
    expect(f.toneSummary(profile())).toBe('');
  });
});

describe('estado dos formulários', () => {
  it('sem perfil, tudo vazio e uma linha em branco nas listas', () => {
    expect(f.aboutFromProfile(null)).toEqual({ niche: '', offering: '', audience: '', region: '', site_url: '', instagram_handle: '' });
    expect(f.voiceFromProfile(null)).toMatchObject({ differentiators: [''], pains: [''], banned_words: [], voice_formal: null });
    expect(f.visualFromProfile(null)).toMatchObject({ color_primary: '', cta_default: '', posts_per_week: null });
  });

  it('com perfil, o @ volta para a tela e o corpo leva a seção', () => {
    const a = f.aboutFromProfile(profile({ instagramHandle: 'doceponto', siteUrl: 'https://doceponto.com.br' }));
    expect(a).toMatchObject({ instagram_handle: '@doceponto', site_url: 'https://doceponto.com.br' });
    expect(f.sectionBody('about', a)).toMatchObject({ section: 'about', niche: 'Alimentação' });
    expect(f.siteLabel('https://doceponto.com.br')).toBe('doceponto.com.br');
  });
});

describe('passo opcional vazio', () => {
  it('só avança sem gravar quando nada foi preenchido', () => {
    expect(f.isVoiceEmpty(f.voiceFromProfile(null))).toBe(true);
    expect(f.isVoiceEmpty({ ...f.voiceFromProfile(null), pains: ['  '] })).toBe(true);
    expect(f.isVoiceEmpty({ ...f.voiceFromProfile(null), banned_words: ['x'] })).toBe(false);
    expect(f.isVoiceEmpty({ ...f.voiceFromProfile(null), voice_serious: 2 })).toBe(false);
    expect(f.isVisualEmpty(f.visualFromProfile(null))).toBe(true);
    expect(f.isVisualEmpty({ ...f.visualFromProfile(null), posts_per_week: 3 })).toBe(false);
    expect(f.isVisualEmpty({ ...f.visualFromProfile(null), color_primary: '#B83262' })).toBe(false);
  });
});
