// A lógica da tela de ajuste rápido (SPEC 019, BEZ-268) sem navegador: desfazer e refazer da sessão, o resumo
// do que mudou, o selo de contraste e o canto padrão (que precisa ser o mesmo do motor de render).
import { describe, it, expect } from 'vitest';
import { changesOf, summaryOf, startHistory, edit, undo, redo, resetTo, contrastTone, fmtRatio, withTitle, withSub, withCorner, withHidden, withTitleColor, withLayout, sameDesign, defaultCornerOf, cornerOf, LAYOUT_LABEL } from '../platform/src/lib/design-edit-view.ts';
import { defaultCorner, LAYOUTS } from '../platform/src/lib/design/model.ts';
import { parseEditable } from '../platform/src/lib/design/edit-model.ts';
import { summarize, diffDesigns } from '../platform/src/lib/design/diff.ts';

const base = { layout: 'lista-numerada', texts: { kicker: 'Dica', title: 'Seu bolo está pronto?', sub: 'Confira sem abrir o forno', items: ['a', 'b', 'c'] } };

describe('o que mudou, antes de confirmar', () => {
  it('uma frase por mudança, no mesmo texto do resumo que o servidor grava', () => {
    const next = withSub(withCorner(base, 'br'), null);
    expect(changesOf(base, next)).toEqual(['subtítulo removido', 'logo movido para o canto inferior direito']);
    expect(summaryOf(changesOf(base, next))).toBe('2 ajustes: subtítulo removido, logo movido para o canto inferior direito');
    expect(summaryOf(changesOf(base, withHidden(base, true)))).toBe('Logo escondido');
    expect(changesOf(base, base)).toEqual([]);
  });

  it.each([
    ['logo escondido', withHidden(base, true)],
    ['título alterado', withTitle(base, 'Outro título')],
    ['cor do título', withTitleColor(base, '#B83262')],
    ['layout', withLayout(base, 'titulo-destaque')],
    ['subtítulo removido', withSub(base, null)],
    ['canto do logo', withCorner(base, 'tr')],
  ])('%s: o resumo da tela é o mesmo do servidor', (_n, next) => {
    const parsed = parseEditable(next);
    expect(parsed.ok).toBe(true);
    const ctx = { kind: 'informativo', layout: next.layout, ratio: '1:1', goal: null };
    expect(summaryOf(changesOf(base, next))).toBe(summarize(diffDesigns(base, next, ctx)));
  });

  it('escolher o canto que já era o padrão não é mudança', () => {
    expect(changesOf(base, withCorner(base, 'bl'))).toEqual([]);
    expect(cornerOf(base)).toBe('bl');
  });

  it('o canto padrão e os nomes de layout cobrem todas as famílias, como no motor', () => {
    for (const l of LAYOUTS) {
      expect(defaultCornerOf(l)).toBe(defaultCorner(l));
      expect(LAYOUT_LABEL[l].name.length).toBeGreaterThan(3);
    }
  });
});

describe('desfazer, refazer e restaurar padrão', () => {
  it('cada edição entra na pilha; desfazer e refazer andam nela; editar depois de desfazer apaga o refazer', () => {
    let h = startHistory(base);
    h = edit(h, withCorner(base, 'br'));
    h = edit(h, withHidden(h.present, true));
    expect(h.past).toHaveLength(2);
    h = undo(h);
    expect(h.present.logoHidden).toBeUndefined();
    expect(h.present.logoCorner).toBe('br');
    h = redo(h);
    expect(h.present.logoHidden).toBe(true);
    h = undo(undo(h));
    expect(sameDesign(h.present, base)).toBe(true);
    expect(undo(h)).toBe(h);
    h = edit(h, withTitle(h.present, 'Novo'));
    expect(h.future).toEqual([]);
    expect(redo(h)).toBe(h);
  });

  it('edição que não muda nada não entra na pilha', () => {
    const h = startHistory(base);
    expect(edit(h, structuredClone(base))).toBe(h);
    expect(edit(h, withHidden(base, false))).toBe(h);
  });

  it('restaurar padrão volta à versão em uso e ainda dá para desfazer', () => {
    let h = edit(startHistory(base), withCorner(base, 'tr'));
    h = resetTo(h, base);
    expect(sameDesign(h.present, base)).toBe(true);
    h = undo(h);
    expect(h.present.logoCorner).toBe('tr');
  });
});

describe('contraste', () => {
  it('fronteiras do selo: 4,5:1 é Bom, 3:1 é No limite, abaixo é Baixo', () => {
    expect(contrastTone(4.5)).toEqual({ label: 'Bom', tone: 'success' });
    expect(contrastTone(4.49)).toEqual({ label: 'No limite', tone: 'warning' });
    expect(contrastTone(3)).toEqual({ label: 'No limite', tone: 'warning' });
    expect(contrastTone(2.99)).toEqual({ label: 'Baixo', tone: 'danger' });
    expect(contrastTone(undefined)).toBeNull();
    expect(fmtRatio(4.54)).toBe('4,5');
  });
});

describe('edições devolvem o design inteiro', () => {
  it('tirar a cor volta à da marca; esconder o logo tira a escolha de canto; subtítulo vazio é remoção', () => {
    expect(withTitleColor(withTitleColor(base, '#B83262'), null).colors).toBeUndefined();
    expect(withHidden(withCorner(base, 'br'), true).logoHidden).toBe(true);
    expect(withCorner(withHidden(base, true), 'tr').logoHidden).toBeUndefined();
    expect(withSub(base, '').texts).not.toHaveProperty('sub');
    expect(withSub(base, 'Novo').texts.sub).toBe('Novo');
  });
});
