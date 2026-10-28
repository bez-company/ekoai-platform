import { describe, it, expect } from 'vitest';
import { DEFAULT_NETWORKS, networkChips, toggleNetwork } from '../platform/src/lib/networks-model.ts';
import { ideaTabs } from '../platform/src/lib/ideas-model.ts';

describe('redes de Criar post (SPEC 028)', () => {
  it('o Instagram está sempre disponível, mesmo sem conta conectada', () => {
    expect(networkChips([]).find((c) => c.channel === 'instagram')).toMatchObject({ label: 'Instagram', locked: null, sub: 'Imagem ou carrossel' });
  });

  it('o LinkedIn trava sem conta conectada, com o próximo passo, e libera com ela', () => {
    expect(networkChips([]).find((c) => c.channel === 'linkedin')).toMatchObject({ locked: 'not_connected', sub: 'Não conectado. Conectar' });
    expect(networkChips(['linkedin']).find((c) => c.channel === 'linkedin')).toMatchObject({ locked: null, sub: 'Texto em primeira pessoa e a capa' });
  });

  it('o X segue travado como "em breve" mesmo conectado, porque ainda não tem redator', () => {
    for (const connected of [[], ['twitter']]) expect(networkChips(connected).find((c) => c.channel === 'twitter')).toMatchObject({ locked: 'coming_soon', sub: 'Em breve' });
  });

  it('a escolha padrão é só o Instagram', () => {
    expect(DEFAULT_NETWORKS).toEqual(['instagram']);
  });

  it('liga e desliga, mantém a ordem do sistema e nunca fica vazia', () => {
    const chips = networkChips(['linkedin']);
    expect(toggleNetwork(['instagram'], 'linkedin', chips)).toEqual(['instagram', 'linkedin']);
    expect(toggleNetwork(['linkedin'], 'instagram', chips)).toEqual(['instagram', 'linkedin']);
    expect(toggleNetwork(['instagram', 'linkedin'], 'instagram', chips)).toEqual(['linkedin']);
    expect(toggleNetwork(['linkedin'], 'linkedin', chips)).toEqual(['linkedin']);
    expect(toggleNetwork(['instagram'], 'instagram', chips)).toEqual(['instagram']);
  });

  it('rede travada não liga', () => {
    expect(toggleNetwork(['instagram'], 'linkedin', networkChips([]))).toEqual(['instagram']);
    expect(toggleNetwork(['instagram'], 'twitter', networkChips(['twitter']))).toEqual(['instagram']);
    expect(toggleNetwork(['instagram'], 'tiktok', networkChips([]))).toEqual(['instagram']);
  });
});

describe('abas da ideia (SPEC 028)', () => {
  const p = (channel, status = 'awaiting_decision') => ({ pending_id: `plat-${channel}`, channel, status });

  it('uma aba por rede pedida, na ordem do sistema, cada uma com a própria pendência', () => {
    const tabs = ideaTabs(['linkedin', 'instagram'], [p('linkedin'), p('instagram')]);
    expect(tabs.map((t) => [t.channel, t.pendingId, t.state])).toEqual([['instagram', 'plat-instagram', 'ready'], ['linkedin', 'plat-linkedin', 'ready']]);
  });

  it('rede pedida sem pendência aparece como não gerada e sem link', () => {
    expect(ideaTabs(['instagram', 'linkedin'], [p('instagram')])).toEqual([{ channel: 'instagram', pendingId: 'plat-instagram', state: 'ready' }, { channel: 'linkedin', pendingId: null, state: 'missing' }]);
  });

  it('o estado vem do status da pendência', () => {
    const tabs = ideaTabs(['instagram', 'linkedin'], [p('instagram', 'approved'), p('linkedin', 'rejected')]);
    expect(tabs.map((t) => t.state)).toEqual(['approved', 'rejected']);
  });

  it('pendência de rede que o pedido não listava ainda aparece, e pedido antigo é só o Instagram', () => {
    expect(ideaTabs(['instagram'], [p('instagram'), p('linkedin')]).map((t) => t.channel)).toEqual(['instagram', 'linkedin']);
    expect(ideaTabs(['instagram'], [p('instagram')])).toHaveLength(1);
  });
});
