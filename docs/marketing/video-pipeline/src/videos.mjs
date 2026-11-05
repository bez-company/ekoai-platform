// Roteiro dos vídeos: cada cena é um tipo (hook, shot, pains, end) com texto e foco no take.
// Foco = retângulo do take em frações (x, y, w, h). "from" omitido = visão geral.
const F = (x, y, w, h) => ({ x, y, w, h });
const END = (tag = 'O Instagram da sua empresa,\n*pronto para aprovar.*') => ({ type: 'end', d: 4.2, tag, cta: 'ekoai.com.br' });

export const VIDEOS = [
  {
    id: 'v1-ekoai-em-45s',
    scenes: [
      { type: 'hook', d: 2.8, kicker: 'Instagram de empresa', text: 'Seu Instagram\n*parou* de novo?' },
      { type: 'hook', d: 2.6, text: 'Falta tempo.\nFalta ideia.\nFalta *constância*.', size: 112 },
      { type: 'hook', d: 2.6, text: 'Conte *uma vez*\nquem é a sua\nempresa.' },
      { type: 'shot', d: 4.0, kicker: '01 · Marca', title: 'Cole o endereço do site.', img: 'site-preenchido-d', to: F(0.27, 0.12, 0.46, 0.6) },
      { type: 'shot', d: 5.0, kicker: '01 · Marca', title: 'A Ekoai lê a marca.\nVocê *confere*.', img: 'marca-lida-d', to: F(0.26, 0.08, 0.48, 0.26), chip: 'Cores, logo, jeito de falar e fatos' },
      { type: 'shot', d: 5.4, kicker: '02 · Criar', title: 'Peça um post.\nEscolha entre *16 estilos*.', img: 'vitrine-d', to: F(0.2, 0.26, 0.6, 0.27), chip: 'Com as cores e a fonte da sua marca' },
      { type: 'shot', d: 6.0, kicker: '03 · Estúdio', title: 'Agentes *criam, criticam* e refinam.', img: 'gerando-d', from: F(0.19, 0.1, 0.62, 0.3), to: F(0.19, 0.3, 0.62, 0.45), chip: 'Do ângulo do post à revisão final' },
      { type: 'shot', d: 5.4, kicker: '04 · Aprovar', title: 'Você vê as opções e *escolhe*.', img: 'aprovar-3-d', from: F(0.19, 0.08, 0.44, 0.4), to: F(0.645, 0.08, 0.27, 0.5), chip: 'Nada sai sem a sua aprovação' },
      { type: 'shot', d: 5.0, kicker: '05 · Publicar', title: 'Aprovou?\nEla *agenda* e publica.', img: 'agenda-campanha-d', to: F(0.2, 0.28, 0.76, 0.6), chip: 'No horário certo, com campanha' },
      { type: 'shot', d: 5.0, kicker: '06 · Aprender', title: 'E *aprende* com o que funciona.', img: 'aprendizado-d', to: F(0.2, 0.08, 0.76, 0.5), chip: 'Regras da conta e leitura do público' },
      END(),
    ],
  },
  {
    id: 'v2-problemas',
    scenes: [
      { type: 'hook', d: 3.0, kicker: 'Instagram parado', text: 'Quanto custa\num Instagram\n*parado*?' },
      {
        type: 'pains', d: 9.0, kicker: 'O que trava', title: 'Quatro motivos.\nQuatro *respostas*.',
        items: [
          ['Não sei o que postar hoje', 'Sugestões da semana, com campanha'],
          ['Não tenho tempo de criar', 'Post pronto para você aprovar'],
          ['Cada post sai com uma cara', 'Cores, fonte e voz sempre da marca'],
          ['Nunca sei o que deu resultado', 'Métricas e aprendizado por post'],
        ],
      },
      { type: 'shot', d: 4.6, kicker: 'Sem ideia', title: 'A semana já vem\n*planejada*.', img: 'inicio-d', to: F(0.2, 0.15, 0.76, 0.6), chip: 'Sugestões da semana na tela inicial' },
      { type: 'shot', d: 4.6, kicker: 'Sem tempo', title: 'Post pronto.\n*Um clique* para aprovar.', img: 'aprovar-detalhe-d', from: F(0.19, 0, 0.8, 0.3), to: F(0.19, 0.05, 0.75, 0.3), chip: 'Imagem e legenda, na voz da empresa' },
      { type: 'shot', d: 4.6, kicker: 'Sem resposta', title: 'Veja o que\n*funciona* de verdade.', img: 'analytics-d', to: F(0.2, 0.08, 0.76, 0.42), chip: 'Alcance, engajamento e melhores posts' },
      { type: 'hook', d: 3.2, text: 'Pare de *recomeçar*\ndo zero toda\nsemana.', size: 112 },
      END('Menos tarefa.\n*Mais Instagram.*'),
    ],
  },
  {
    id: 'v3-estudio',
    scenes: [
      { type: 'hook', d: 3.2, kicker: 'Estúdio de posts', text: 'Post de IA\nnão precisa ter\ncara de *IA*.', size: 116 },
      { type: 'shot', d: 5.0, kicker: '01 · Estilo', title: 'Comece por um *estilo*,\nnão por um prompt.', img: 'vitrine-d', to: F(0.2, 0.26, 0.6, 0.27), chip: '16 direções de design na cor da sua marca', tsize: 72 },
      { type: 'shot', d: 5.0, kicker: '02 · Esforço', title: 'Você escolhe quanto\na Ekoai *capricha*.', img: 'criar-post-d', from: F(0.08, 0.0, 0.8, 0.3), to: F(0.08, 0.62, 0.66, 0.2), chip: 'Rápido, Refinado ou Autoral', tsize: 72 },
      { type: 'shot', d: 6.0, kicker: '03 · Agentes', title: 'Vários agentes.\nUm *diretor de arte* no fim.', img: 'gerando-d', from: F(0.19, 0.1, 0.62, 0.3), to: F(0.19, 0.3, 0.62, 0.45), chip: 'Crítica, refino e revisão antes de chegar a você', tsize: 72 },
      { type: 'shot', d: 5.0, kicker: '04 · Opções', title: 'Até 3 *opções de design*\npara escolher.', img: 'aprovar-3-d', from: F(0.19, 0.08, 0.44, 0.4), to: F(0.19, 0.08, 0.44, 0.4), chip: 'Mesmo texto, três direções visuais', tsize: 72 },
      { type: 'shot', d: 6.0, kicker: '05 · Editor', title: 'Quer mexer?\n*Editor livre* na imagem.', img: 'studio-texto-d', from: F(0.05, 0.02, 0.9, 0.55), to: F(0.28, 0.04, 0.4, 0.5), chip: 'Texto, cor, logo e camadas', tsize: 72 },
      { type: 'shot', d: 5.2, kicker: '06 · Ajuste', title: 'Peça ajuste em texto livre.\nSó *isso* muda.', img: 'ajuste-antes-depois-d', from: F(0.19, 0.08, 0.3, 0.28), to: F(0.5, 0.1, 0.42, 0.28), chip: 'O resto do post fica igual', tsize: 68 },
      END('Do pedido ao post,\n*com direção de arte.*'),
    ],
  },
  {
    id: 'v4-funcionalidades',
    scenes: [
      { type: 'hook', d: 2.6, kicker: 'Tour rápido', text: 'A plataforma\nem *30 segundos*.' },
      { type: 'shot', d: 3.4, kicker: 'Início', title: 'O que *precisa de você*,\nna primeira tela.', img: 'inicio-d', to: F(0.2, 0.15, 0.76, 0.6), tsize: 72 },
      { type: 'shot', d: 3.4, kicker: 'Campanhas', title: 'Campanha com *meta*\ne progresso.', img: 'campanha-d', to: F(0.2, 0.04, 0.76, 0.3), tsize: 72 },
      { type: 'shot', d: 3.4, kicker: 'Carrossel', title: '*Carrossel* lâmina\npor lâmina.', img: 'carrossel-d', from: F(0.15, 0.1, 0.35, 0.5), to: F(0.5, 0.3, 0.42, 0.3), tsize: 72 },
      { type: 'shot', d: 3.4, kicker: 'Agenda', title: 'Agenda *semanal*\ncom horários.', img: 'agenda-campanha-d', to: F(0.2, 0.28, 0.76, 0.6), tsize: 72 },
      { type: 'shot', d: 3.4, kicker: 'Fatos', title: 'Fato vencido\n*não entra* no post.', img: 'fatos-d', to: F(0.2, 0.15, 0.76, 0.5), tsize: 72 },
      { type: 'shot', d: 3.4, kicker: 'Equipe', title: 'Quem cria e\nquem *aprova*.', img: 'equipe-d', to: F(0.2, 0.15, 0.76, 0.5), tsize: 72 },
      { type: 'shot', d: 3.6, kicker: 'No celular', title: 'Aprove\nonde estiver.', img: 'aprovar-3-m', kind: 'phone', to: F(0, 0.03, 1, 0.45) },
      END('Tudo num lugar só.\n*Do pedido ao post.*'),
    ],
  },
];
