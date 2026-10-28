// caption-cases.js: o conjunto do eval da legenda e das hashtags (BEZ-373). Mede o que o eval da geração não olha de
// perto: a legenda serve a quem está fora da cidade da empresa quando o negócio é nacional ou internacional, as hashtags
// não ficam presas à cidade, e a chamada final ("link na bio" e as outras) só aparece quando a conta escolheu.
//
// Cada caso parte de uma empresa de cases.js e troca no perfil o alcance (`reach`: local, national, international ou null) e a
// chamada padrão (`ctaDefault`: link_bio, whatsapp, dm ou null, que é "sem chamada final"). Só o texto: sem imagem, sem visual. As exigências
// são escritas à mão e julgadas por um modelo; as checagens por código estão em metrics.js (captionChecks).

import { COMPANIES } from './cases.js';

const NO_CTA = { id: 'sem-chamada-final', in: 'caption', text: 'A legenda termina no conteúdo: não fecha com chamada para ação (link na bio, chame no WhatsApp, mande mensagem, agende, peça).' };
const NO_LINK_BIO = { id: 'sem-link-na-bio', in: 'caption', text: 'A expressão "link na bio" (ou "link da bio") não aparece na legenda.' };
const NATIONAL = [
  { id: 'fala-ao-pais', in: 'caption', text: 'A legenda fala a qualquer pessoa do Brasil: não usa "aqui em <cidade>", "no bairro", "venha até nós" nem outra referência que só serve a quem mora na cidade da empresa.' },
  { id: 'hashtags-do-pais', in: 'caption', text: 'As hashtags não são locais: nenhuma é a cidade, o estado ou o bairro da empresa, e ao menos duas descrevem o produto ou o nicho para um público do Brasil todo.' },
];

const company = (key, profile, extra = {}) => ({ ...COMPANIES[key], ...extra, profile: { ...COMPANIES[key].profile, ...profile } });

export const CAPTION_COMPANIES = {
  aurora_nacional: company('aurora', {
    reach: 'national',
    ctaDefault: null,
    offering: 'Panetones e bolos artesanais de fermentação natural, enviados para todo o Brasil',
    audience: 'Pessoas de todo o Brasil que compram comida artesanal e presente',
  }, { facts: ['Panetone de fermentação natural leva 36 horas para ficar pronto', 'Envio para todo o Brasil em embalagem térmica'], never: ['prazo de entrega em dias'] }),
  vertice_nacional: company('vertice', { reach: 'national', ctaDefault: null, audience: 'Construtoras e incorporadoras de todo o Brasil' }),
  vertice_link_bio: company('vertice', { reach: 'national', ctaDefault: 'link_bio', audience: 'Construtoras e incorporadoras de todo o Brasil' }),
  sorriso_local: company('sorriso', { reach: 'local', ctaDefault: 'whatsapp' }),
  aurora_local: company('aurora', { reach: 'local', ctaDefault: 'whatsapp' }),
  aurora_sem_resposta: company('aurora', { reach: null, ctaDefault: null }),
  lume_internacional: company('lume', {
    reach: 'international',
    ctaDefault: 'dm',
    offering: 'Ensaios de casal e casamentos pequenos, em Bauru e em destinos no Brasil e no exterior',
    audience: 'Casais do Brasil e de fora que querem um casamento pequeno em um destino',
  }),
};

export const CAPTION_CASES = [
  {
    id: 'nacional-panetone',
    company: 'aurora_nacional',
    tags: ['alcance', 'nacional', 'sem-cta'],
    why: 'Padaria de Marília que vende para o Brasil todo: a legenda e as hashtags não podem ficar na cidade, e sem chamada padrão a legenda não fecha com "link na bio".',
    idea: 'Post sobre o panetone de fermentação natural de 36 horas, para quem quer presentear no Natal.',
    requirements: [...NATIONAL, NO_CTA, NO_LINK_BIO],
  },
  {
    id: 'nacional-engenharia',
    company: 'vertice_nacional',
    tags: ['alcance', 'nacional', 'sem-cta'],
    why: 'Engenharia B2B que atende construtoras de todo o país: o texto não pode soar como serviço de Londrina.',
    idea: 'Post sobre como laudo técnico atrasado trava a liberação da obra.',
    requirements: [...NATIONAL, NO_CTA, NO_LINK_BIO],
  },
  {
    id: 'internacional-fotografia',
    company: 'lume_internacional',
    tags: ['alcance', 'internacional'],
    why: 'Fotógrafa que atende casais do Brasil e de fora: as hashtags podem alcançar quem não fala português e não ficam presas a Bauru.',
    idea: 'Post sobre casamento pequeno ao ar livre, só com os amigos mais próximos.',
    requirements: [
      { id: 'fala-ao-mundo', in: 'caption', text: 'A legenda não depende de morar em Bauru: não usa "aqui em Bauru", "na nossa cidade" nem referência que só serve a quem é da região.' },
      { id: 'hashtags-alcance-amplo', in: 'caption', text: 'Nenhuma hashtag é só a cidade ou o estado da empresa, e ao menos uma alcança quem está fora do Brasil (em inglês ou de uso internacional, como #elopement ou #intimatewedding).' },
    ],
  },
  {
    id: 'local-clinica',
    company: 'sorriso_local',
    tags: ['alcance', 'local', 'cta'],
    why: 'Clínica de bairro: a chamada pelo WhatsApp que a conta escolheu continua, e a região ajuda nas hashtags. O eval não pode empurrar todo negócio para o nacional.',
    idea: 'Post sobre a limpeza de seis em seis meses para as crianças.',
    requirements: [
      { id: 'chamada-whatsapp', in: 'caption', text: 'A legenda fecha convidando a pessoa a chamar no WhatsApp.' },
      { id: 'hashtags-locais-e-nicho', in: 'caption', text: 'As hashtags misturam ao menos uma da região da clínica (cidade ou estado) com as do nicho (odontologia, saúde infantil).' },
      NO_LINK_BIO,
    ],
  },
  {
    id: 'local-padaria',
    company: 'aurora_local',
    tags: ['alcance', 'local', 'cta'],
    why: 'Padaria de bairro com chamada pelo WhatsApp: citar a cidade é bem-vindo, "link na bio" não.',
    idea: 'Post sobre a fornada nova que sai todo dia às 7h.',
    requirements: [
      { id: 'chamada-whatsapp', in: 'caption', text: 'A legenda fecha convidando a pessoa a chamar no WhatsApp.' },
      { id: 'hashtags-locais-e-nicho', in: 'caption', text: 'As hashtags misturam ao menos uma da região (Marília ou SP) com as do nicho (pão, padaria, fermentação natural).' },
      NO_LINK_BIO,
    ],
  },
  {
    id: 'sem-resposta-sobre-alcance',
    company: 'aurora_sem_resposta',
    tags: ['alcance', 'sem-cta'],
    why: 'Conta antiga, sem alcance nem chamada escolhidos: a plataforma não pode inventar "link na bio" nem prender o post à cidade.',
    idea: 'Post sobre o pão de fermentação natural que leva 24 horas para ficar pronto.',
    requirements: [
      NO_LINK_BIO,
      { id: 'hashtags-nao-so-cidade', in: 'caption', text: 'Nenhuma hashtag é só a cidade ou o estado da empresa, e a maioria descreve o produto ou o nicho.' },
    ],
  },
  {
    id: 'link-na-bio-escolhido',
    company: 'vertice_link_bio',
    tags: ['cta', 'nacional'],
    why: 'Quando a conta escolhe "link na bio", a chamada tem que aparecer: omitir a chamada é opção, não defeito.',
    idea: 'Post sobre o laudo técnico entregue em até 10 dias úteis.',
    requirements: [{ id: 'chamada-link-bio', in: 'caption', text: 'A legenda fecha convidando a pessoa a abrir o link da bio.' }, NATIONAL[1]],
  },
];

// Da régua de ofício, só o que se lê na legenda.
export const CAPTION_CRAFT = ['ofc-sem-cliche', 'ofc-voz'];
