// O painel "O que você pediu" (SPEC 020, entrega d): o que a tela mostra para cada estado, a ordem dos itens e
// o próximo passo; e as etapas de "Criando o post" com a leitura do pedido na frente.
import { describe, it, expect } from 'vitest';
import { requestPanelOf, UNREAD_MESSAGE } from '../platform/src/lib/request-panel.ts';
import { directiveItems, composeDesign, planDirectives } from '../platform/src/lib/directives-apply.ts';
import { STEPS, stateOf } from '../platform/src/lib/generation-steps.ts';

const IDEA = 'Imagem de abertura: fundo escuro, o logo grande no centro, o nome da casa embaixo e o @ no canto.';
const pending = (directives, idea = IDEA) => ({ generation: { variations: [], ...(directives ? { directives } : {}) }, seed: { idea } });

describe('painel do Aprovar', () => {
  it('sem instrução, ou post de antes da SPEC 020, não tem painel', () => {
    expect(requestPanelOf(pending(null))).toBeNull();
    expect(requestPanelOf(pending({ status: 'ok', items: [] }))).toBeNull();
    expect(requestPanelOf({ generation: null, seed: null })).toBeNull();
  });

  it('tudo aplicado: uma linha por instrução, na ordem do pedido, e o rodapé de quem pode ajustar', () => {
    const p = requestPanelOf(pending({ status: 'ok', items: [{ text: '3 itens', ok: true }, { text: 'O logo: canto inferior esquerdo', ok: true }] }, 'Três sinais, logo embaixo à esquerda'));
    expect(p).toMatchObject({ state: 'applied', idea: 'Três sinais, logo embaixo à esquerda' });
    expect(p.rows.map((r) => [r.text, r.ok])).toEqual([['3 itens', true], ['O logo: canto inferior esquerdo', true]]);
    expect(p.footer).toBe('Tudo o que você pediu está no post. Quer mudar algo? Use Pedir ajuste.');
  });

  it('uma não aplicada: motivo, próximo passo (logo e @ levam ao perfil) e o aviso de que não trava a aprovação', () => {
    const p = requestPanelOf(pending({ status: 'ok', items: [{ text: 'Fundo escuro', ok: true }, { text: 'O logo: centro', ok: false, why: 'A conta não tem logo cadastrado. Envie o logo no perfil da empresa.' }, { text: 'O @: canto inferior direito', ok: false, why: 'A conta não tem @ cadastrado no perfil.' }, { text: '5 itens', ok: false, why: 'A lista leva no máximo 4 itens por imagem. O post saiu com 4.' }] }));
    expect(p.state).toBe('partial');
    expect(p.rows[1]).toMatchObject({ ok: false, action: { label: 'Enviar o logo', href: '/configuracoes/empresa' } });
    expect(p.rows[2].action).toEqual({ label: 'Cadastrar o @', href: '/configuracoes/empresa' });
    expect(p.rows[3].action).toBeUndefined(); // limite de itens não tem o que resolver no perfil
    expect(p.footer).toContain('não trava a aprovação');
  });

  it('não consegui ler: só o aviso, com o pedido original à vista e sem lista', () => {
    const p = requestPanelOf(pending({ status: 'failed', items: [] }));
    expect(p).toEqual({ state: 'unread', idea: IDEA });
    expect(UNREAD_MESSAGE).toContain('Não consegui ler as instruções do pedido');
    expect(UNREAD_MESSAGE).not.toMatch(/[—–]/);
  });

  it('post gerado antes de `items` usa as duas listas antigas, aplicadas primeiro', () => {
    const p = requestPanelOf(pending({ status: 'ok', applied: ['Fundo escuro'], notApplied: [{ what: 'O logo', why: 'A conta não tem logo cadastrado.' }] }));
    expect(p.rows.map((r) => [r.text, r.ok])).toEqual([['Fundo escuro', true], ['O logo', false]]);
    expect(p.rows[1].action.label).toBe('Enviar o logo');
  });
});

describe('itens guardados pela geração', () => {
  const S = { kind: null, hasLogo: false, hasHandle: true, brandName: 'Casa Aurora' };
  const copy = { kind: 'informativo', texts: { title: 'T' } };

  it('na ordem do pedido, com o motivo de cada não aplicada', () => {
    const d = { background: 'dark', elements: { logo: 'c', name: 'bc', handle: 'br' } };
    const pieces = composeDesign(d, planDirectives(d, S), copy, S);
    expect(directiveItems(d, pieces)).toEqual([
      { text: 'Fundo escuro', ok: true },
      { text: 'O logo: centro', ok: false, why: 'A conta não tem logo cadastrado. Envie o logo no perfil da empresa.' },
      { text: 'O nome da empresa: base, no centro', ok: true },
      { text: 'O @: canto inferior direito', ok: true },
    ]);
  });

  it('aplicada só em parte ganha uma linha extra do que ficou de fora', () => {
    const d = { background: 'dark', exactTexts: ['Um', 'Dois'], textOnly: true };
    const pieces = composeDesign(d, planDirectives(d, { ...S, hasLogo: true }), copy, S);
    const items = directiveItems(d, pieces);
    expect(items.find((i) => i.text.startsWith('Texto exato')).ok).toBe(true);
    expect(items.some((i) => !i.ok && i.text === 'Mais de um texto exato')).toBe(true);
  });
});

describe('etapas de Criando o post', () => {
  const base = { id: 'b', status: 'generating', kind: 'informativo', steps: [], error: null };

  it('ler o pedido é a primeira etapa e roda antes do redator', () => {
    expect(STEPS.map((s) => s.id)).toEqual(['directives', 'writer', 'visual', 'render']);
    expect(STEPS[0].title).toBe('Lendo o pedido');
    expect(stateOf(base, 'directives')).toBe('run');
    expect(stateOf(base, 'writer')).toBe('todo');
  });

  it('com o pedido lido (ou com a leitura que falhou), o redator roda e a leitura fica feita', () => {
    const read = { ...base, steps: [{ step: 'directives', status: 'done' }] };
    expect([stateOf(read, 'directives'), stateOf(read, 'writer')]).toEqual(['done', 'run']);
    const failedRead = { ...base, steps: [{ step: 'directives', status: 'failed' }] };
    expect([stateOf(failedRead, 'directives'), stateOf(failedRead, 'writer')]).toEqual(['done', 'run']);
  });

  it('post de antes da SPEC 020 (sem etapa de leitura): o redator em andamento conta a leitura como feita', () => {
    const old = { ...base, steps: [{ step: 'writer', status: 'reserved' }] };
    expect([stateOf(old, 'directives'), stateOf(old, 'writer')]).toEqual(['done', 'run']);
  });

  it('fila e pronto', () => {
    expect(stateOf({ ...base, status: 'queued' }, 'directives')).toBe('todo');
    expect(['directives', 'writer', 'visual', 'render'].map((s) => stateOf({ ...base, status: 'ready' }, s))).toEqual(['done', 'done', 'done', 'done']);
  });
});
