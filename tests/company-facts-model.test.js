import { describe, it, expect } from 'vitest';
import { parseFactInput, parseFactPatch, factFromRow, factsForPrompt, FACT_MAX } from '../platform/src/lib/company-facts-model.ts';

describe('fatos da empresa: entrada', () => {
  it('aceita fato com fonte e limpa espaços', () => {
    const r = parseFactInput({ kind: 'fact', text: '  Entregamos no mesmo   dia em Marília ', source: 'site', source_note: ' doceponto.com.br/entrega ', tenant_id: 'x' });
    expect(r).toEqual({ ok: true, value: { kind: 'fact', text: 'Entregamos no mesmo dia em Marília', source: 'site', source_note: 'doceponto.com.br/entrega' } });
  });

  it('sem fonte vale "quem administra"; sem texto ou texto longo recusa com o campo', () => {
    expect(parseFactInput({ kind: 'never', text: 'garantia de resultado' })).toMatchObject({ ok: true, value: { source: 'owner', source_note: null } });
    expect(parseFactInput({ kind: 'fact', text: '' })).toMatchObject({ ok: false, field: 'text' });
    expect(parseFactInput({ kind: 'fact', text: 'x'.repeat(FACT_MAX + 1) })).toMatchObject({ ok: false, field: 'text' });
    expect(parseFactInput({ kind: 'promessa', text: 'x' })).toMatchObject({ ok: false, field: 'kind' });
    expect(parseFactInput({ kind: 'fact', text: 'x', source: 'tv' })).toMatchObject({ ok: false, field: 'source' });
  });

  it('o patch exige id válido e pelo menos um campo', () => {
    expect(parseFactPatch({ id: 'nope', active: false })).toMatchObject({ ok: false });
    const id = '11111111-2222-4333-8444-555555555555';
    expect(parseFactPatch({ id })).toMatchObject({ ok: false, error: 'Nada para alterar.' });
    expect(parseFactPatch({ id, active: false })).toEqual({ ok: true, value: { id, active: false } });
    expect(parseFactPatch({ id, text: ' novo ', source_note: '' })).toEqual({ ok: true, value: { id, text: 'novo', source_note: null } });
    expect(parseFactPatch({ id, active: 'sim' })).toMatchObject({ ok: false, field: 'active' });
  });
});

describe('fatos da empresa: saída', () => {
  it('converte a linha e separa o que vai ao agente (só os ativos)', () => {
    const rows = [
      { id: '1', kind: 'fact', text: 'Sem conservantes', source: 'owner', source_note: null, active: true, created_at: new Date('2026-10-21T00:00:00Z') },
      { id: '2', kind: 'fact', text: 'Fato desligado', source: 'site', source_note: 'x', active: false, created_at: '2026-10-21' },
      { id: '3', kind: 'never', text: 'cura', source: 'owner', source_note: null, active: true, created_at: '2026-10-21' },
    ].map(factFromRow);
    expect(rows[0]).toMatchObject({ id: '1', createdAt: '2026-10-21T00:00:00.000Z', active: true });
    expect(factsForPrompt(rows)).toEqual({ facts: ['Sem conservantes'], never: ['cura'] });
  });
});
