// Modo ensaio de publicação: o parser do ambiente. Padrão live; valor desconhecido falha alto, porque
// errar para live num ambiente de teste posta em perfil real.
import { describe, it, expect } from 'vitest';
import { publishMode, rehearsalId, isRehearsalResult } from '../platform/src/lib/publish-mode.ts';

describe('PUBLISH_MODE', () => {
  it('sem valor ou vazio é live', () => {
    expect(publishMode({})).toBe('live');
    expect(publishMode({ PUBLISH_MODE: '' })).toBe('live');
    expect(publishMode({ PUBLISH_MODE: '  ' })).toBe('live');
  });

  it('aceita live e rehearsal, ignorando espaço nas pontas', () => {
    expect(publishMode({ PUBLISH_MODE: 'live' })).toBe('live');
    expect(publishMode({ PUBLISH_MODE: 'rehearsal' })).toBe('rehearsal');
    expect(publishMode({ PUBLISH_MODE: ' rehearsal ' })).toBe('rehearsal');
  });

  it('valor desconhecido falha com a lista do que vale', () => {
    expect(() => publishMode({ PUBLISH_MODE: 'dry-run' })).toThrow(/PUBLISH_MODE inválido: "dry-run"/);
    expect(() => publishMode({ PUBLISH_MODE: 'Rehearsal' })).toThrow(/live.*rehearsal/);
  });

  it('o id do ensaio não parece id da Meta e o resultado se reconhece', () => {
    expect(rehearsalId('c1')).toBe('rehearsal:c1');
    expect(isRehearsalResult({ id: 'rehearsal:c1', rehearsal: true })).toBe(true);
    expect(isRehearsalResult({ id: '17900' })).toBe(false);
  });
});
