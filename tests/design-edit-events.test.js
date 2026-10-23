// Os eventos do ajuste rápido (SPEC 019, BEZ-269): só número, enum, id do pedido e nomes curtos de campo.
// Nenhuma propriedade é descartada pela última barreira do analytics e nenhum texto do post sai.
import { describe, it, expect } from 'vitest';
import { revisionSavedProps, revisionRestoredProps, fieldKeys, parseSignal, signalEvent, approvedProps } from '../platform/src/lib/design-edit-events.ts';
import { sanitizeProps } from '../platform/src/lib/analytics.ts';
import { diffDesigns } from '../platform/src/lib/design/diff.ts';

const BRIEF = '11111111-2222-4333-8444-555555555555';
const ctx = { kind: 'informativo', layout: 'lista-numerada', ratio: '1:1', goal: 'ensinar' };

describe('propriedades dos eventos', () => {
  it('salvar leva contagem, nomes curtos de campo, custo de modelo zero e o tempo', () => {
    const before = { layout: 'lista-numerada', texts: { title: 'Segredo do bolo de pote', sub: 'Texto privado da empresa', items: ['a', 'b', 'c'] } };
    const after = { layout: 'titulo-destaque', texts: { title: 'Outro título com texto privado' }, logoCorner: 'br', colors: { title: '#B83262' } };
    const diff = diffDesigns(before, after, ctx);
    const props = revisionSavedProps({ briefId: BRIEF, version: 3, source: 'edit', diff, renderMs: 41.6, editMs: 8200 });
    expect(props).toEqual({ brief_id: BRIEF, version: 3, source: 'edit', fields_changed: diff.length, field_keys: 'layout,title,sub,items,logoCorner,color', render_ms: 42, model_calls: 0, edit_ms: 8200 });
    expect(JSON.stringify(props)).not.toMatch(/privado|Segredo|bolo|B83262/);
    const { dropped } = sanitizeProps(props);
    expect(dropped).toEqual([]);
  });

  it('sem tempo de sessão, o campo não vai; o tempo é limitado a 1 hora', () => {
    expect(revisionSavedProps({ briefId: BRIEF, version: 2, source: 'edit', diff: [], renderMs: 3, editMs: null })).not.toHaveProperty('edit_ms');
    expect(revisionSavedProps({ briefId: BRIEF, version: 2, source: 'edit', diff: [], renderMs: 3, editMs: 99_999_999 }).edit_ms).toBe(3_600_000);
  });

  it('os nomes dos campos são curtos e sem repetir', () => {
    expect(fieldKeys([{ field: 'texts.items.0' }, { field: 'texts.items.1' }, { field: 'colors.sub' }, { field: 'colors.title' }, { field: 'logoHidden' }])).toBe('items,color,logoHidden');
  });

  it('restaurar leva as duas versões e passa pelo filtro', () => {
    const props = revisionRestoredProps({ briefId: BRIEF, fromVersion: 1, toVersion: 4 });
    expect(props).toEqual({ brief_id: BRIEF, from_version: 1, to_version: 4 });
    expect(sanitizeProps(props).dropped).toEqual([]);
  });

  it('aprovar leva a versão aprovada e se foi editada', () => {
    expect(approvedProps({ briefId: BRIEF, version: 1 })).toEqual({ brief_id: BRIEF, design_version: 1, edited: false });
    expect(approvedProps({ briefId: BRIEF, version: 3 })).toEqual({ brief_id: BRIEF, design_version: 3, edited: true });
    expect(approvedProps({ briefId: null, version: 2 })).toEqual({ design_version: 2, edited: true });
    expect(approvedProps(null)).toEqual({});
    expect(sanitizeProps(approvedProps({ briefId: BRIEF, version: 3 })).dropped).toEqual([]);
  });
});

describe('sinal da tela', () => {
  it('descarte leva só o número de mudanças; desejo leva um valor da lista', () => {
    expect(parseSignal({ kind: 'discarded', edits: 3 })).toEqual({ ok: true, value: { kind: 'discarded', edits: 3 } });
    expect(parseSignal({ kind: 'wish', wish: 'move' })).toEqual({ ok: true, value: { kind: 'wish', wish: 'move' } });
    expect(signalEvent(BRIEF, { kind: 'discarded', edits: 2 })).toEqual({ event: 'design_edit_discarded', props: { brief_id: BRIEF, edits: 2 } });
    expect(signalEvent(BRIEF, { kind: 'wish', wish: 'resize' })).toEqual({ event: 'design_edit_wish', props: { brief_id: BRIEF, wish: 'resize' } });
  });

  it.each([
    [{ kind: 'discarded' }],
    [{ kind: 'discarded', edits: -1 }],
    [{ kind: 'discarded', edits: 1.5 }],
    [{ kind: 'discarded', edits: 5000 }],
    [{ kind: 'wish', wish: 'arrastar o logo para onde eu quiser' }],
    [{ kind: 'wish' }],
    [{ kind: 'outro' }],
    [null],
    ['x'],
  ])('recusa %j', (body) => {
    expect(parseSignal(body).ok).toBe(false);
  });
});
