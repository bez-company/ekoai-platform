import { describe, it, expect } from 'vitest';
import { friendlyGenerationError } from '@/lib/generation-errors';

// BEZ-291: 404 e 403 do Vertex diziam "o modelo recusou o pedido, tente outro tema" e escondiam um modelo inexistente em
// produção. Só recusa de segurança (finishReason) pede outro tema.
describe('friendlyGenerationError', () => {
  const OUR = /o problema é nosso/;

  it('404 e 403 do Vertex dizem que o problema é nosso e não pedem outro tema', () => {
    for (const code of [403, 404]) {
      const text = friendlyGenerationError(`Vertex AI ${code} em gemini-x: Publisher Model was not found`);
      expect(text).toMatch(OUR);
      expect(text).not.toMatch(/outro tema/);
    }
  });

  it('os outros 4xx e 5xx do Vertex também são nossos, menos 429 e 503 (sobrecarga)', () => {
    expect(friendlyGenerationError('Vertex AI 400 em m: invalid argument')).toMatch(OUR);
    expect(friendlyGenerationError('Vertex AI 500 em m: internal')).toMatch(OUR);
    expect(friendlyGenerationError('Vertex AI 429 em m: quota')).toMatch(/sobrecarregado/);
    expect(friendlyGenerationError('Vertex AI 503 em m: unavailable')).toMatch(/sobrecarregado/);
  });

  it('recusa de segurança pede outro tema', () => {
    for (const e of ['O modelo de imagem não devolveu imagem (SAFETY).', 'O modelo de texto não devolveu conteúdo (PROHIBITED_CONTENT).', 'O modelo de imagem não devolveu imagem (IMAGE_SAFETY).']) {
      expect(friendlyGenerationError(e)).toMatch(/recusou o pedido/);
    }
  });

  it('sem erro, mensagem do perfil e texto longo seguem como antes', () => {
    expect(friendlyGenerationError(null)).toBe('Algo deu errado no meio do caminho.');
    expect(friendlyGenerationError('Complete o perfil da empresa antes de gerar.')).toBe('Complete o perfil da empresa antes de gerar.');
    expect(friendlyGenerationError('x'.repeat(200))).toBe(`${'x'.repeat(160)}…`);
  });

  it('o texto não tem travessão', () => {
    expect(friendlyGenerationError('Vertex AI 404 em m: x')).not.toMatch(/—|–/);
  });
});
