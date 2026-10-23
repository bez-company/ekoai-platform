import { describe, it, expect } from 'vitest';
import { factFromRow } from '../platform/src/lib/company-facts-model.ts';
import { dayLabel, factBadge, factDetail, factCounts, expiryBanner } from '../platform/src/lib/facts-view.ts';
import { factStanding } from '../platform/src/lib/company-facts-model.ts';

const TODAY = '2026-10-22';
const fact = (over = {}) => factFromRow({ id: '1', kind: 'fact', text: 'Frete grátis até 29/10', source: 'owner', source_note: null, active: true, created_at: '2026-10-01', status: 'confirmed', category: 'oferta_preco', proposed_by: 'person', verified_at: '2026-10-15T15:00:00Z', approved_by: 'u1', valid_until: '2026-12-15', expiry_notice: null, ...over });
const standing = (f) => factStanding(f, TODAY);

describe('tela de fatos: etiqueta e linha de detalhe', () => {
  it('cada estado tem a sua etiqueta e o seu tom', () => {
    expect(factBadge('valid', null)).toEqual({ label: 'Confirmado', tone: 'success' });
    expect(factBadge('soon', 7)).toEqual({ label: 'Vence em 7 dias', tone: 'warning' });
    expect(factBadge('soon', 1)).toEqual({ label: 'Vence amanhã', tone: 'warning' });
    expect(factBadge('soon', 0)).toEqual({ label: 'Vence hoje', tone: 'warning' });
    expect(factBadge('pending', null)).toEqual({ label: 'Para revisar', tone: 'warning' });
    expect(factBadge('expired', -3)).toEqual({ label: 'Vencido', tone: 'danger' });
    expect(factBadge('rejected', null)).toEqual({ label: 'Recusado', tone: 'neutral' });
    expect(factBadge('off', null)).toEqual({ label: 'Desligado', tone: 'neutral' });
  });

  it('a linha de detalhe diz a fonte, quem propôs, quando confirmou e até quando vale', () => {
    const ok = fact();
    expect(factDetail(ok, standing(ok).state, 'Texto da dona')).toBe('Texto da dona · Confirmado em 15/10 · Vale até 15/12');
    const open = fact({ valid_until: null, source_note: 'tabela de outubro' });
    expect(factDetail(open, standing(open).state, 'Texto da dona')).toBe('Texto da dona · tabela de outubro · Confirmado em 15/10 · Sem prazo');
    const old = fact({ valid_until: '2026-10-15' });
    expect(factDetail(old, standing(old).state, 'Texto da dona')).toBe('Texto da dona · Confirmado em 15/10 · Venceu em 15/10');
    const pending = fact({ status: 'pending', verified_at: null, proposed_by: 'agent', source: 'site', source_note: 'doceponto.example' });
    expect(factDetail(pending, standing(pending).state, 'Site da empresa')).toBe('Site da empresa · doceponto.example · Proposto pela Ekoai');
    const rejected = fact({ status: 'rejected', verified_at: null });
    expect(factDetail(rejected, standing(rejected).state, 'Site da empresa')).toBe('Site da empresa · Recusado');
    const off = fact({ active: false });
    expect(factDetail(off, standing(off).state, 'Texto da dona')).toContain('Desligado');
  });

  it('"nunca afirmar" só mostra a fonte', () => {
    const never = fact({ kind: 'never', status: 'confirmed', valid_until: null });
    expect(factDetail(never, standing(never).state, 'Texto da dona')).toBe('Texto da dona');
  });

  it('dayLabel vira DD/MM', () => {
    expect(dayLabel('2026-10-29')).toBe('29/10');
  });
});

describe('tela de fatos: contagens e aviso do alto', () => {
  const list = [
    fact({ id: 'a', valid_until: '2026-12-15' }),
    fact({ id: 'b', valid_until: '2026-10-29' }),
    fact({ id: 'c', valid_until: '2026-10-15' }),
    fact({ id: 'd', status: 'pending', verified_at: null }),
    fact({ id: 'e', status: 'pending', verified_at: null }),
    fact({ id: 'f', kind: 'never', valid_until: null }),
  ];

  it('conta só fatos (não "nunca afirmar") por estado', () => {
    expect(factCounts(list, TODAY)).toEqual({ all: 5, pending: 2, soon: 1, expired: 1 });
  });

  it('o aviso junta vencidos e a vencer, no singular e no plural, e some quando tudo está em dia', () => {
    expect(expiryBanner({ soon: 1, expired: 1 })).toBe('1 fato venceu e 1 fato vence em até 7 dias. Fato vencido não entra nos posts. Atualize a validade para voltar a usar.');
    expect(expiryBanner({ soon: 2, expired: 0 })).toBe('2 fatos vencem em até 7 dias. Atualize a validade para os posts continuarem usando.');
    expect(expiryBanner({ soon: 0, expired: 3 })).toBe('3 fatos venceram. Fato vencido não entra nos posts. Atualize a validade para voltar a usar.');
    expect(expiryBanner({ soon: 0, expired: 0 })).toBeNull();
  });
});
