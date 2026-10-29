// territories.ts: os territórios criativos do estúdio, um por estilo da vitrine (SPEC 030). Cada um é um jeito de pensar a peça, não
// um molde de layout. O código sorteia alguns por pedido, com semente, e é isso que faz pedidos parecidos não saírem iguais.
// Os ids são os de `STYLES` (levels.ts); aqui ficam o briefing para os agentes e como o estilo usa imagem de IA.

import { STYLES } from './levels';
import type { Territory } from './model';

const BRIEFS: Record<string, { brief: string; image: Territory['image'] }> = {
  'cartaz-tipografico': { image: 'none', brief: 'A palavra é a imagem. Uma a quatro palavras em corpo enorme (ocupando ao menos metade da altura), cortes de linha com intenção, um único gesto gráfico de apoio (ponto, linha, sublinhado desenhado, uma palavra em outra cor). Muito respiro. Sem foto.' },
  'surreal-fotografico': { image: 'hero', brief: 'Uma metáfora visual impossível e fotorrealista que traduz a ideia em uma imagem só (objeto fora de escala, cena invertida, algo flutuando, dois mundos colados). A foto ocupa a peça inteira ou dois terços dela; o título entra como parte da cena, em espaço livre que a foto reserva.' },
  'mockup-anotado': { image: 'none', brief: 'Um cartão de interface, ficha, recibo, mensagem ou objeto desenhado em HTML/CSS (com dado fictício plausível), levemente inclinado, com sombra suave, e 2 ou 3 anotações manuscritas (Caveat) ligadas por setas desenhadas em SVG. A explicação vem das anotações, não de parágrafo.' },
  'colagem-editorial': { image: 'cutout', brief: 'Papel, recortes, fita adesiva, bordas rasgadas, camadas sobrepostas, textura de papel e grão. Uma imagem recortada (objeto ou pessoa, sem rosto identificável) sobre formas de cor chapada, com tipografia misturando duas escalas.' },
  'objeto-heroi': { image: 'hero', brief: 'Um único objeto simbólico, iluminado como foto de produto (sombra longa, reflexo, luz lateral), sobre fundo de uma cor só da marca. Título curto num canto, muito espaço vazio ao redor do objeto.' },
  'numero-gigante': { image: 'none', brief: 'Um número, uma data, um valor ou uma palavra-chave em corpo monumental que sangra para fora do quadro (use data-bleed), com uma linha de contexto pequena e precisa. Só use número que esteja nos fatos ou no pedido.' },
  'diagrama-didatico': { image: 'none', brief: 'Um mapa simples da ideia: 3 a 5 nós conectados por linhas e setas desenhadas em SVG, numeração grande, uma legenda curta por nó. Parece caderno de um professor muito bom, não infográfico corporativo.' },
  'antes-depois': { image: 'optional', brief: 'A peça dividida em dois mundos (corte reto, diagonal ou rasgado): o problema à esquerda ou no alto, a virada do outro lado, com contraste forte de cor, escala e tom entre as metades. Duas frases curtas, uma por lado.' },
  'cartaz-retro': { image: 'none', brief: 'Serigrafia ou risografia: 2 ou 3 cores chapadas da marca, meio-tom (halftone), formas geométricas grandes, texto em caixa alta forte, leve desalinhamento de impressão. Ilustração construída em SVG/CSS.' },
  'capa-de-revista': { image: 'hero', brief: 'Cabeçalho tipo logotipo de revista, manchete principal enorme, duas ou três chamadas laterais menores, uma imagem forte de fundo ou recortada. Hierarquia de banca de jornal.' },
  'bilhete-e-notas': { image: 'none', brief: 'Mesa de trabalho vista de cima: papel pautado ou quadriculado, post-its coloridos levemente tortos, fita, clipe, marca-texto desenhado sob uma palavra. Texto principal em tipografia limpa; apoios em Caveat.' },
  'grade-modular': { image: 'none', brief: 'Uma grade de cartões de tamanhos diferentes, cada um com um ícone desenhado em SVG ou uma palavra, formando um mosaico organizado com um cartão dominante que carrega o título. Cantos arredondados consistentes, cores da marca em proporções desiguais.' },
  'cena-cotidiana': { image: 'hero', brief: 'Foto de cena real de rotina (mãos, mesa, luz de janela, bancada), enquadramento íntimo, luz natural, sensação de revista. A tipografia é discreta e elegante, ancorada num canto sobre área calma da foto.' },
  'citacao-grande': { image: 'optional', brief: 'Aspas gigantes como elemento gráfico, uma frase em corpo grande com uma palavra destacada, atribuição pequena. Fundo de cor chapada ou textura sutil; hierarquia de dois níveis só.' },
  'ilustracao-geometrica': { image: 'none', brief: 'Uma ilustração feita de formas puras (círculos, arcos, quadrados) com paleta da marca, que representa a ideia de forma abstrata e ocupa a peça; o texto convive com a ilustração em duas ou três camadas de profundidade.' },
};

export const TERRITORIES: readonly Territory[] = STYLES.map((s) => ({ id: s.id, name: s.name, brief: BRIEFS[s.id].brief, image: BRIEFS[s.id].image }));

export const territoryById = (id: string): Territory | undefined => TERRITORIES.find((t) => t.id === id);

// Gerador pseudoaleatório com semente, para o sorteio ser reproduzível.
export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// `count` territórios diferentes, sem repetir os usados recentemente na conta (`recent`: ids) e só entre `pool` (o estilo escolhido
// restringe: um id só, ou só os minimalistas, ou só os com imagem). Pool curto demais devolve o que houver.
export function pickTerritories(input: { count: number; seed: number; recent?: string[]; pool?: readonly Territory[] }): Territory[] {
  const rand = rng(input.seed);
  const all = input.pool?.length ? input.pool : TERRITORIES;
  const fresh = all.filter((t) => !(input.recent ?? []).includes(t.id));
  const bag = [...(fresh.length >= Math.min(input.count, all.length) ? fresh : all)];
  const out: Territory[] = [];
  while (out.length < input.count && bag.length) out.push(bag.splice(Math.floor(rand() * bag.length), 1)[0]);
  return out;
}

// Os territórios que o estilo escolhido permite: um id, ou a forma automática (todos, só os sem imagem de IA, só os com imagem).
export function poolForStyle(style: string): Territory[] {
  const one = territoryById(style);
  if (one) return [one];
  if (style === 'auto-minimalista') return TERRITORIES.filter((t) => t.image === 'none' || t.image === 'optional');
  if (style === 'auto-imagem') return TERRITORIES.filter((t) => t.image !== 'none');
  return [...TERRITORIES];
}
