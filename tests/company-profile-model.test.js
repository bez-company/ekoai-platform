import { describe, it, expect } from 'vitest';
import * as m from '../platform/src/lib/company-profile-model.ts';

const about = (over = {}) => ({ section: 'about', niche: 'Alimentação', offering: 'Bolos sob encomenda.', audience: 'Famílias de Marília.', ...over });
const ok = (r) => {
  expect(r.ok, JSON.stringify(r)).toBe(true);
  return r.values;
};

describe('seção Sobre o negócio', () => {
  it('aceita só os obrigatórios e deixa o resto vazio', () => {
    expect(ok(m.parseProfileSection(about()))).toEqual({
      niche: 'Alimentação', offering: 'Bolos sob encomenda.', audience: 'Famílias de Marília.',
      region: null, site_url: null, instagram_handle: null,
    });
  });

  it('cada obrigatório que falta volta com a própria mensagem', () => {
    const r = m.parseProfileSection({ section: 'about' });
    expect(r.ok).toBe(false);
    expect(Object.keys(r.fields).sort()).toEqual(['audience', 'niche', 'offering']);
    expect(r.fields.niche).toBe('Escolha o nicho.');
    expect(r.error).toBe('Escolha o nicho.');
  });

  it('nicho fora da lista é recusado', () => {
    expect(m.parseProfileSection(about({ niche: 'Cripto' })).fields.niche).toMatch(/da lista/);
  });

  it('limites de tamanho e espaços sobrando', () => {
    expect(m.parseProfileSection(about({ offering: 'x'.repeat(281) })).fields.offering).toBe('Use até 280 caracteres.');
    expect(ok(m.parseProfileSection(about({ offering: '  Bolos   e   doces  ' }))).offering).toBe('Bolos e doces');
    expect(m.parseProfileSection(about({ region: 'x'.repeat(81) })).fields.region).toBe('Use até 80 caracteres.');
  });

  it('site sem https vira https; endereço torto é recusado', () => {
    expect(ok(m.parseProfileSection(about({ site_url: 'doceponto.com.br' }))).site_url).toBe('https://doceponto.com.br');
    expect(ok(m.parseProfileSection(about({ site_url: 'http://doceponto.com.br/cardapio?x=1' }))).site_url).toBe('http://doceponto.com.br/cardapio?x=1');
    for (const bad of ['javascript:alert(1)', 'ftp://x.com', 'sem espaço.com', 'localhost', 'https://u:p@x.com']) {
      expect(m.parseProfileSection(about({ site_url: bad })).fields.site_url, bad).toBeDefined();
    }
  });

  it('@ do Instagram: aceita com ou sem @, recusa caractere inválido', () => {
    expect(ok(m.parseProfileSection(about({ instagram_handle: '@doce.ponto_1' }))).instagram_handle).toBe('doce.ponto_1');
    expect(ok(m.parseProfileSection(about({ instagram_handle: 'doceponto' }))).instagram_handle).toBe('doceponto');
    for (const bad of ['doce ponto', 'doce-ponto', 'a'.repeat(31), '@']) {
      expect(m.parseProfileSection(about({ instagram_handle: bad })).fields.instagram_handle, bad).toBeDefined();
    }
  });
});

describe('seção Jeito de falar', () => {
  it('escalas de 1 a 5, vazias viram nulo', () => {
    const v = ok(m.parseProfileSection({ section: 'voice', voice_formal: 4, voice_technical: '2', voice_serious: null }));
    expect(v).toMatchObject({ voice_formal: 4, voice_technical: 2, voice_serious: null });
    for (const bad of [0, 6, 2.5, 'x']) {
      expect(m.parseProfileSection({ section: 'voice', voice_formal: bad }).fields.voice_formal, String(bad)).toBeDefined();
    }
  });

  it('listas: tira vazio e repetido, limita a 5 itens e ao tamanho', () => {
    const v = ok(m.parseProfileSection({ section: 'voice', differentiators: ['Entrega no dia', ' entrega no dia ', '', 'Sem conservantes'] }));
    expect(v.differentiators).toEqual(['Entrega no dia', 'Sem conservantes']);
    expect(m.parseProfileSection({ section: 'voice', pains: ['a', 'b', 'c', 'd', 'e', 'f'] }).fields.pains).toBe('Use até 5 dores.');
    expect(m.parseProfileSection({ section: 'voice', differentiators: ['x'.repeat(141)] }).fields.differentiators).toMatch(/até 140/);
  });

  it('palavras proibidas em minúsculas, até 30 e 600 caracteres juntas', () => {
    expect(ok(m.parseProfileSection({ section: 'voice', banned_words: ['Imperdível', 'TOP demais'] })).banned_words).toEqual(['imperdível', 'top demais']);
    const many = Array.from({ length: 31 }, (_, i) => `p${i}`);
    expect(m.parseProfileSection({ section: 'voice', banned_words: many }).fields.banned_words).toBe('Use até 30 palavras.');
    const long = Array.from({ length: 20 }, (_, i) => `palavra-longa-numero-${i}-xxxxxxxxxxxxxxx`);
    expect(m.parseProfileSection({ section: 'voice', banned_words: long }).fields.banned_words).toMatch(/grande/);
  });

  it('não-lista no lugar da lista vira lista vazia, sem quebrar', () => {
    expect(ok(m.parseProfileSection({ section: 'voice', differentiators: 'texto', pains: { a: 1 } }))).toMatchObject({ differentiators: [], pains: [] });
  });
});

describe('seção Visual', () => {
  it('cores normalizadas em #RRGGBB maiúsculo', () => {
    const v = ok(m.parseProfileSection({ section: 'visual', color_primary: 'b83262', color_accent: '#4a2c2a' }));
    expect(v).toMatchObject({ color_primary: '#B83262', color_accent: '#4A2C2A' });
  });

  it('cor principal clara demais para texto branco é recusada com a mensagem do protótipo', () => {
    expect(m.parseProfileSection({ section: 'visual', color_primary: '#F4A7C0' }).fields.color_primary).toMatch(/difícil de ler/);
    expect(m.parseProfileSection({ section: 'visual', color_primary: 'azul' }).fields.color_primary).toMatch(/formato/);
    expect(m.parseProfileSection({ section: 'visual', color_accent: '#12' }).fields.color_accent).toMatch(/formato/);
  });

  it('fontes só da lista curada, cada campo com a sua lista', () => {
    expect(ok(m.parseProfileSection({ section: 'visual', font_heading: 'Playfair Display', font_body: 'DM Sans' }))).toMatchObject({ font_heading: 'Playfair Display', font_body: 'DM Sans' });
    expect(m.parseProfileSection({ section: 'visual', font_heading: 'Comic Sans' }).fields.font_heading).toBe('Escolha uma fonte da lista.');
    expect(m.parseProfileSection({ section: 'visual', font_body: 'Playfair Display' }).fields.font_body).toBe('Escolha uma fonte da lista.');
  });

  it('CTA e posts por semana', () => {
    expect(ok(m.parseProfileSection({ section: 'visual', cta_default: 'whatsapp', posts_per_week: 3 }))).toMatchObject({ cta_default: 'whatsapp', posts_per_week: 3 });
    expect(m.parseProfileSection({ section: 'visual', cta_default: 'email' }).fields.cta_default).toBeDefined();
    for (const bad of [0, 15, 2.5, 'x']) expect(m.parseProfileSection({ section: 'visual', posts_per_week: bad }).fields.posts_per_week, String(bad)).toBeDefined();
  });

  it('tudo vazio é válido: a seção é opcional', () => {
    expect(ok(m.parseProfileSection({ section: 'visual' }))).toEqual({
      color_primary: null, color_accent: null, font_heading: null, font_body: null, cta_default: null,
    });
  });

  it('sem o campo, posts por semana não é gravado (o ritmo é o da Agenda); com o campo (cliente antigo), grava', () => {
    expect('posts_per_week' in ok(m.parseProfileSection({ section: 'visual' }))).toBe(false);
    expect(ok(m.parseProfileSection({ section: 'visual', posts_per_week: 3 })).posts_per_week).toBe(3);
  });
});

describe('corpo inválido', () => {
  it('sem seção, seção desconhecida ou corpo que não é objeto', () => {
    for (const body of [null, 'x', [], {}, { section: 'logo' }, { section: 'about\n' }]) {
      const r = m.parseProfileSection(body);
      expect(r.ok, JSON.stringify(body)).toBe(false);
      expect(r.error).toMatch(/Seção do perfil inválida/);
    }
  });

  it('o campo de tenant ou de dono no corpo é ignorado', () => {
    const v = ok(m.parseProfileSection(about({ tenant_id: 'outra', updated_by: 'x', logo_asset_id: 'x' })));
    expect(Object.keys(v).sort()).toEqual(['audience', 'instagram_handle', 'niche', 'offering', 'region', 'site_url']);
  });
});

describe('contraste e perfil completo', () => {
  it('contrastRatio bate com os valores conhecidos do WCAG', () => {
    expect(m.contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 0);
    expect(m.contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
    expect(m.contrastRatio('#F4A7C0', '#FFFFFF')).toBeLessThan(2.1);
    expect(m.contrastRatio('#B83262', '#FFFFFF')).toBeGreaterThan(5);
  });

  it('isProfileComplete exige os três obrigatórios', () => {
    expect(m.isProfileComplete(null)).toBe(false);
    expect(m.isProfileComplete({ niche: 'Moda', offering: 'x', audience: ' ' })).toBe(false);
    expect(m.isProfileComplete({ niche: 'Moda', offering: 'x', audience: 'y' })).toBe(true);
  });

  it('profileFromRow converte a linha do banco', () => {
    const p = m.profileFromRow({ niche: 'Moda', offering: 'o', audience: 'a', region: null, voice_formal: 4, banned_words: ['x'], differentiators: null, updated_at: new Date('2026-10-20T00:00:00Z') });
    expect(p).toMatchObject({ niche: 'Moda', region: null, voiceFormal: 4, bannedWords: ['x'], differentiators: [], updatedAt: '2026-10-20T00:00:00.000Z' });
  });
});
