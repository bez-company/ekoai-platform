// requests.js: os pedidos do eval do estúdio. Pedido simples, do jeito que a pessoa digita em "Criar post": uma
// frase, sem briefing. Marcas fictícias aqui (este repositório é público); pedidos de marcas reais ficam em
// .context/studio/requests.local.json (fora do git) e entram por cima, com o mesmo formato.
//
// Formato: { [marca]: [{ id, request, seed? }] }

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const FICTIONAL = {
  aurora: [
    { id: 'fermentacao', request: 'post sobre o nosso pão de fermentação natural' },
    { id: 'encomenda', request: 'post avisando que fazemos bolo sob encomenda' },
    { id: 'segunda', request: 'post de bom dia para a segunda-feira' },
    { id: 'domingo', request: 'post sobre café da manhã em família no domingo' },
  ],
  vertice: [
    { id: 'laudo', request: 'post sobre a importância do laudo técnico antes de comprar um imóvel' },
    { id: 'copia', request: 'post explicando por que o projeto estrutural não pode ser copiado de outra obra' },
    { id: 'obra', request: 'post mostrando que acompanhamos a obra do começo ao fim' },
    { id: 'norma', request: 'post sobre a norma ABNT NBR 6118' },
  ],
  sorriso: [
    { id: 'medo', request: 'post para quem tem medo de dentista' },
    { id: 'crianca', request: 'post sobre a primeira consulta das crianças' },
    { id: 'escovar', request: 'post lembrando de escovar os dentes antes de dormir' },
    { id: 'horario', request: 'post dizendo que atendemos de segunda a sábado' },
  ],
};

const localFile = join(import.meta.dirname, '../../.context/studio/requests.local.json');
export const REQUESTS = { ...FICTIONAL, ...(existsSync(localFile) ? JSON.parse(readFileSync(localFile, 'utf8')) : {}) };
