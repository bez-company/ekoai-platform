import { describe, it, expect } from 'vitest';
import { parsePostRequest, wakeWorker, IDEA_MAX } from '../platform/src/lib/post-requests.ts';

describe('pedido de post', () => {
  it('exige a ideia e aceita o tipo opcional', () => {
    expect(parsePostRequest({ idea: '  bolo   pronto ', kind: '' })).toEqual({ ok: true, value: { idea: 'bolo pronto', kind: null, goal: null, ratio: '4:5' } });
    expect(parsePostRequest({ idea: 'x', kind: 'atmosfera' })).toEqual({ ok: true, value: { idea: 'x', kind: 'atmosfera', goal: null, ratio: '4:5' } });
    expect(parsePostRequest({ idea: '' })).toMatchObject({ ok: false, field: 'idea' });
    expect(parsePostRequest({ idea: 'x'.repeat(IDEA_MAX + 1) })).toMatchObject({ ok: false, field: 'idea' });
    expect(parsePostRequest({ idea: 'x', kind: 'reels' })).toMatchObject({ ok: false, field: 'kind' });
    expect(parsePostRequest(null)).toMatchObject({ ok: false });
  });

  it('objetivo decide a montagem e o formato é 4:5 ou 1:1 (SPEC 017 decisões 5 e 6)', () => {
    expect(parsePostRequest({ idea: 'x', goal: 'bastidores', ratio: '1:1' })).toEqual({ ok: true, value: { idea: 'x', kind: 'atmosfera', goal: 'bastidores', ratio: '1:1' } });
    expect(parsePostRequest({ idea: 'x', goal: 'promocao' })).toMatchObject({ ok: true, value: { kind: 'informativo', ratio: '4:5' } });
    // data comemorativa e "deixar a Ekoai escolher": o estrategista decide a montagem
    expect(parsePostRequest({ idea: 'x', goal: 'data_comemorativa' })).toMatchObject({ ok: true, value: { kind: null } });
    expect(parsePostRequest({ idea: 'x', goal: 'auto' })).toMatchObject({ ok: true, value: { kind: null, goal: 'auto' } });
    // o tipo escolhido à mão vale sobre o objetivo
    expect(parsePostRequest({ idea: 'x', goal: 'ensinar', kind: 'atmosfera' })).toMatchObject({ ok: true, value: { kind: 'atmosfera', goal: 'ensinar' } });
    expect(parsePostRequest({ idea: 'x', goal: 'reels' })).toMatchObject({ ok: false, field: 'goal' });
    expect(parsePostRequest({ idea: 'x', ratio: '9:16' })).toMatchObject({ ok: false, field: 'ratio' });
    expect(parsePostRequest({ idea: 'x', ratio: '1.91:1' })).toMatchObject({ ok: false, field: 'ratio' });
  });

  it('acorda o worker com o segredo do cron, sem esperar; sem configuração, só avisa', async () => {
    const calls = [];
    wakeWorker({ APP_BASE_URL: 'https://app.test', CRON_SECRET: 's3' }, async (url, init) => (calls.push({ url, auth: init.headers.authorization }), { ok: true }));
    expect(calls).toEqual([{ url: 'https://app.test/api/cron/generate', auth: 'Bearer s3' }]);
    const none = [];
    wakeWorker({}, async () => (none.push(1), { ok: true }));
    expect(none).toEqual([]);
    // chamada que falha não derruba o pedido
    expect(() => wakeWorker({ APP_BASE_URL: 'https://app.test', CRON_SECRET: 's3' }, async () => Promise.reject(new Error('down')))).not.toThrow();
  });
});

describe('foto do banco no pedido (BEZ-237)', () => {
  const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
  it('com foto o post é de atmosfera, qualquer que seja o objetivo', () => {
    expect(parsePostRequest({ idea: 'forno', goal: 'ensinar', asset_id: ID, photo_usage: 'background' })).toEqual({
      ok: true,
      value: { idea: 'forno', kind: 'atmosfera', goal: 'ensinar', ratio: '4:5', photo: { assetId: ID, usage: 'background' } },
    });
  });

  it('foto sem uso, ou uso sem foto, é recusado com o campo', () => {
    expect(parsePostRequest({ idea: 'x', asset_id: ID })).toMatchObject({ ok: false, field: 'photo_usage' });
    expect(parsePostRequest({ idea: 'x', photo_usage: 'as_is' })).toMatchObject({ ok: false, field: 'asset_id' });
  });

  it('o formato do carrossel (SPEC 023): só entra no valor quando é carrossel, e não vale com foto anexada', () => {
    expect(parsePostRequest({ idea: 'x', format: 'carousel' }).value).toMatchObject({ format: 'carousel' });
    expect(parsePostRequest({ idea: 'x', format: 'single' }).value.format).toBeUndefined();
    expect(parsePostRequest({ idea: 'x', format: '' }).value.format).toBeUndefined();
    expect(parsePostRequest({ idea: 'x', format: 'video' })).toMatchObject({ ok: false, field: 'format' });
    const withPhoto = parsePostRequest({ idea: 'x', format: 'carousel', asset_id: '11111111-2222-4333-8444-555555555555', photo_usage: 'as_is' });
    expect(withPhoto.ok).toBe(false);
  });

  it('quantidade de lâminas (SPEC 025): de 2 a 10, só no carrossel; ausente = a Ekoai decide', () => {
    expect(parsePostRequest({ idea: 'x', format: 'carousel', slide_count: 8 }).value).toMatchObject({ format: 'carousel', slideCount: 8 });
    expect(parsePostRequest({ idea: 'x', format: 'carousel', slide_count: '5' }).value.slideCount).toBe(5);
    expect(parsePostRequest({ idea: 'x', format: 'carousel' }).value.slideCount).toBeUndefined();
    expect(parsePostRequest({ idea: 'x', format: 'carousel', slide_count: '' }).value.slideCount).toBeUndefined();
    for (const bad of [1, 11, 2.5, 'x', -3]) expect(parsePostRequest({ idea: 'x', format: 'carousel', slide_count: bad }), String(bad)).toMatchObject({ ok: false, field: 'slide_count' });
    expect(parsePostRequest({ idea: 'x', slide_count: 4 })).toMatchObject({ ok: false, field: 'slide_count' });
    expect(parsePostRequest({ idea: 'x', format: 'single', slide_count: 4 })).toMatchObject({ ok: false, field: 'slide_count' });
  });
});

describe('estilo, esforço e qualidade da imagem (SPEC 030)', () => {
  it('sem nada, o pedido continua igual: Instantâneo, a Ekoai escolhe o estilo', () => {
    const r = parsePostRequest({ idea: 'x' });
    expect(r).toEqual({ ok: true, value: { idea: 'x', kind: null, goal: null, ratio: '4:5' } });
  });

  it('o estilo minimalista vira o tipo informativo, e o com imagem vira atmosfera', () => {
    expect(parsePostRequest({ idea: 'x', style: 'auto-minimalista' })).toMatchObject({ ok: true, value: { kind: 'informativo', style: 'auto-minimalista' } });
    expect(parsePostRequest({ idea: 'x', style: 'surreal-fotografico', image_quality: 'alta' })).toMatchObject({ ok: true, value: { kind: 'atmosfera', style: 'surreal-fotografico', imageQuality: 'alta' } });
    // O tipo escolhido à mão (pedido antigo) vale sobre o estilo.
    expect(parsePostRequest({ idea: 'x', style: 'auto-minimalista', kind: 'atmosfera' })).toMatchObject({ ok: true, value: { kind: 'atmosfera' } });
  });

  it('a qualidade da imagem é descartada quando o estilo não usa imagem', () => {
    const r = parsePostRequest({ idea: 'x', style: 'cartaz-tipografico', image_quality: 'alta' });
    expect(r).toMatchObject({ ok: true });
    expect(r.value.imageQuality).toBeUndefined();
  });

  it('recusa estilo, qualidade e esforço desconhecidos, com o campo', () => {
    expect(parsePostRequest({ idea: 'x', style: 'cartaz-feio' })).toMatchObject({ ok: false, field: 'style' });
    expect(parsePostRequest({ idea: 'x', image_quality: 'ultra' })).toMatchObject({ ok: false, field: 'image_quality' });
    expect(parsePostRequest({ idea: 'x', effort: 'turbo' })).toMatchObject({ ok: false, field: 'effort' });
  });

  it('nível que ainda não gera volta com o motivo, em vez de ser aceito em silêncio', () => {
    const r = parsePostRequest({ idea: 'x', effort: 'autoral' });
    expect(r).toMatchObject({ ok: false, field: 'effort' });
    expect(r.error).toContain('chega em breve');
    expect(parsePostRequest({ idea: 'x', effort: 'instantaneo' })).toMatchObject({ ok: true });
  });
});
