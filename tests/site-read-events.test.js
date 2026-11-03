import { describe, it, expect } from 'vitest';
import { HEARTBEAT, createSseReader, encodeEvent, eventSequencer, parseReadEvent } from '../platform/src/lib/site-read/events.ts';

const RESULT = { read: { url: 'https://doceponto.com.br/', name: 'Doce Ponto', description: null, colors: ['#B83262'], fonts: { heading: null, body: null }, logoUrl: null }, understanding: null, notice: null, instagram: { state: 'not_connected', count: 0 } };
const TIMING = { total_ms: 900, steps: [{ kind: 'site', path: null, ms: 300, ok: true }] };

function sequence() {
  let t = 100;
  const seq = eventSequencer(() => t);
  const out = [seq.started('doceponto.com.br')];
  t += 400;
  out.push(seq.step({ type: 'started', kind: 'page', label: 'Lendo uma página do site', url: 'https://doceponto.com.br/sobre' }));
  t += 300;
  out.push(seq.step({ type: 'result', kind: 'page', url: 'https://doceponto.com.br/sobre', chars: 1200 }));
  out.push(seq.step({ type: 'failed', kind: 'page', message: 'Esta página não abriu.', url: 'https://doceponto.com.br/blog' }));
  out.push(seq.step({ type: 'result', kind: 'colors', colors: ['#B83262', '#4A2C2A'], fonts: { heading: 'Playfair Display', body: null } }));
  out.push(seq.done(RESULT, TIMING));
  return out;
}

describe('eventos da leitura: numeração e tempo', () => {
  it('numera de 1 em 1 e conta o tempo desde o começo', () => {
    const e = sequence();
    expect(e.map((x) => x.seq)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(e.map((x) => x.t)).toEqual([0, 400, 700, 700, 700, 700]);
    expect(e.map((x) => x.type)).toEqual(['read.started', 'step.started', 'step.result', 'step.failed', 'step.result', 'read.done']);
  });

  it('o resultado do passo leva os campos do tipo e perde o "type" de passo', () => {
    const [, , result, failed] = sequence();
    expect(result).toMatchObject({ type: 'step.result', kind: 'page', chars: 1200 });
    expect(failed).toMatchObject({ type: 'step.failed', kind: 'page', url: 'https://doceponto.com.br/blog' });
  });
});

describe('eventos da leitura: conferência na fronteira', () => {
  it('todo evento que o servidor gera passa pela conferência igual', () => {
    for (const e of sequence()) expect(parseReadEvent(JSON.parse(JSON.stringify(e)))).toEqual(e);
    const seq = eventSequencer(() => 0);
    const all = [
      seq.step({ type: 'result', kind: 'site' }),
      seq.step({ type: 'result', kind: 'model' }),
      seq.step({ type: 'result', kind: 'sitemap', found: 38, chosen: 12 }),
      seq.step({ type: 'result', kind: 'css', count: 2 }),
      seq.step({ type: 'result', kind: 'logo', logoUrl: null }),
      seq.step({ type: 'result', kind: 'identity', name: 'Doce Ponto', description: null }),
      seq.step({ type: 'result', kind: 'instagram', state: 'ok', count: 24 }),
      seq.failed('O site não respondeu.'),
    ];
    for (const e of all) expect(parseReadEvent(JSON.parse(JSON.stringify(e)))).toEqual(e);
  });

  it('recusa o que não tem a forma do contrato', () => {
    const ruins = [
      null, 'texto', [], {},
      { type: 'step.started', seq: 1, t: 0, kind: 'inventado', label: 'x' },
      { type: 'step.started', seq: 0.5, t: 0, kind: 'site', label: 'x' },
      { type: 'step.started', seq: -1, t: 0, kind: 'site', label: 'x' },
      { type: 'step.started', seq: 1, t: 0, kind: 'site', label: 42 },
      { type: 'step.result', seq: 1, t: 0, kind: 'css', count: 'dois' },
      { type: 'step.result', seq: 1, t: 0, kind: 'colors', colors: [1], fonts: { heading: null, body: null } },
      { type: 'step.result', seq: 1, t: 0, kind: 'colors', colors: [], fonts: null },
      { type: 'step.result', seq: 1, t: 0, kind: 'page', url: 'x'.repeat(3000), chars: 1 },
      { type: 'read.done', seq: 1, t: 0, result: {}, timing: TIMING },
      { type: 'read.done', seq: 1, t: 0, result: RESULT, timing: { total_ms: 'a', steps: [] } },
      { type: 'read.failed', seq: 1, t: 0, message: 'x'.repeat(700) },
      { type: 'desconhecido', seq: 1, t: 0 },
    ];
    for (const r of ruins) expect(parseReadEvent(r), JSON.stringify(r)?.slice(0, 80)).toBeNull();
  });

  it('endereço de página vem só quando é texto de tamanho razoável', () => {
    expect(parseReadEvent({ type: 'step.started', seq: 1, t: 0, kind: 'page', label: 'x', url: 42 })).toEqual({ type: 'step.started', seq: 1, t: 0, kind: 'page', label: 'x' });
  });
});

describe('leitor do fluxo', () => {
  const wire = sequence().map(encodeEvent).join(HEARTBEAT);

  it('entrega os eventos na ordem, mesmo com o texto partido em qualquer ponto', () => {
    for (const size of [1, 7, 64, wire.length]) {
      const got = [];
      const reader = createSseReader((e) => got.push(e));
      for (let i = 0; i < wire.length; i += size) reader.push(wire.slice(i, i + size));
      reader.end();
      expect(got.map((e) => e.seq), `pedaços de ${size}`).toEqual([1, 2, 3, 4, 5, 6]);
    }
  });

  it('descarta comentário, JSON quebrado, quadro sem dados, evento fora do contrato e seq repetido ou voltando', () => {
    const got = [];
    const reader = createSseReader((e) => got.push(e.seq));
    const [a, b, c] = sequence();
    reader.push(encodeEvent(a));
    reader.push(': ping\n\n');
    reader.push('id: 9\nevent: x\ndata: {isto não é json\n\n');
    reader.push('id: 9\nevent: x\n\n');
    reader.push(`data: ${JSON.stringify({ type: 'step.started', seq: 7, t: 0, kind: 'nada', label: 'x' })}\n\n`);
    reader.push(encodeEvent(b));
    reader.push(encodeEvent(b));
    reader.push(encodeEvent(a));
    reader.push(encodeEvent(c));
    expect(got).toEqual([1, 2, 3]);
  });

  it('aceita quebra de linha do Windows e o último quadro sem a linha em branco', () => {
    const got = [];
    const reader = createSseReader((e) => got.push(e.seq));
    const [a, b] = sequence();
    reader.push(encodeEvent(a).replace(/\n/g, '\r\n'));
    reader.push(encodeEvent(b).trimEnd());
    expect(got).toEqual([1]);
    reader.end();
    expect(got).toEqual([1, 2]);
  });
});
