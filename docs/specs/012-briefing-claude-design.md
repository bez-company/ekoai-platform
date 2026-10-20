# Briefing para o Claude Design: fase 2 da Ekoai (post de Instagram feito por agentes)

> As telas descritas aqui já foram montadas no protótipo existente (v4):
> https://claude.ai/artifact/55avs7vhgtwKFn9HMAR9Fz . Este texto fica como descrição delas e, se for
> preciso refazer num protótipo novo, dá para colar no Claude Design. Origem: [SPEC 012](012-agentes-instagram-fase-2.md). O
> protótipo da fase 1 (versão 3, design system 06) é a base visual: as telas novas entram no mesmo
> app, com a mesma barra lateral, os mesmos cartões e o mesmo logo das gotas.

## Produto

Ekoai: plataforma em que empresas pequenas e profissionais autônomos cuidam do Instagram com IA. Na
fase 1 a pessoa cria a conta, descreve a empresa (nicho, voz, cores, fontes, logo), chama a equipe e
vê o Início com o checklist. Agora a plataforma passa a **criar o post**: imagem e legenda, na voz
da empresa. A pessoa só aprova, ajusta ou recusa. Uso principal no desktop; no celular a pessoa
confere e aprova.

## Visual

Design system 06 da Ekoai, o mesmo da fase 1: ameixa e pêssego, Sora e DM Mono, cartões com raio 28,
campos com raio 20, botões e etiquetas em pílula, barra lateral em ameixa mesmo no tema claro, texto
sobre o pêssego sempre na tinta (nunca branco). Tokens semânticos, contraste AA. Sem emoji
decorativo.

**Atenção a uma regra do produto:** o post que a pessoa vê é o post do CLIENTE dela (Doce Ponto),
não da Ekoai. Nele valem as cores, as fontes e o logo do perfil da empresa (aqui: vinho `#B83262`,
marrom `#4A2C2A`, Playfair Display nos títulos e DM Sans no texto). A interface em volta é da Ekoai.
Não misturar as duas marcas dentro da imagem do post.

## Telas

Cada uma em desktop e celular, com os estados: vazio, carregando, erro e cheio.

1. **Criar post**
   - Campo de tema (livre) e o atalho "Me sugira um tema".
   - Tipo: *Informativo* (o texto manda: dica, dado, passo a passo), *Atmosfera* (a imagem manda:
     bastidor, produto, clima da marca) ou *Deixar a Ekoai escolher*. Uma frase explica cada um.
   - Formato: feed quadrado 1:1 ou retrato 4:5.
   - Botão "Criar post". Perfil incompleto: aviso que leva ao perfil, sem formulário.
   - Limite do plano visível: "3 de 20 posts este mês".
2. **Gerando**: andamento por etapa (Pensando o tema, Escrevendo a legenda, Desenhando a imagem,
   Conferindo o post), cada uma com estado de feito, em andamento ou falhou. Falha diz a etapa e
   oferece "Tentar de novo". Dá para sair da tela e voltar: o post aparece em Aprovar quando fica
   pronto.
3. **Aprovar**
   - Lista: cada post em cartão pequeno (miniatura, primeira linha da legenda, tipo, quem pediu,
     há quanto tempo). Estado vazio orienta a primeira ação ("Criar o primeiro post").
   - Detalhe: o post dentro da **moldura de um feed do Instagram** (avatar com o logo, nome da
     conta, imagem 1:1 ou 4:5, legenda com "ver mais"). Ao lado, a legenda editável e as hashtags.
   - Atalhos de ajuste, um clique cada: *Encurtar*, *Mais descontraído*, *Mais formal*, *Outro
     CTA*, *Outra direção*. "Outra direção" avisa que conta no limite do mês.
   - Editar o texto da imagem (título e subtítulo) sem gerar tudo de novo.
   - **Aprovar** (primário) e **Recusar**. Recusar abre uma janela: o que não gostou, por aspecto
     (texto, visual, tom, tema, formato, CTA), com campo livre opcional.
   - Avisos do revisor automático em linguagem simples ("O texto da imagem está pequeno para o
     feed. A Ekoai já aumentou"), nunca jargão técnico.
   - Papéis: o leitor vê e dá parecer, sem aprovar; o criador só aprova se a conta liberar.
4. **Aprendizado**: lista das regras que a Ekoai aprendeu com as recusas e edições ("Evitar
   palavras como 'imperdível'", "Preferir legenda de até 3 linhas"), com a origem (recusa do post X,
   edição de Ana), e um interruptor para ligar e desligar cada uma. Estado vazio explica como as
   regras nascem.
5. **Agenda**: os posts aprovados em calendário por dia (semana e mês), cada um com horário. Sem
   Instagram conectado, faixa avisando que a publicação espera a conexão.
6. **Perfil da empresa, nova seção "Fatos e o que nunca dizer"** (dentro de Configurações ›
   Empresa): lista de fatos curtos, cada um com a fonte (site, texto do dono, outro) e um campo
   "Nunca afirmar" (claims que a empresa não pode fazer). Mostrar que o post só afirma o que está
   aqui. Estado vazio: "Sem fatos ainda. A Ekoai escreve só o que não precisa de prova."
7. **Limite do plano atingido**: no Criar post, o botão fica desabilitado e a mensagem diz o que
   fazer (esperar a virada do mês ou falar com a Ekoai), sem culpar a pessoa.

## Dados de exemplo

- Conta **Doce Ponto Confeitaria** (Marília, SP, @doceponto), nicho Alimentação, voz descontraída e
  simples, palavras que nunca usa: imperdível, top demais, gourmet. Diferenciais: entrega no dia em
  Marília, sem conservantes. Logo em SVG vinho, fontes Playfair Display e DM Sans.
- Pessoas: Ana (administradora), Bruno (criador), Carla (leitora).
- Posts de exemplo, em português:
  - *Informativo*: "3 sinais de que o seu bolo está pronto sem abrir o forno" (dica curta, título
    grande na imagem, legenda de 3 linhas, hashtags #confeitaria #bolocaseiro #marilia).
  - *Atmosfera*: foto de bancada com farinha e ovos, legenda de uma linha ("Quarta-feira de massa
    na mão."), sem texto na imagem além do logo.
  - Um post com aviso do revisor, um recusado com motivo "visual" e um aprovado e agendado para
    sexta, 11h.
- Regras aprendidas: "Evitar 'imperdível'", "Legenda de até 3 linhas", "Título da imagem com no
  máximo 6 palavras".
- Fatos: "Entregamos no mesmo dia em Marília" (fonte: texto da dona), "Não usamos conservantes"
  (fonte: site). Nunca afirmar: "o melhor bolo da cidade".

## Restrições de texto da interface

Português, voz ativa, sentence case, o botão com verbo de ação ("Criar post", "Aprovar", "Recusar
post"). Erro diz o que houve e o próximo passo, sem "Oops" e sem culpar a pessoa. Estado vazio
orienta a primeira ação. Sem travessão como pontuação. Sem promessa que a plataforma não cumpre: a
publicação depende do Instagram conectado e a tela diz isso.

## O que entregar

Protótipo navegável com as 7 telas em desktop e celular, os 4 estados de cada uma, e o handoff
bundle (arquivos, conversa e README) para o Claude Code. Link do protótipo vai na SPEC 012 e no
corpo das PRs.
