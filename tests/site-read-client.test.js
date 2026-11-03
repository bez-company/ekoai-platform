import { describe, it, expect } from 'vitest';
import { encodeEvent, eventSequencer } from '../platform/src/lib/site-read/events.ts';
import { streamSiteRead } from '../platform/src/components/profile/site-read-stream.ts';

const RESULT = { read: { url: 'https://doceponto.com.br/', name: 'Doce Ponto', description: null, colors: [], fonts: { heading: null, body: null }, logoUrl: null }, understanding: null, notice: null, instagram: { state: 'not_connected', count: 0 } };

function frames({ end = true } = {}) {
  const seq = eventSequencer(() => 0);
  const list = [seq.started('doceponto.com.br'), seq.step({ type: 'result', kind: 'logo', logoUrl: null })];
  if (end) list.push(seq.done(RESULT, { total_ms: 1, steps: [] }));
  return list.map(encodeEvent).join('');
}

// Corpo em pedaços de `size` letras, como a rede entrega.
const streamOf = (text, size = 9) =>
  new ReadableStream({
    start(c) {
      const enc = new TextEncoder();
      for (let i = 0; i < text.length; i += size) c.enqueue(enc.encode(text.slice(i, i + size)));
      c.close();
    },
  });
const sse = (text, size) => new Response(streamOf(text, size), { status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8' } });
const json = (status, error) => new Response(JSON.stringify({ error }), { status, headers: { 'content-type': 'application/json' } });

describe('cliente da leitura em tempo real', () => {
  it('lê o fluxo partido em pedaços e termina quando chega o fim da leitura', async () => {
    const got = [];
    const out = await streamSiteRead('doceponto.com.br', (e) => got.push(e.type), undefined, async () => sse(frames()));
    expect(out).toEqual({ kind: 'finished' });
    expect(got).toEqual(['read.started', 'step.result', 'read.done']);
  });

  it('fluxo que acaba sem o fim: a conexão caiu', async () => {
    const got = [];
    const out = await streamSiteRead('x.com.br', (e) => got.push(e.type), undefined, async () => sse(frames({ end: false })));
    expect(out).toEqual({ kind: 'dropped' });
    expect(got).toEqual(['read.started', 'step.result']);
  });

  it('o fim por erro da leitura também é fim', async () => {
    const seq = eventSequencer(() => 0);
    const text = [seq.started('x'), seq.failed('O site não respondeu a tempo.')].map(encodeEvent).join('');
    const got = [];
    expect(await streamSiteRead('x', (e) => got.push(e), undefined, async () => sse(text))).toEqual({ kind: 'finished' });
    expect(got.at(-1)).toMatchObject({ type: 'read.failed', message: 'O site não respondeu a tempo.' });
  });

  it('recusa com a frase da pessoa (400, 401, 403, 429) volta como recusa, sem eventos', async () => {
    for (const status of [400, 401, 403, 429]) {
      const out = await streamSiteRead('x', () => { throw new Error('não devia chamar'); }, undefined, async () => json(status, 'Muitas leituras. Tente de novo em 2 minutos.'));
      expect(out).toEqual({ kind: 'refused', error: 'Muitas leituras. Tente de novo em 2 minutos.' });
    }
  });

  it('problema nosso ou rota ausente (404, 500), corpo que não é fluxo e rede fora: indisponível, para usar a resposta única', async () => {
    for (const make of [async () => json(500, 'x'), async () => new Response('nada', { status: 404 }), async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }), async () => { throw new TypeError('Failed to fetch'); }]) {
      expect(await streamSiteRead('x', () => {}, undefined, make)).toEqual({ kind: 'unavailable' });
    }
  });

  it('manda o endereço no corpo, em POST, pedindo o fluxo', async () => {
    let seen;
    await streamSiteRead('doceponto.com.br', () => {}, undefined, async (url, init) => ((seen = { url, init }), sse(frames())));
    expect(seen.url).toBe('/api/profile/site-read/stream');
    expect(seen.init.method).toBe('POST');
    expect(JSON.parse(seen.init.body)).toEqual({ site_url: 'doceponto.com.br' });
    expect(seen.init.headers.accept).toBe('text/event-stream');
  });

  it('cancelar no meio não é queda: termina sem tentar de novo', async () => {
    const ctl = new AbortController();
    const body = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(frames({ end: false }).slice(0, 30))); ctl.abort(); c.error(new DOMException('abortado', 'AbortError')); } });
    const out = await streamSiteRead('x', () => {}, ctl.signal, async () => new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }));
    expect(out).toEqual({ kind: 'finished' });
  });
});

describe('leitura com nova tentativa e reserva', async () => {
  const { readLive } = await import('../platform/src/components/profile/site-read-live.ts');
  const doneEvent = () => eventSequencer(() => 0).done(RESULT, { total_ms: 1, steps: [] });
  const failedEvent = (m) => eventSequencer(() => 0).failed(m);
  // Um fluxo de mentira: cada chamada entrega os eventos da vez e devolve como terminou.
  const script = (...rounds) => {
    const calls = [];
    const stream = async (site, onEvent) => {
      const round = rounds.shift();
      calls.push(site);
      for (const e of round.events ?? []) onEvent(e);
      return round.out;
    };
    return { stream, calls };
  };
  const plain = (res) => async () => res;
  const state = () => ({ reconnect: [], plainUsed: 0 });

  it('fluxo que termina bem: devolve o resultado e não toca na reserva', async () => {
    const s = script({ events: [doneEvent()], out: { kind: 'finished' } });
    const st = state();
    const out = await readLive('x', { onEvent: () => {}, stream: s.stream, onReconnecting: (v) => st.reconnect.push(v), onPlain: () => (st.plainUsed += 1), plain: plain({ ok: false, error: 'não devia' }) });
    expect(out).toMatchObject({ ok: true, res: { read: { name: 'Doce Ponto' } } });
    expect(s.calls).toHaveLength(1);
    expect(st).toEqual({ reconnect: [], plainUsed: 0 });
  });

  it('conexão cai uma vez: avisa, lê de novo e entrega o resultado da segunda', async () => {
    const s = script({ out: { kind: 'dropped' } }, { events: [doneEvent()], out: { kind: 'finished' } });
    const st = state();
    const out = await readLive('x', { onEvent: () => {}, stream: s.stream, onReconnecting: (v) => st.reconnect.push(v), onPlain: () => (st.plainUsed += 1) });
    expect(out.ok).toBe(true);
    expect(s.calls).toHaveLength(2);
    expect(st.reconnect).toEqual([true, false]);
    expect(st.plainUsed).toBe(0);
  });

  it('cai duas vezes: usa a resposta única', async () => {
    const s = script({ out: { kind: 'dropped' } }, { out: { kind: 'dropped' } });
    const st = state();
    const out = await readLive('x', { onEvent: () => {}, stream: s.stream, onPlain: () => (st.plainUsed += 1), plain: plain({ ok: true, res: { read: { name: 'da reserva' } } }) });
    expect(out).toEqual({ ok: true, res: { read: { name: 'da reserva' } } });
    expect(st.plainUsed).toBe(1);
  });

  it('fluxo indisponível: vai direto para a resposta única, sem nova tentativa', async () => {
    const s = script({ out: { kind: 'unavailable' } });
    const out = await readLive('x', { onEvent: () => {}, stream: s.stream, plain: plain({ ok: false, error: 'Sem conexão. Confira a rede e tente de novo.' }) });
    expect(s.calls).toHaveLength(1);
    expect(out).toEqual({ ok: false, error: 'Sem conexão. Confira a rede e tente de novo.' });
  });

  it('erro da leitura dentro do fluxo vira a frase de erro, sem reserva', async () => {
    const s = script({ events: [failedEvent('O site não respondeu a tempo.')], out: { kind: 'finished' } });
    const out = await readLive('x', { onEvent: () => {}, stream: s.stream, plain: plain({ ok: true, res: {} }) });
    expect(out).toEqual({ ok: false, error: 'O site não respondeu a tempo.' });
  });

  it('recusa antes de abrir (teto por hora, sem permissão) vira a frase da rota, sem reserva', async () => {
    const s = script({ out: { kind: 'refused', error: 'Muitas leituras. Tente de novo em 2 minutos.' } });
    const out = await readLive('x', { onEvent: () => {}, stream: s.stream, plain: plain({ ok: true, res: {} }) });
    expect(out).toEqual({ ok: false, error: 'Muitas leituras. Tente de novo em 2 minutos.' });
  });

  it('cancelada: não tenta de novo nem usa a reserva', async () => {
    const ctl = new AbortController();
    const s = script({ out: { kind: 'dropped' } });
    ctl.abort();
    const out = await readLive('x', { onEvent: () => {}, stream: s.stream, signal: ctl.signal, plain: plain({ ok: true, res: {} }) });
    expect(out).toEqual({ ok: false, error: 'A leitura foi cancelada.' });
    expect(s.calls).toHaveLength(1);
  });
});
