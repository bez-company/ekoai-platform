// O ajuste rápido do post (SPEC 019): o parser rejeita campo fora da lista, o design editado entra sobre o
// guardado sem perder o que a pessoa não edita, o diff sai só de campos da lista e o revisor trava depois
// da edição manual (contraste, margem, fonte), com a fronteira exata de 4,5:1 e 3:1.
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { parseEditable, parseEditBody, parseRestoreBody, parseVersion, checkLayout, applyEditable, editableOf } from '../platform/src/lib/design/edit-model.ts';
import { diffDesigns, summarize } from '../platform/src/lib/design/diff.ts';
import { compatibleLayouts, brandFromProfile, defaultCorner } from '../platform/src/lib/design/model.ts';
import { renderPng } from '../platform/src/lib/design/render.ts';
import { contrast } from '../platform/src/lib/design/color.ts';
import { editBlocking, reviewLayout, BLOCKING } from '../platform/src/lib/design/review.ts';

const FONT_DIR = join(import.meta.dirname, '../platform/fonts');
const base = { layout: 'lista-numerada', texts: { kicker: 'Dica', title: 'Seu bolo está pronto?', sub: 'Confira sem abrir o forno', items: ['A', 'B', 'C'] } };
const ctx = { kind: 'informativo', layout: 'lista-numerada', ratio: '1:1', goal: 'ensinar' };

describe('parser do ajuste', () => {
  it('aceita o design completo e normaliza', () => {
    const r = parseEditable({ ...base, texts: { ...base.texts, title: '  Seu   bolo\nestá pronto?  ' }, logoCorner: 'br', logoHidden: false, colors: { title: '#b83262' } });
    expect(r).toMatchObject({ ok: true });
    expect(r.value.texts.title).toBe('Seu bolo está pronto?');
    expect(r.value.logoCorner).toBe('br');
    expect(r.value.logoHidden).toBeUndefined();
    expect(r.value.colors).toEqual({ title: '#B83262' });
  });

  it.each([
    ['campo desconhecido no topo', { ...base, brand: {} }, 'brand'],
    ['campo desconhecido no texto', { ...base, texts: { ...base.texts, footer: 'x' } }, 'texts.footer'],
    ['layout fora da lista', { ...base, layout: 'qualquer' }, 'layout'],
    ['título vazio', { ...base, texts: { title: '   ' } }, 'texts.title'],
    ['título acima de 280', { ...base, texts: { title: 'a'.repeat(281) } }, 'texts.title'],
    ['subtítulo acima de 280', { ...base, texts: { title: 'ok', sub: 'a'.repeat(281) } }, 'texts.sub'],
    ['mais de 10 itens', { ...base, texts: { title: 'ok', items: Array.from({ length: 11 }, () => 'x') } }, 'texts.items'],
    ['item vazio', { ...base, texts: { title: 'ok', items: ['a', ''] } }, 'texts.items.1'],
    ['canto fora da lista', { ...base, logoCorner: 'centro' }, 'logoCorner'],
    ['esconder logo que não é booleano', { ...base, logoHidden: 'sim' }, 'logoHidden'],
    ['cor que não é hex', { ...base, colors: { title: 'rosa' } }, 'colors.title'],
    ['cor de elemento que não existe', { ...base, colors: { bg: '#FFFFFF' } }, 'colors.bg'],
    ['corpo que não é objeto', 'texto', undefined],
  ])('recusa %s', (_n, body, field) => {
    const r = parseEditable(body);
    expect(r.ok).toBe(false);
    if (field) expect(r.field).toBe(field);
    expect(r.error).toBeTruthy();
  });

  it('o corpo das rotas pede a versão de partida e limita o tempo de edição', () => {
    expect(parseEditBody({ baseVersion: 3, design: base, editMs: 99_999_999 }).value).toMatchObject({ baseVersion: 3, editMs: 3_600_000 });
    expect(parseEditBody({ design: base }).ok).toBe(false);
    expect(parseEditBody({ baseVersion: 0, design: base }).ok).toBe(false);
    expect(parseEditBody({ baseVersion: 1.5, design: base }).ok).toBe(false);
    expect(parseEditBody({ baseVersion: 1, design: base, editMs: -1 }).ok).toBe(false);
    expect(parseRestoreBody({ baseVersion: 2 }).value).toEqual({ baseVersion: 2 });
    expect(parseRestoreBody({}).ok).toBe(false);
    expect(parseVersion('4').value).toBe(4);
    expect(parseVersion('4x').ok).toBe(false);
  });
});

describe('layouts compatíveis (trocar layout, BEZ-202)', () => {
  it('informativo: lista numerada pede 2 itens; atmosfera pede visual', () => {
    expect(compatibleLayouts('informativo', base.texts, false)).toEqual(['lista-numerada', 'titulo-destaque']);
    expect(compatibleLayouts('informativo', { title: 'x', items: ['a'] }, false)).toEqual(['titulo-destaque']);
    expect(compatibleLayouts('atmosfera', { title: 'x' }, true)).toEqual(['foto-titulo', 'foto-janela', 'foto-arco']);
    expect(compatibleLayouts('atmosfera', { title: 'x' }, false)).toEqual([]);
  });

  it('recusa um layout que não serve ao post', () => {
    const edit = parseEditable({ ...base, layout: 'foto-arco' }).value;
    expect(checkLayout(edit, 'informativo', false)).toMatchObject({ ok: false, field: 'layout' });
    expect(checkLayout(parseEditable(base).value, 'informativo', false).ok).toBe(true);
  });
});

describe('o design editado sobre o guardado', () => {
  it('troca o que é editável e preserva o resto (a foto anexada)', () => {
    const stored = { ...base, logoCorner: 'bl', photo: { assetId: 'a1', usage: 'layout' } };
    const next = applyEditable(stored, parseEditable({ layout: 'titulo-destaque', texts: { title: 'Novo', sub: 'só o título' }, logoHidden: true }).value);
    expect(next).toEqual({ layout: 'titulo-destaque', texts: { title: 'Novo', sub: 'só o título' }, logoHidden: true, photo: { assetId: 'a1', usage: 'layout' } });
    expect(editableOf(next)).toEqual({ layout: 'titulo-destaque', texts: { title: 'Novo', sub: 'só o título' }, logoHidden: true });
  });
});

describe('diff por campo', () => {
  it('só campos da lista, com antes, depois e contexto', () => {
    const next = { ...base, texts: { title: 'Seu bolo está pronto?', kicker: 'Dica', items: ['A', 'B2'] }, logoCorner: 'br', colors: { title: '#B83262' } };
    const d = diffDesigns(base, next, ctx);
    expect(d.map((e) => [e.field, e.op, e.before, e.after])).toEqual([
      ['texts.sub', 'remove', 'Confira sem abrir o forno', null],
      ['texts.items.1', 'set', 'B', 'B2'],
      ['texts.items.2', 'remove', 'C', null],
      ['logoCorner', 'set', 'bl', 'br'],
      ['colors.title', 'add', null, '#B83262'],
    ]);
    expect(d.every((e) => e.context === ctx)).toBe(true);
  });

  it('é o mesmo resultado para o mesmo par e vazio quando nada mudou', () => {
    const next = { ...base, logoCorner: 'tr' };
    expect(diffDesigns(base, next, ctx)).toEqual(diffDesigns(base, next, ctx));
    expect(diffDesigns(base, structuredClone(base), ctx)).toEqual([]);
  });

  it('escolher o canto que já era o padrão do layout não é mudança', () => {
    expect(defaultCorner('lista-numerada')).toBe('bl');
    expect(diffDesigns(base, { ...base, logoCorner: 'bl' }, ctx)).toEqual([]);
    expect(defaultCorner('foto-titulo')).toBe('br');
    expect(diffDesigns({ ...base, layout: 'foto-titulo' }, { ...base, layout: 'foto-titulo', logoCorner: 'br' }, ctx)).toEqual([]);
  });

  it('o resumo sai de template, em português, até 160 caracteres', () => {
    expect(summarize([])).toBe('Sem mudança');
    expect(summarize(diffDesigns(base, { ...base, texts: { ...base.texts, sub: undefined } }, ctx))).toBe('Subtítulo removido');
    expect(summarize(diffDesigns(base, { ...base, logoCorner: 'br' }, ctx))).toBe('Logo movido para o canto inferior direito');
    const multi = summarize(diffDesigns(base, { ...base, layout: 'titulo-destaque', logoHidden: true, colors: { title: '#B83262' } }, ctx));
    expect(multi).toBe('3 ajustes: layout trocado para título em destaque, logo escondido, cor do título alterada');
    const long = summarize(diffDesigns({ layout: 'lista-numerada', texts: { title: 'x', items: Array.from({ length: 10 }, (_, i) => `i${i}`) } }, { layout: 'titulo-destaque', texts: { title: 'y' }, logoHidden: true, colors: { title: '#111111', sub: '#111111', kicker: '#111111', items: '#111111' } }, ctx));
    expect(long.length).toBeLessThanOrEqual(160);
  });
});

describe('o revisor depois da edição manual', () => {
  const box = (over) => ({ id: 'title', x: 64, y: 100, w: 400, h: 120, size: 80, color: '#000000', bg: '#FFFFFF', bold: true, ...over });

  it('margem e fonte mínima travam só depois de edição manual', () => {
    const margin = reviewLayout([box({ x: 10 })], 1350);
    expect(margin.map((i) => i.rule)).toContain('safe_margin');
    expect(BLOCKING.has('safe_margin')).toBe(false);
    expect(editBlocking(margin).map((i) => i.rule)).toContain('safe_margin');
    const small = reviewLayout([box({ id: 'sub', size: 20, bold: false })], 1350);
    expect(editBlocking(small).map((i) => i.rule)).toContain('font_size');
  });

  it('fronteira do contraste: 4,5:1 passa e 4,49:1 não; título grande em negrito passa com 3:1', () => {
    // #767676 sobre branco = 4,54:1; #777777 = 4,48:1 (valores conhecidos do WCAG)
    expect(contrast('#767676', '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
    expect(contrast('#777777', '#FFFFFF')).toBeLessThan(4.5);
    const body = (color) => reviewLayout([box({ id: 'sub', size: 30, bold: false, color })], 1350);
    expect(editBlocking(body('#767676'))).toEqual([]);
    expect(editBlocking(body('#777777')).map((i) => i.rule)).toEqual(['contrast']);
    // título de 56 px ou mais em negrito aceita 3:1: #949494 = 3,03:1; #959595 fica abaixo de 3
    expect(contrast('#949494', '#FFFFFF')).toBeGreaterThanOrEqual(3);
    expect(contrast('#959595', '#FFFFFF')).toBeLessThan(3);
    expect(editBlocking(reviewLayout([box({ color: '#949494' })], 1350))).toEqual([]);
    expect(editBlocking(reviewLayout([box({ color: '#959595' })], 1350)).map((i) => i.rule)).toEqual(['contrast']);
  });

  it('a cor do texto escolhida entra no desenho e o contraste baixo é achado pelo render', () => {
    const brand = brandFromProfile({ colorPrimary: '#B83262', colorAccent: '#F2A9C4', fontHeading: 'Playfair Display', fontBody: 'Inter', instagramHandle: null });
    const spec = { kind: 'informativo', ratio: '1:1', layout: 'lista-numerada', texts: base.texts, brand };
    const ok = renderPng(spec, { fontDir: FONT_DIR });
    expect(editBlocking(ok.issues)).toEqual([]);
    const pale = renderPng({ ...spec, colors: { title: '#F8D7E3' } }, { fontDir: FONT_DIR });
    expect(editBlocking(pale.issues).map((i) => i.rule)).toContain('contrast');
    // o mesmo design gera o mesmo PNG; a prévia reduzida é só uma versão menor do mesmo desenho
    expect(renderPng(spec, { fontDir: FONT_DIR }).png.equals(ok.png)).toBe(true);
    expect(pale.png.equals(ok.png)).toBe(false);
    const small = renderPng(spec, { fontDir: FONT_DIR, width: 540 });
    expect(small.png.readUInt32BE(16)).toBe(540);
    expect(small.issues).toEqual(ok.issues);
  });

  it('logo escondido desenha sem o logo', () => {
    const brand = brandFromProfile(null);
    const logo = { dataUri: `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="#f00"/></svg>').toString('base64')}`, width: 10, height: 10 };
    const spec = { kind: 'informativo', ratio: '1:1', layout: 'titulo-destaque', texts: { title: 'Título' }, brand, logo };
    const withLogo = renderPng(spec, { fontDir: FONT_DIR });
    const hidden = renderPng({ ...spec, logoHidden: true }, { fontDir: FONT_DIR });
    expect(withLogo.svg).toContain('<image');
    expect(hidden.svg).not.toContain('<image');
  });
});
