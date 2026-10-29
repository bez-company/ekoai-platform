import { describe, it, expect } from 'vitest';
import { parseArt, parseCopy, parseCritique, parseDirector, parseHtmlReply, parseReview, parseStrategy, totalScore } from '../platform/src/lib/studio/parse.ts';
import { feedbackText, fillAssets, layoutBlocking, sanitizeHtml } from '../platform/src/lib/studio/html.ts';
import { TERRITORIES, pickTerritories, poolForStyle, territoryById } from '../platform/src/lib/studio/territories.ts';
import { STYLES } from '../platform/src/lib/studio/levels.ts';

const ids = TERRITORIES.map((t) => t.id);
const goodCopy = { headline: 'Leva 24 horas.', support: 'Um dia inteiro de preparo.', extras: [], caption: 'x'.repeat(120), hashtags: ['#pao', '#fermentacao', 'sem-hash'], altText: 'Cartaz marrom' };

describe('contratos de saída dos agentes (SPEC 030)', () => {
  it('estratégia: descarta rota com território que não existe e exige ao menos uma válida', () => {
    const ok = parseStrategy({ read: 'r', objective: 'educar', insight: 'i', routes: [{ territory: ids[0], bigIdea: 'ideia', hook: 'gancho', visual: 'v', fit: 4 }, { territory: 'inventado', bigIdea: 'x', hook: 'y' }] }, ids);
    expect(ok.ok).toBe(true);
    expect(ok.value.routes).toHaveLength(1);
    expect(parseStrategy({ routes: [{ territory: 'inventado', bigIdea: 'x', hook: 'y' }] }, ids)).toMatchObject({ ok: false });
    expect(parseStrategy('texto', ids)).toMatchObject({ ok: false });
    expect(parseStrategy([{ routes: [{ territory: ids[1], bigIdea: 'a', hook: 'b' }] }], ids).ok).toBe(true);
  });

  it('diretor: escolha fora da lista cai na primeira rota', () => {
    const routes = [{ territory: ids[0], bigIdea: 'a', hook: 'b', visual: '' }, { territory: ids[1], bigIdea: 'c', hook: 'd', visual: '' }];
    expect(parseDirector({ choice: 2, why: 'w', sharpen: 's', avoid: ['x'] }, routes).value.index).toBe(1);
    expect(parseDirector({ choice: 9 }, routes).value.index).toBe(0);
  });

  it('texto: valida tamanhos e filtra hashtag sem #', () => {
    const r = parseCopy(goodCopy);
    expect(r.ok).toBe(true);
    expect(r.value.hashtags).toEqual(['#pao', '#fermentacao']);
    expect(parseCopy({ ...goodCopy, headline: '' })).toMatchObject({ ok: false });
    expect(parseCopy({ ...goodCopy, caption: 'curta' })).toMatchObject({ ok: false });
    expect(parseCopy({ ...goodCopy, support: 'y'.repeat(200) })).toMatchObject({ ok: false });
    expect(parseCopy({ ...goodCopy, extras: Array.from({ length: 7 }, () => 'item') })).toMatchObject({ ok: false });
    expect(parseCopy({ ...goodCopy, support: null }).value.support).toBeNull();
  });

  it('direção de arte: paleta em hex, fonte fora da lista cai na da marca, no máximo 2 imagens', () => {
    const art = { concept: 'c', composition: 'k', palette: { bg: '#112233', ink: '#FFFFFF', accent: '#FF8800' }, typography: { display: 'Fonte Inventada', body: 'Inter' }, details: ['d'], logo: { tone: 'on-dark', place: 'canto' }, assets: [{ id: 'hero', role: 'fundo', aspect: '4:5', prompt: 'a'.repeat(40) }, { id: 'b', role: 'r', aspect: 'x', prompt: 'b'.repeat(40) }, { id: 'c', role: 'r', aspect: '1:1', prompt: 'c'.repeat(40) }] };
    const r = parseArt(art, { fontHeading: 'Sora', fontBody: 'Inter' });
    expect(r.ok).toBe(true);
    expect(r.value.typography.display).toBe('Sora');
    expect(r.value.assets).toHaveLength(2);
    expect(r.value.assets[1].aspect).toBe('4:5');
    expect(parseArt({ ...art, palette: { bg: 'azul', ink: '#FFF', accent: '#000' } }, { fontHeading: 'Sora', fontBody: 'Inter' })).toMatchObject({ ok: false });
  });

  it('crítica: exige notas de 0 a 10, limita as correções e a nota total pesa conceito e originalidade em dobro', () => {
    const scores = { conceito: 8, hierarquia: 7, tipografia: 7, composicao: 7, acabamento: 7, originalidade: 8, marca: 7, legibilidade: 7, texto: 7 };
    const r = parseCritique({ scores, slop: [], fixes: Array.from({ length: 8 }, (_, i) => ({ severity: 'alta', fix: `corrige ${i}`, target: 'layout' })), verdict: 'ship', summary: 's' });
    expect(r.ok).toBe(true);
    expect(r.value.fixes).toHaveLength(5);
    expect(totalScore(scores)).toBe(7.4);
    expect(parseCritique({ scores: { conceito: 99 } })).toMatchObject({ ok: false });
    expect(parseCritique({ scores, verdict: 'talvez' }).value.verdict).toBe('revise');
  });

  it('revisão: reprovar sem apontar nada vale como aprovado', () => {
    expect(parseReview({ ok: false, issues: [] }).value.ok).toBe(true);
    const r = parseReview({ ok: false, issues: [{ rule: 'logo', detail: 'logo distorcido', fix: 'corrija' }, { rule: 'inventada', detail: 'x' }] });
    expect(r.value.ok).toBe(false);
    expect(r.value.issues).toHaveLength(1);
    expect(parseReview({ issues: [] })).toMatchObject({ ok: false });
  });

  it('resposta do designer: separa notas, pedido de imagem e HTML, e recusa o que não é documento', () => {
    const r = parseHtmlReply('===NOTES===\nfiz tal\n===REGEN===\n[{"id":"hero","prompt":"' + 'p'.repeat(30) + '"}]\n===HTML===\n```html\n<!doctype html><html><body>oi</body></html>\n```');
    expect(r.ok).toBe(true);
    expect(r.value.notes).toBe('fiz tal');
    expect(r.value.regen).toHaveLength(1);
    expect(r.value.html.startsWith('<!doctype html>')).toBe(true);
    expect(parseHtmlReply('só conversa')).toMatchObject({ ok: false });
  });
});

describe('HTML do designer', () => {
  it('sanitiza script, evento, link e import', () => {
    const out = sanitizeHtml('<html><head><link rel="stylesheet" href="x.css"><style>@import url(y);</style><script>alert(1)</script></head><body onclick="x()">oi</body></html>');
    expect(out).not.toMatch(/script|onclick|<link|@import/);
  });

  it('troca marcadores de imagem e de logo e marca o logo para a medição', () => {
    const html = '<img src="{{asset:hero}}"><img src="{{logo:on-dark}}">';
    const out = fillAssets(html, { assets: { hero: new Uint8Array([1, 2]) }, logos: { 'on-light': 'data:l', 'on-dark': 'data:d' } });
    expect(out).toContain('src="data:image/png;base64,AQI="');
    expect(out).toContain('src="data:d" data-logo="on-dark"');
    expect(fillAssets('<img src="{{logo:on-dark}}">', { logos: { 'on-light': 'data:l' } })).toContain('src="data:l" data-logo="on-dark"');
  });

  it('só trava com defeito de layout; fonte desconhecida é aviso', () => {
    const issues = [{ rule: 'safe_margin', detail: 'a' }, { rule: 'font_unknown', detail: 'b' }, { rule: 'contrast_low', detail: 'c' }];
    expect(layoutBlocking(issues).map((i) => i.rule)).toEqual(['safe_margin', 'contrast_low']);
    expect(feedbackText([{ rule: 'x', detail: 'd', fix: 'f' }])).toBe('- x: d (f)');
  });
});

describe('territórios', () => {
  it('um por estilo da vitrine, com o mesmo uso de imagem', () => {
    expect(TERRITORIES.map((t) => t.id)).toEqual(STYLES.map((s) => s.id));
    for (const s of STYLES) {
      const t = territoryById(s.id);
      if (s.image === 'none') expect(t.image).toBe('none');
      if (s.image === 'required') expect(t.image).toBe('hero');
      if (s.image === 'optional') expect(['optional', 'cutout']).toContain(t.image);
    }
  });

  it('o sorteio é reproduzível, sem repetir e sem os usados recentemente', () => {
    const a = pickTerritories({ count: 4, seed: 7 }).map((t) => t.id);
    expect(pickTerritories({ count: 4, seed: 7 }).map((t) => t.id)).toEqual(a);
    expect(new Set(a).size).toBe(4);
    const b = pickTerritories({ count: 4, seed: 7, recent: a }).map((t) => t.id);
    expect(b.some((id) => a.includes(id))).toBe(false);
  });

  it('o estilo escolhido restringe o conjunto', () => {
    expect(poolForStyle('cartaz-tipografico').map((t) => t.id)).toEqual(['cartaz-tipografico']);
    expect(poolForStyle('auto-minimalista').every((t) => t.image === 'none' || t.image === 'optional')).toBe(true);
    expect(poolForStyle('auto-imagem').every((t) => t.image !== 'none')).toBe(true);
    expect(poolForStyle('auto')).toHaveLength(15);
  });
});
