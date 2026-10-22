import { describe, it, expect } from 'vitest';
import { usageFromIdea, ideaSaysWhatToWrite, buildQuestions, parseSuggestions, parsePhotoChoice, parseQuestionRequest, suggestionsPrompt, usageCallsImageModel, usageShowsPhoto } from '../platform/src/lib/photo-question-model.ts';

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';

describe('o que o pedido já diz', () => {
  it('uso da foto pelo texto, com ou sem acento', () => {
    expect(usageFromIdea('tenho uma foto de natureza, use de fundo')).toBe('background');
    expect(usageFromIdea('posta como está, só a legenda')).toBe('as_is');
    expect(usageFromIdea('Sem texto por favor')).toBe('as_is');
    expect(usageFromIdea('usa no layout da marca')).toBe('layout');
    expect(usageFromIdea('quero uma imagem inspirada nessa foto')).toBe('inspiration');
    expect(usageFromIdea('bolo de pote de ninho')).toBeNull();
  });

  it('assunto do post: três palavras que não falam da foto', () => {
    expect(ideaSaysWhatToWrite('abrimos domingo às 9h com bolo quente')).toBe(true);
    expect(ideaSaysWhatToWrite('tenho uma foto, use de fundo')).toBe(false);
    expect(ideaSaysWhatToWrite('')).toBe(false);
  });
});

describe('no máximo 2 perguntas', () => {
  it('pedido vazio: as duas, com as sugestões da foto e "Escrever eu" por último', () => {
    const q = buildQuestions('', ['Forno aceso às 5h', 'A massa descansando']);
    expect(q.questions.map((x) => x.id)).toEqual(['usage', 'text']);
    expect(q.questions[0].options.map((o) => o.value)).toEqual(['as_is', 'background', 'layout', 'inspiration']);
    expect(q.questions[1].options).toEqual([{ value: 's1', label: 'Forno aceso às 5h' }, { value: 's2', label: 'A massa descansando' }, { value: 'own', label: 'Escrever eu' }]);
    expect(q.describe).toBe(true);
  });

  it('"use de fundo" responde a primeira; o assunto dito responde a segunda', () => {
    expect(buildQuestions('use de fundo', []).questions.map((x) => x.id)).toEqual(['text']);
    expect(buildQuestions('use de fundo', []).inferredUsage).toBe('background');
    const none = buildQuestions('de fundo: abrimos domingo às 9h com bolo quente', []);
    expect(none).toEqual({ questions: [], inferredUsage: 'background', describe: false });
  });
});

describe('parsers', () => {
  it('sugestões da visão: até 3, sem repetidas, sem travessão, cortadas', () => {
    expect(parseSuggestions({ suggestions: [' Forno  aceso ', 'Forno aceso', 'Massa — descanso', 3, 'x'.repeat(200), 'quinta'] })).toEqual(['Forno aceso', 'Massa , descanso', 'x'.repeat(120)]);
    expect(parseSuggestions(null)).toEqual([]);
  });

  it('foto no pedido: as duas juntas ou nenhuma', () => {
    expect(parsePhotoChoice({})).toEqual({ ok: true, value: null });
    expect(parsePhotoChoice({ asset_id: ID, photo_usage: 'as_is' })).toEqual({ ok: true, value: { assetId: ID, usage: 'as_is' } });
    expect(parsePhotoChoice({ asset_id: ID })).toMatchObject({ ok: false, field: 'photo_usage' });
    expect(parsePhotoChoice({ photo_usage: 'as_is' })).toMatchObject({ ok: false, field: 'asset_id' });
    expect(parsePhotoChoice({ asset_id: '../x', photo_usage: 'as_is' })).toMatchObject({ ok: false, field: 'asset_id' });
  });

  it('pedido de perguntas exige o id da foto', () => {
    expect(parseQuestionRequest({ assetId: ID, idea: '  use   de fundo ' })).toEqual({ ok: true, value: { assetId: ID, idea: 'use de fundo' } });
    expect(parseQuestionRequest({ idea: 'x' })).toMatchObject({ ok: false, field: 'assetId' });
  });

  it('limite e foto à mostra por uso', () => {
    expect(['as_is', 'background', 'layout', 'inspiration'].map(usageCallsImageModel)).toEqual([false, false, false, true]);
    expect(['as_is', 'background', 'layout', 'inspiration'].map(usageShowsPhoto)).toEqual([true, true, true, false]);
  });

  it('o pedido à visão leva o ramo e o que a pessoa disse', () => {
    const p = suggestionsPrompt({ niche: 'Confeitaria', idea: 'use de fundo' });
    expect(p).toContain('Ramo: Confeitaria.');
    expect(p).toContain('O que a pessoa disse: use de fundo');
  });
});
