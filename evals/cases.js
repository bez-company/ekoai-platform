// cases.js: o conjunto de pedidos do eval da geração de post. Cada caso é um pedido real (o que a pessoa
// digita em "Criar post") mais a lista de exigências que a imagem final e a legenda precisam cumprir.
// As exigências são escritas por uma pessoa, a partir do pedido, nunca pelo modelo que está sendo medido.
//
// Empresa fictícia (este repositório é público): padaria e confeitaria "Casa Aurora".
//
// Campos de `requirements`:
//   id        identificador estável, aparece no relatório
//   text      a exigência, em português, no que se pode conferir olhando a imagem ou lendo a legenda
//   in        'image' (o juiz olha o PNG) ou 'caption' (o juiz lê a legenda)
//   contains  opcional: trechos que precisam estar no texto desenhado na imagem (conferência por código,
//             sem modelo, para pegar erro do juiz)

export const COMPANY = {
  name: 'Casa Aurora',
  handle: 'casaaurora',
  profile: {
    niche: 'Padaria e confeitaria artesanal',
    offering: 'Pães de fermentação natural, bolos sob encomenda e café da manhã',
    audience: 'Famílias e escritórios do bairro',
    region: 'Marília, SP',
    siteUrl: null,
    instagramHandle: '@casaaurora',
    differentiators: ['Fornada nova todo dia às 7h', 'Fermentação natural de 24 horas'],
    pains: ['Pão que endurece no mesmo dia', 'Bolo de festa que chega amassado'],
    voiceFormal: 2,
    voiceTechnical: 4,
    voiceSerious: 3,
    bannedWords: ['imperdível', 'o melhor da cidade'],
    logoAssetId: null,
    colorPrimary: '#3A1F1A',
    colorAccent: '#E8A33D',
    fontHeading: 'Playfair Display',
    fontBody: 'Inter',
    ctaDefault: 'whatsapp',
    postsPerWeek: 3,
    updatedAt: '',
  },
  facts: ['Fornada nova todo dia às 7h', 'Pão de fermentação natural leva 24 horas para ficar pronto', 'Encomenda de bolo com 3 dias de antecedência'],
  never: ['promessa de entrega em menos de 3 dias'],
};

// Logo fictício: círculo âmbar com um sol e a palavra, em SVG embutido.
const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="220" height="220" viewBox="0 0 220 220"><circle cx="110" cy="110" r="104" fill="#E8A33D"/><circle cx="110" cy="124" r="38" fill="#3A1F1A"/><path d="M110 40v22M58 62l15 15M162 62l-15 15M36 112h22M184 112h-22" stroke="#3A1F1A" stroke-width="8" stroke-linecap="round"/></svg>`;
export const LOGO = { dataUri: `data:image/svg+xml;base64,${Buffer.from(LOGO_SVG).toString('base64')}`, width: 220, height: 220 };

export const CASES = [
  {
    id: 'primeira-imagem-da-marca',
    why: 'Caso real que motivou o eval: a pessoa descreveu a imagem em detalhe e a plataforma entregou outra coisa (foto de vaso, frase inventada, logo pequeno no canto).',
    idea: 'Quero uma imagem para ser a primeira do Instagram. Fundo escuro, com o logo bem centralizado, o nome da empresa, Casa Aurora, e em um canto o @casaaurora.',
    kind: null,
    ratio: '1:1',
    requirements: [
      { id: 'fundo-escuro', in: 'image', text: 'O fundo da imagem é escuro (a maior parte da área é preta, grafite ou marrom bem escuro).' },
      { id: 'logo-centralizado', in: 'image', text: 'O logo (o círculo âmbar com um sol) aparece grande e centralizado na imagem, na horizontal e perto do meio na vertical.' },
      { id: 'nome-da-empresa', in: 'image', text: 'O nome "Casa Aurora" está escrito na imagem, legível, junto do logo.', contains: ['Casa Aurora'] },
      { id: 'arroba-no-canto', in: 'image', text: 'O texto "@casaaurora" está escrito em um canto da imagem.', contains: ['@casaaurora'] },
      { id: 'sem-frase-extra', in: 'image', text: 'A imagem não tem frase de efeito, título nem selo além do nome da empresa e do @ (a pessoa não pediu nenhum).' },
      { id: 'sem-foto-aleatoria', in: 'image', text: 'A imagem não tem foto de objeto, planta ou cena (a pessoa pediu fundo escuro liso com logo).' },
    ],
  },
  {
    id: 'dicas-em-lista',
    why: 'Pedido que o motor já deveria atender: informativo em lista, com quantidade pedida.',
    idea: 'Três dicas para o pão não endurecer no mesmo dia.',
    kind: 'informativo',
    ratio: '4:5',
    requirements: [
      { id: 'tres-dicas', in: 'image', text: 'A imagem mostra exatamente 3 dicas, em lista.' },
      { id: 'tema-pao', in: 'image', text: 'As dicas tratam de conservar pão para ele não endurecer.' },
      { id: 'acentos', in: 'image', text: 'Todo texto da imagem está em português correto, com acentos nos lugares certos.' },
      { id: 'legenda-chamada', in: 'caption', text: 'A legenda termina convidando a pessoa a chamar no WhatsApp.' },
    ],
  },
  {
    id: 'frase-exata',
    why: 'A pessoa dita o texto da imagem. O sistema não pode reescrever.',
    idea: 'Post com a frase exata "Fornada nova todo dia às 7h" em destaque e mais nada na imagem.',
    kind: 'informativo',
    ratio: '1:1',
    requirements: [
      { id: 'frase-literal', in: 'image', text: 'A frase "Fornada nova todo dia às 7h" aparece na imagem exatamente assim, sem troca de palavra.', contains: ['Fornada nova todo dia às 7h'] },
      { id: 'so-a-frase', in: 'image', text: 'A imagem não tem subtítulo, lista nem selo além da frase pedida (o nome ou o @ da empresa em canto não contam como extra).' },
    ],
  },
  {
    id: 'atmosfera-cafe-da-manha',
    why: 'Post de atmosfera: a cena pedida precisa ser a cena da foto.',
    idea: 'Foto de uma mesa de café da manhã com pães e café, luz de manhã, clima acolhedor.',
    kind: 'atmosfera',
    ratio: '4:5',
    requirements: [
      { id: 'cena-pedida', in: 'image', text: 'A foto de fundo mostra uma mesa de café da manhã com pães e café.' },
      { id: 'luz-de-manha', in: 'image', text: 'A luz da foto é natural e suave, de manhã.' },
      { id: 'texto-legivel', in: 'image', text: 'O título escrito sobre a foto é legível (contraste bom, sem cortar).' },
      { id: 'sem-texto-na-foto', in: 'image', text: 'A foto em si não tem letras nem logo desenhados pelo modelo de imagem (só o texto colocado por cima).' },
    ],
  },
  {
    id: 'numero-fora-da-base',
    why: 'Guarda de fato: número que a pessoa pede e a base não tem. O post não pode afirmar o que não sabe.',
    idea: 'Anunciar 30% de desconto no bolo de chocolate nesta semana.',
    kind: 'informativo',
    ratio: '1:1',
    requirements: [
      { id: 'sem-numero-inventado', in: 'image', text: 'Todo número na imagem vem do pedido (30%) ou da base de fatos (7h, 24 horas, 3 dias). Preço, data ou prazo fora dessas fontes reprova.' },
      { id: 'legenda-sem-invencao', in: 'caption', text: 'A legenda não inventa data, horário, preço nem condição. Só vale o que está no pedido (30% de desconto, bolo de chocolate, esta semana) ou na base de fatos (fornada às 7h, fermentação de 24 horas, encomenda com 3 dias).' },
      { id: 'desconto-na-legenda', in: 'caption', text: 'A legenda diz que o desconto é de 30%.' },
      { id: 'pedido-atendido', in: 'image', text: 'A imagem anuncia o desconto de 30% no bolo de chocolate.', contains: ['30%'] },
    ],
  },
];
