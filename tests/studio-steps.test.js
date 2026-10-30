import { describe, it, expect } from 'vitest';
import { studioSteps, timeSentence } from '../platform/src/lib/generation-steps.ts';

describe('etapas do estúdio na tela "Criando o post"', () => {
  it('o Refinado mostra os agentes do nível, na ordem, sem o Refino', () => {
    const steps = studioSteps('refinado', 'designer', 'generating');
    expect(steps.map((s) => s.title)).toEqual(['Ideia', 'Texto', 'Arte', 'Design', 'Crítica', 'Revisão']);
    expect(steps.map((s) => s.state)).toEqual(['done', 'done', 'done', 'run', 'todo', 'todo']);
  });

  it('o Autoral tem todos os sete agentes; o embelezador acende o Refino', () => {
    const steps = studioSteps('autoral', 'embelezador', 'generating');
    expect(steps.map((s) => s.title)).toHaveLength(7);
    expect(steps.find((s) => s.title === 'Refino')?.state).toBe('run');
    expect(steps.find((s) => s.title === 'Crítica')?.state).toBe('done');
  });

  it('sem etapa registrada ainda, o primeiro agente corre; etapa desconhecida também', () => {
    expect(studioSteps('refinado', null, 'generating')[0].state).toBe('run');
    expect(studioSteps('refinado', 'inventada', 'generating').map((s) => s.state)).toEqual(['run', 'todo', 'todo', 'todo', 'todo', 'todo']);
  });

  it('pronto marca tudo feito; falha marca a etapa em curso', () => {
    expect(studioSteps('refinado', 'revisor', 'ready').every((s) => s.state === 'done')).toBe(true);
    const failed = studioSteps('refinado', 'critico', 'failed');
    expect(failed.map((s) => s.state)).toEqual(['done', 'done', 'done', 'done', 'fail', 'todo']);
  });

  it('a frase de tempo vem do nível', () => {
    expect(timeSentence('instantaneo')).toBe('Leva cerca de 1 minuto.');
    expect(timeSentence('refinado')).toBe('Leva cerca de 10 minutos.');
    expect(timeSentence('autoral')).toBe('Leva cerca de 15 minutos.');
  });
});
