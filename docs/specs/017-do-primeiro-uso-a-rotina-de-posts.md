# SPEC 017: do primeiro uso à rotina de posts (feedback do staging de 22/10/2026)

- **Status:** proposta, aguarda as decisões do Matheus (fim do arquivo) e o protótipo
- **Data:** 2026-10-22
- **Card:** BEZ-229 (pai) e filhos
- **Depende de:** [SPEC 011](011-plataforma-generica-fase-1.md) (Início, checklist, Redes),
  [SPEC 012](012-agentes-instagram-fase-2.md) (geração, Aprovar, Agenda),
  [SPEC 003](003-ideia-reaproveitamento-e-feedback.md) (feedback por aspecto que vira regra)
- **Protótipo:** a fazer, no mesmo artifact da fase 1 e 2 (https://claude.ai/artifact/55avs7vhgtwKFn9HMAR9Fz)

## Problema

O primeiro uso real do staging, com o Instagram conectado, mostrou que criar um post funciona, mas
a plataforma ainda não leva a pessoa até a rotina: publicar com frequência sem pensar no que postar.

1. **Saber o que postar é a dor maior**, mais que fazer a arte. Hoje a Ekoai só reage a um tema
   digitado; ninguém diz "amanhã vale um bastidor, porque os dois últimos foram dicas".
2. **Quem já tem foto boa não tem caminho.** A equipe de mídia de um cliente fotografa os eventos;
   a foto boa só precisa de legenda e horário. Hoje todo post passa pela IA de imagem.
3. **O caminho até a primeira publicação não está guiado.** Sem horários na agenda, aprovar
   travava (corrigido na PR #108); posts criados e esquecidos se perdem em Aprovar.
4. **Telas com ruído ou pouco úteis:** header só com o nome e o sino, coluna "O que a Ekoai vai
   usar" que repete o perfil, tipos de post (informativo e atmosfera) que a pessoa não entende,
   Histórico que não mostra o post nem as métricas, horários escondidos em Configurações.

## Resultado esperado

1. Em menos de 10 minutos depois de criar a conta, a pessoa conecta o Instagram, aprova o primeiro
   post e vê ele agendado num horário que ela escolheu (ou publicado na hora).
2. Toda semana a Ekoai propõe o que postar, em sequência que faz sentido, usando as fotos da
   empresa quando existem. A pessoa aprova, troca ou pula.
3. Foto pronta vira post em 30 segundos: foto, legenda (escrita ou pela IA lendo a foto), horário.

**Métricas de produto:** tempo até a primeira publicação; posts publicados por semana por conta;
% de sugestões do coordenador aprovadas; posts criados que nunca saem de Aprovar (deve cair).

**Fora de escopo:** Reels e vídeo, Stories (fica como formato futuro, ver decisão 5), outras
redes (BEZ-210), cobrança.

## Decisões propostas

Cada uma tem a recomendação e o motivo. As marcadas com **(Matheus)** esperam a sua resposta.

1. **Fluxo de estados com nome, uma tela para cada.** Aprovar = só pendentes. Agenda = aprovados
   (agendado, na fila sem horário, não publicado). Histórico = publicados. A etiqueta do post
   segue o estado (Para aprovar, Agendado, Na fila, Publicado, Não publicado). Já entrou na PR #108;
   a spec só registra para as telas novas seguirem.

2. **Navegação sem header.** O header fica sem função (nome da conta e sino). O sino, o nome da conta
   e o perfil da pessoa vão para a barra lateral: conta no topo (com troca de conta, quando
   houver), sino ao lado do logo, pessoa no rodapé (perfil, sair). No celular, a barra de cima
   fica só com logo e sino, e a navegação continua embaixo. Ganha 56 px de altura em toda tela.

3. **Início com o que fazer agora.** Depois do checklist feito, o Início vira um painel:
   - **Próximo passo** (um só, o mais importante): "2 posts esperando aprovação", "Agenda sem
     horário", "Instagram desconectado".
   - **Sugestões da semana** do coordenador (decisão 8), com "Criar este post".
   - **Atalhos:** Criar post com IA, Publicar uma foto, Banco de imagens, Agenda.
   - **Esta semana:** os próximos agendados em miniatura e o último publicado com as métricas.

4. **Criar post em uma coluna, com o pedido em linguagem natural.** Sai a coluna "O que a Ekoai
   vai usar" (vira um link "Usa o perfil da empresa · editar"). O campo principal passa a ser
   **"Descreva o que você quer no post"**, com exemplo no placeholder e "Me sugira uma ideia". Abaixo,
   em blocos: anexar foto (opcional), objetivo do post (decisão 6) e formato (decisão 5). No desktop,
   a prévia do formato escolhido fica à direita do formulário, no lugar da coluna que saiu.

5. **Formatos do Instagram.** A API de publicação aceita imagem de feed entre 4:5 e 1.91:1; 3:4
   aparece em algumas fontes desde 2025 mas não está confirmado na documentação da Meta.
   Recomendação: **Retrato 4:5** (padrão, ocupa mais tela no feed), **Quadrado 1:1** e
   **Paisagem 1.91:1** (para foto de evento horizontal, só no caminho "publicar foto"). Carrossel
   segue no BEZ-199. **Story 9:16** a API aceita, mas exige outro motor de render: fica para depois.
   3:4 só entra depois de testar a publicação numa conta real.

6. **Tipo vira objetivo, com exemplo.** "Informativo" e "atmosfera" são o jeito de montar a imagem,
   não o que a pessoa quer. Ela escolhe o **objetivo**, e a Ekoai decide a montagem por dentro:

   | Objetivo | Exemplo | Montagem (interna) |
   | --- | --- | --- |
   | Ensinar algo (dica) | "3 jeitos de conservar o bolo" | texto manda |
   | Mostrar o produto ou serviço | "O bolo de pote de ninho" | imagem manda |
   | Bastidores | "Como a massa é feita" | imagem manda |
   | Novidade ou aviso | "Abrimos domingo", "lançamento" | texto manda |
   | Promoção | "Leve 3, pague 2 até sexta" | texto manda |
   | Prova social | depoimento, avaliação de cliente | texto manda |
   | Data comemorativa | Dia das Crianças, aniversário da loja | qualquer |
   | Conversa com o público | pergunta, "qual você prefere?" | texto manda |
   | Deixar a Ekoai escolher | (o coordenador decide pela sequência) | qualquer |

   Cada um vira um cartão com uma frase e um exemplo. O objetivo também alimenta o coordenador
   (decisão 8), que equilibra a sequência por objetivo.

7. **Foto da pessoa: anexo com perguntas curtas, não um chat aberto.** O chat livre parece natural,
   mas custa mais, é lento e a pessoa não sabe o que pedir. Recomendação: ao anexar a foto, a Ekoai
   olha a foto (modelo de visão) e pergunta **só o que ficou ambíguo**, com respostas de um clique:
   - "Como usar a foto?" **Como está, só a legenda** · **De fundo, com um título por cima** ·
     **Dentro do layout da marca** · **Só como inspiração para outra imagem**.
   - "O que escrever?" (só se o pedido não disse) com 2 ou 3 sugestões tiradas da foto, mais
     "escrever eu".
   Depois disso, o post é gerado normal. Se a pessoa quiser falar livre, há o campo de texto. Isso
   é um chat guiado (perguntas e respostas em balões), mas com fim claro em no máximo 2 perguntas.
   **(Matheus)** confirmar se prefere esse formato ao chat aberto.

8. **Coordenador de conteúdo (agente proativo).** Um job diário por conta olha: os últimos posts
   publicados e agendados (objetivo, formato, quando), os horários livres da agenda, as fotos do
   banco ainda não usadas, as datas comemorativas próximas e, quando houver, as métricas (BEZ-183).
   Ele propõe os posts dos próximos 7 dias, um por horário livre, cada um com o motivo em uma frase:
   "Quinta 18h: bastidor com a foto 'forno' do banco. Os dois últimos foram dicas."
   - Onde aparece: Início (Sugestões da semana), Agenda (horário livre mostra a sugestão) e um
     aviso semanal.
   - Ação: **Criar este post** (vai para a geração e cai em Aprovar), **Trocar** (outra sugestão)
     ou **Pular**. Nada é gerado sem a pessoa pedir: a geração gasta o limite do plano.
   - Regra de sequência inicial (antes de ter métrica): não repetir objetivo duas vezes seguidas;
     no máximo 1 promoção a cada 4 posts; pelo menos 1 foto real por semana quando o banco tem foto.
     Com métricas, o coordenador puxa para o objetivo que mais engaja na conta.
   - Um nível acima, opcional por conta: **piloto automático**, que já gera os posts sugeridos e
     deixa em Aprovar 2 dias antes do horário. **(Matheus)** ligar só depois de medir aprovação.

9. **Banco de imagens.** Junta com o BEZ-198 (galeria de fotos). Upload em lote, a Ekoai descreve
   cada foto (visão) para poder buscar e sugerir, e marca **usada** quando a foto vai num post
   publicado (com o link do post). O coordenador prefere foto não usada; foto usada pode voltar
   depois de 90 dias. Filtros: não usadas, usadas, por tema.

10. **Publicar foto sem IA.** Caminho próprio, atalho no Início e em Criar post: escolher foto
    (upload ou banco), formato (corte 4:5, 1:1 ou 1.91:1 com prévia), legenda **escrita** ou
    **gerada pela IA lendo a foto** (editável), e então **Agendar** ou **Publicar agora**. Não passa
    por Aprovar quando quem publica é administrador; criador sem permissão de aprovar manda para
    Aprovar. A legenda pela IA é uma chamada curta de texto com visão: não conta como post no limite
    do plano (só a geração de imagem conta). **(Matheus)** confirmar a regra do limite.

11. **Onboarding até a primeira publicação.** Duas partes:
    - **Perguntas rápidas (uma tela, 3 perguntas, pode pular):** Como conheceu a Ekoai? O que
      espera (vender mais, manter o perfil ativo, ganhar tempo, crescer seguidores)? Quantas vezes
      por semana quer postar (2, 3, 5)? A última já **cria os horários padrão** (ex.: 3 vezes = ter,
      qui, sáb às 18h), editáveis na Agenda. As respostas vão para o PostHog e para o coordenador.
    - **Guia com verificação**, no Início (o checklist atual cresce), cada passo marcado pelo dado
      real, não por clique: perfil da empresa, **conectar o Instagram** (conta ativa em
      social_accounts), **criar o primeiro post**, **aprovar**, **horários na agenda**, **primeira
      publicação** (post publicado de verdade). Ao entrar em cada tela pela primeira vez, uma dica
      curta aponta o que fazer ali (coach mark). Some quando a primeira publicação
      sai.

12. **Posts que se perdem.** Contador em Aprovar na barra lateral (já existe) e no Início; post em
    Aprovar há mais de 3 dias gera aviso; há 14 dias, a Ekoai pergunta se arquiva. O coordenador
    liga cada post aprovado a um horário, então "criar e esquecer" vira "aprovar e já está na agenda".

13. **Agenda com os horários dentro dela.** A agenda vira semana (padrão) e mês. Os horários de
    publicação aparecem como espaços na grade: vazio (com a sugestão do coordenador, decisão 8),
    ocupado (miniatura do post) ou na fila. "Editar horários" abre ali mesmo (dias da semana e
    hora, por rede). Configurações deixa de ter a grade (fica só a pausa). A fila sem horário
    fica num painel ao lado.

14. **Histórico como o feed.** Grade 3 colunas como o perfil do Instagram (mesma moldura do
    Aprovar). Cada post abre o detalhe: o post na moldura, a legenda inteira, as métricas do
    Instagram (curtidas, comentários, salvos, alcance, engajamento, ver BEZ-183) e o feedback da
    pessoa por aspecto (texto, visual, tom, tema, formato, CTA), que alimenta o Aprendizado. Sai o
    cartão grande de hoje.

## Requisitos (por entrega)

| Entrega | O quê | Card |
| --- | --- | --- |
| 0 | Correções do uso (fila, publicar agora, ver mais, botões) | BEZ-230 (PR #108) |
| 1 | Protótipo das telas desta spec (desktop e mobile, estados vazio, carregando, erro e cheio) | BEZ-231 |
| 2 | Navegação sem header e Início com atalhos e próximo passo | BEZ-232 |
| 3 | Agenda com horários e semana/mês; Configurações sem a grade | BEZ-233 |
| 4 | Onboarding: perguntas rápidas, horários padrão e guia com verificação | BEZ-234 |
| 5 | Criar post em uma coluna: pedido livre, objetivo, formatos 4:5, 1:1 | BEZ-235 |
| 6 | Publicar foto sem IA (legenda escrita ou por visão, 1.91:1) | BEZ-236 |
| 7 | Banco de imagens com "usada" | BEZ-198 |
| 8 | Foto anexada no Criar post, com perguntas curtas | BEZ-237 |
| 9 | Histórico como o feed, com métricas e feedback por post | BEZ-238 + BEZ-183 |
| 10 | Coordenador de conteúdo (sugestões da semana) | BEZ-239 |

Ordem pensada para destravar a primeira publicação antes (1 a 4), depois o caminho de foto (5 a 8),
depois o que depende de dado acumulado (9 e 10).

## Dados novos (rascunho, detalhar na entrega)

- `onboarding_answers` (tenant, source, goal, posts_per_week, answered_at).
- `media_assets` (tenant, storage_key, width, height, description, tags, used_at, used_post_id).
- `briefs.goal` (objetivo da decisão 6) e `briefs.ratio`; `briefs.asset_id` quando usa foto.
- `content_suggestions` (tenant, slot_at, goal, asset_id, reason, status sugerida/criada/pulada).
- `post_metrics` (vem do BEZ-183).

## Critérios de aceite

1. Conta nova sai das perguntas com horários criados e chega à primeira publicação seguindo só o
   guia, sem abrir Configurações.
2. Foto pronta é publicada (ou agendada) sem gerar imagem por IA, com legenda escrita ou lida da foto.
3. O Início mostra o próximo passo e as sugestões da semana; cada sugestão diz o motivo.
4. Histórico mostra o post como no feed, com métricas e feedback por aspecto.
5. Protótipo aprovado antes do código de cada tela; prints antes e depois em cada PR.

## Decisões do Matheus

- [ ] Decisão 7: perguntas curtas com respostas de um clique (recomendado) ou chat aberto?
- [ ] Decisão 6: a lista de objetivos está boa? Algum nicho pede outro (ex.: cardápio, imóvel)?
- [ ] Decisão 8: piloto automático entra só depois de medir a taxa de aprovação das sugestões?
- [ ] Decisão 10: legenda pela IA lendo a foto não conta no limite do plano?
- [ ] Decisão 11: as 3 perguntas do onboarding; alguma a mais (ramo, tamanho da equipe)?
