// territories.js: os territórios criativos do estúdio. Cada um é um jeito de pensar a peça (não um molde de
// layout): o código sorteia alguns por pedido, e é isso que garante que dois pedidos parecidos não saiam
// com a mesma cara. `image` diz o que a arte por IA faz naquele território.

export const TERRITORIES = [
  {
    id: 'cartaz-tipografico',
    name: 'Cartaz tipográfico',
    brief: 'A palavra é a imagem. Uma a quatro palavras em corpo enorme (ocupando ao menos metade da altura), cortes de linha com intenção, um único gesto gráfico de apoio (ponto, linha, sublinhado desenhado, uma palavra em outra cor). Muito respiro. Sem foto.',
    image: 'none',
  },
  {
    id: 'surreal-fotografico',
    name: 'Cena surreal fotográfica',
    brief: 'Uma metáfora visual impossível e fotorrealista que traduz a ideia em uma imagem só (objeto fora de escala, cena invertida, algo flutuando, dois mundos colados). A foto ocupa a peça inteira ou dois terços dela; o título entra como parte da cena, em espaço livre que a foto reserva.',
    image: 'hero',
  },
  {
    id: 'mockup-anotado',
    name: 'Mockup com anotações à mão',
    brief: 'Um cartão de interface, ficha, recibo, mensagem ou objeto desenhado em HTML/CSS (com dado fictício plausível), levemente inclinado, com sombra suave, e 2 ou 3 anotações manuscritas (Caveat) ligadas por setas desenhadas em SVG. A explicação vem das anotações, não de parágrafo.',
    image: 'none',
  },
  {
    id: 'colagem-editorial',
    name: 'Colagem editorial',
    brief: 'Papel, recortes, fita adesiva, bordas rasgadas, camadas sobrepostas, textura de papel e grão. Uma imagem recortada (objeto ou pessoa, sem rosto identificável) sobre formas de cor chapada, com tipografia misturando duas escalas.',
    image: 'cutout',
  },
  {
    id: 'objeto-heroi',
    name: 'Objeto herói em estúdio',
    brief: 'Um único objeto simbólico, iluminado como foto de produto (sombra longa, reflexo, luz lateral), sobre fundo de uma cor só da marca. Título curto num canto, muito espaço vazio ao redor do objeto.',
    image: 'hero',
  },
  {
    id: 'numero-gigante',
    name: 'Número ou palavra gigante',
    brief: 'Um número, uma data, um valor ou uma palavra-chave em corpo monumental que sangra para fora do quadro (use data-bleed), com uma linha de contexto pequena e precisa. Só use número que esteja nos fatos ou no pedido.',
    image: 'none',
  },
  {
    id: 'diagrama-didatico',
    name: 'Diagrama didático',
    brief: 'Um mapa simples da ideia: 3 a 5 nós conectados por linhas e setas desenhadas em SVG, numeração grande, uma legenda curta por nó. Parece caderno de um professor muito bom, não infográfico corporativo.',
    image: 'none',
  },
  {
    id: 'antes-depois',
    name: 'Antes e depois partido',
    brief: 'A peça dividida em dois mundos (corte reto, diagonal ou rasgado): o problema à esquerda ou no alto, a virada do outro lado, com contraste forte de cor, escala e tom entre as metades. Duas frases curtas, uma por lado.',
    image: 'optional',
  },
  {
    id: 'cartaz-retro',
    name: 'Cartaz impresso retrô',
    brief: 'Serigrafia ou risografia: 2 ou 3 cores chapadas da marca, meio-tom (halftone), formas geométricas grandes, texto em caixa alta forte, leve desalinhamento de impressão. Ilustração construída em SVG/CSS.',
    image: 'none',
  },
  {
    id: 'capa-de-revista',
    name: 'Capa de revista',
    brief: 'Cabeçalho tipo logotipo de revista, manchete principal enorme, duas ou três chamadas laterais menores, uma imagem forte de fundo ou recortada. Hierarquia de banca de jornal.',
    image: 'hero',
  },
  {
    id: 'bilhete-e-notas',
    name: 'Bilhete, post-it e caderno',
    brief: 'Mesa de trabalho vista de cima: papel pautado ou quadriculado, post-its coloridos levemente tortos, fita, clipe, marca-texto desenhado sob uma palavra. Texto principal em tipografia limpa; apoios em Caveat.',
    image: 'none',
  },
  {
    id: 'grade-modular',
    name: 'Grade modular (bento)',
    brief: 'Uma grade de cartões de tamanhos diferentes, cada um com um ícone desenhado em SVG ou uma palavra, formando um mosaico organizado com um cartão dominante que carrega o título. Cantos arredondados consistentes, cores da marca em proporções desiguais.',
    image: 'none',
  },
  {
    id: 'cena-cotidiana',
    name: 'Cena cotidiana documental',
    brief: 'Foto de cena real de rotina (mãos, mesa, luz de janela, bancada), enquadramento íntimo, luz natural, sensação de revista. A tipografia é discreta e elegante, ancorada num canto sobre área calma da foto.',
    image: 'hero',
  },
  {
    id: 'citacao-grande',
    name: 'Citação monumental',
    brief: 'Aspas gigantes como elemento gráfico, uma frase em corpo grande com uma palavra destacada, atribuição pequena. Fundo de cor chapada ou textura sutil; hierarquia de dois níveis só.',
    image: 'optional',
  },
  {
    id: 'ilustracao-geometrica',
    name: 'Ilustração geométrica de marca',
    brief: 'Uma ilustração feita de formas puras (círculos, arcos, quadrados) com paleta da marca, que representa a ideia de forma abstrata e ocupa a peça; o texto convive com a ilustração em duas ou três camadas de profundidade.',
    image: 'none',
  },
];

export const TERRITORY_BY_ID = Object.fromEntries(TERRITORIES.map((t) => [t.id, t]));

// Gerador pseudoaleatório com semente, para o sorteio do eval ser reproduzível.
export function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// `count` territórios diferentes, sem repetir os usados recentemente na mesma conta (`recent`: ids).
export function pickTerritories({ count = 4, seed = 1, recent = [] }) {
  const rand = rng(seed);
  const fresh = TERRITORIES.filter((t) => !recent.includes(t.id));
  const pool = fresh.length >= count ? fresh : TERRITORIES;
  const bag = [...pool];
  const out = [];
  while (out.length < count && bag.length) out.push(bag.splice(Math.floor(rand() * bag.length), 1)[0]);
  return out;
}
