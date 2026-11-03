import { describe, it, expect } from 'vitest';
import { eventSequencer } from '../platform/src/lib/site-read/events.ts';
import { applyEvent, formatElapsed, formatStamp, initialView, LOG_MAX } from '../platform/src/lib/site-read/progress-view.ts';

const RESULT = (over = {}) => ({
  read: { url: 'https://doceponto.com.br/', name: 'Doce Ponto', description: 'Doces', colors: ['#B83262'], fonts: { heading: null, body: null }, logoUrl: null },
  understanding: { about: { niche: 'Alimentação', offering: 'Bolos', audience: null, region: null }, voice: { formal: 2, technical: 2, serious: 3 }, differentiators: [], pains: [], facts: [{ text: 'Bolo de pote por R$ 12', category: 'oferta_preco' }], dropped: [] },
  notice: null,
  instagram: { state: 'not_connected', count: 0 },
  ...over,
});
const TIMING = { total_ms: 47000, steps: [] };

function run(steps, start = initialView()) {
  let t = 0;
  const seq = eventSequencer(() => t);
  let v = start;
  for (const [dt, fn] of steps) {
    t += dt;
    v = applyEvent(v, fn(seq));
  }
  return v;
}

describe('estado da tela de leitura', () => {
  it('começa vazio: tudo aguardando e nada acontecendo', () => {
    const v = initialView('doceponto.com.br');
    expect(v.phase).toBe('idle');
    expect([v.logo.status, v.colors.status, v.identity.status, v.voice.status, v.facts.status]).toEqual(['wait', 'wait', 'wait', 'wait', 'wait']);
    expect(v.instagram).toBeNull();
  });

  it('o histórico não repete "Abrindo": o começo da leitura só abre a tela e quem escreve a linha é o passo do site', () => {
    const v = run([
      [0, (s) => s.started('doceponto.com.br')],
      [5, (s) => s.step({ type: 'started', kind: 'site', label: 'Abrindo doceponto.com.br' })],
    ]);
    expect(v.phase).toBe('reading');
    expect(v.log.map((l) => l.text)).toEqual(['Abrindo doceponto.com.br']);
  });

  it('a leitura abre, mostra a frase de agora e o caminho da página, e conta as páginas lidas', () => {
    const v = run([
      [0, (s) => s.started('doceponto.com.br')],
      [800, (s) => s.step({ type: 'result', kind: 'sitemap', found: 38, chosen: 12 })],
      [1000, (s) => s.step({ type: 'started', kind: 'page', label: 'Lendo a página de produtos', url: 'https://doceponto.com.br/cardapio?x=1' })],
      [2000, (s) => s.step({ type: 'result', kind: 'page', url: 'https://doceponto.com.br/cardapio?x=1', chars: 900 })],
    ]);
    expect(v.phase).toBe('reading');
    expect(v.now).toEqual({ label: 'Lendo a página de produtos', path: '/cardapio' });
    expect(v.pages).toEqual({ read: 1, chosen: 12 });
    expect(v.log[0]).toMatchObject({ text: 'Lendo a página de produtos · /cardapio', tone: 'info' });
    expect(v.log.map((l) => l.text)).toContain('Achei 38 páginas no site. Vou ler 12.');
    expect(v.elapsedMs).toBe(3800);
  });

  it('logo, cores e identidade viram cartões prontos assim que chegam, ainda sem o modelo', () => {
    const v = run([
      [0, (s) => s.started('x')],
      [3000, (s) => s.step({ type: 'result', kind: 'logo', logoUrl: 'https://doceponto.com.br/logo.svg' })],
      [100, (s) => s.step({ type: 'result', kind: 'colors', colors: ['#B83262'], fonts: { heading: 'Playfair Display', body: null } })],
      [100, (s) => s.step({ type: 'result', kind: 'identity', name: 'Doce Ponto', description: 'Doces' })],
    ]);
    expect([v.logo.status, v.colors.status, v.identity.status]).toEqual(['done', 'done', 'done']);
    expect(v.voice.status).toBe('wait');
    expect(v.identity.name).toBe('Doce Ponto');
  });

  it('o que o site não tem vira aviso com o próximo passo, sem derrubar a leitura', () => {
    const v = run([
      [0, (s) => s.started('x')],
      [10, (s) => s.step({ type: 'result', kind: 'logo', logoUrl: null })],
      [10, (s) => s.step({ type: 'result', kind: 'colors', colors: [], fonts: { heading: null, body: null } })],
      [10, (s) => s.step({ type: 'result', kind: 'identity', name: null, description: null })],
    ]);
    expect([v.logo.status, v.colors.status, v.identity.status]).toEqual(['warn', 'warn', 'warn']);
    expect(v.logo.note).toMatch(/envia o arquivo depois/);
    expect(v.phase).toBe('reading');
  });

  it('página que não abriu entra como aviso e como contagem, e a leitura segue', () => {
    const v = run([
      [0, (s) => s.started('x')],
      [10, (s) => s.step({ type: 'result', kind: 'sitemap', found: 5, chosen: 2 })],
      [10, (s) => s.step({ type: 'failed', kind: 'page', message: 'Esta página não abriu.', url: 'https://doceponto.com.br/blog' })],
    ]);
    expect(v.skipped).toBe(1);
    expect(v.pages.read).toBe(1);
    expect(v.log[0]).toMatchObject({ tone: 'warn', text: '/blog: Esta página não abriu.' });
    expect(v.phase).toBe('reading');
  });

  it('modelo: começa a ler jeito de falar e fatos; se falha, os dois ficam com aviso', () => {
    const started = run([[0, (s) => s.started('x')], [10, (s) => s.step({ type: 'started', kind: 'model', label: 'Entendendo o jeito de falar da marca' })]]);
    expect([started.voice.status, started.facts.status]).toEqual(['load', 'load']);
    const failed = run([[10, (s) => s.step({ type: 'failed', kind: 'model', message: 'Não deu para ler os textos agora.' })]], started);
    expect([failed.voice.status, failed.facts.status]).toEqual(['warn', 'warn']);
    expect(failed.voice.note).toMatch(/Não deu/);
  });

  it('fim da leitura: guarda o resultado, o tempo e completa voz e fatos', () => {
    const v = run([
      [0, (s) => s.started('x')],
      [47000, (s) => s.done(RESULT(), TIMING)],
    ]);
    expect(v.phase).toBe('done');
    expect(v.doneMs).toBe(47000);
    expect(v.result.read.name).toBe('Doce Ponto');
    expect([v.voice.status, v.facts.status]).toEqual(['done', 'done']);
    expect(v.facts.count).toBe(1);
    expect(v.now).toBeNull();
  });

  it('fim sem entendimento do texto: voz e fatos com o aviso da leitura', () => {
    const v = run([[0, (s) => s.started('x')], [10, (s) => s.done(RESULT({ understanding: null, notice: 'Achamos pouco texto no site.' }), TIMING)]]);
    expect([v.voice.status, v.facts.status]).toEqual(['warn', 'warn']);
    expect(v.voice.note).toBe('Achamos pouco texto no site.');
  });

  it('falha total: guarda a frase e para', () => {
    const v = run([[0, (s) => s.started('x')], [10, (s) => s.failed('O site não respondeu a tempo.')]]);
    expect(v.phase).toBe('failed');
    expect(v.failure).toBe('O site não respondeu a tempo.');
    expect(v.log[0].tone).toBe('bad');
  });

  it('Instagram: só aparece para quem conectou, com leitura, resultado ou aviso', () => {
    expect(run([[0, (s) => s.started('x')]]).instagram).toBeNull();
    const ok = run([[0, (s) => s.step({ type: 'started', kind: 'instagram', label: 'Lendo as legendas do Instagram' })], [5, (s) => s.step({ type: 'result', kind: 'instagram', state: 'ok', count: 24 })]]);
    expect(ok.instagram).toEqual({ status: 'done', count: 24, note: null });
    const bad = run([[0, (s) => s.step({ type: 'failed', kind: 'instagram', message: 'A conexão com o Instagram venceu.' })]]);
    expect(bad.instagram.status).toBe('warn');
  });

  it('conexão que caiu e leitura recomeçada: o que chegou fica, a contagem zera, e o novo resultado substitui', () => {
    const first = run([
      [0, (s) => s.started('x')],
      [10, (s) => s.step({ type: 'result', kind: 'logo', logoUrl: 'https://doceponto.com.br/logo.svg' })],
      [10, (s) => s.step({ type: 'result', kind: 'page', url: 'https://doceponto.com.br/sobre', chars: 1 })],
    ]);
    const again = run([[0, (s) => s.started('x')]], first);
    expect(again.logo.status).toBe('done');
    expect(again.pages.read).toBe(0);
    expect(again.phase).toBe('reading');
    expect(again.skipped).toBe(0);
  });

  it('o histórico guarda só as últimas linhas, a mais nova primeiro', () => {
    const steps = [[0, (s) => s.started('x')], ...Array.from({ length: 20 }, (_, i) => [10, (s) => s.step({ type: 'started', kind: 'page', label: `Passo ${i}`, url: `https://doceponto.com.br/p${i}` })])];
    const v = run(steps);
    expect(v.log).toHaveLength(LOG_MAX);
    expect(v.log[0].text).toContain('Passo 19');
  });

  it('formata o tempo', () => {
    expect(formatElapsed(0)).toBe('0 s');
    expect(formatElapsed(47400)).toBe('47 s');
    expect(formatElapsed(65000)).toBe('1 min 5 s');
    expect(formatStamp(400)).toBe('0,4s');
    expect(formatStamp(9800)).toBe('9,8s');
    expect(formatStamp(23400)).toBe('23s');
  });
});
