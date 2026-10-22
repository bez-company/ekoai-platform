# SPEC 012: fase 2, post de Instagram (imagem e legenda) feito por agentes

- **Status:** proposta (decisões do Matheus registradas em 20/10/2026; aguarda a prova de conceito de design)
- **Data:** 2026-10-20
- **Depende de:** [SPEC 011](011-plataforma-generica-fase-1.md) (perfil da empresa, logo, equipe),
  [SPEC 003](003-ideia-reaproveitamento-e-feedback.md) (ideia, feedback que vira regra),
  [ADR 0009](../adr/0009-midia-em-bucket-privado-servida-pela-plataforma.md) e
  [ADR 0014](../adr/0014-logo-da-empresa-por-rota-autenticada.md) (arquivos no bucket),
  [prova de conceito de design](../analises/2026-10-19-poc-design-briefing.md) e
  [ideias da conversa de 19/10](../analises/2026-10-19-ideias-conversa-chatgpt.md)

## Problema

A fase 1 deixou a conta pronta: a empresa está descrita (nicho, o que vende, voz, cores, fontes,
logo) e a equipe tem papéis. Mas a plataforma não cria nenhum post. As telas Aprovar, Agenda,
Publicados e Aprendizado estão vazias. O pipeline antigo que gerava post existe só na tag
`pilar-v1`, escrito para uma marca (a Pilar), e nada dele lê o perfil novo.

## Resultado esperado

1. A pessoa pede um post (tema livre ou "me sugira um") e recebe **um post pronto de Instagram**:
   imagem e legenda, na voz da empresa, com as cores, as fontes e o logo dela.
2. Ela **aprova, ajusta ou recusa** numa tela só. Ajustar é um clique (encurtar, outro tom, outro
   CTA, outra direção). Recusar pede o motivo por aspecto, e o motivo vira regra (SPEC 003).
3. O post aprovado entra na grade de horários (Agenda). A publicação de verdade depende da conexão
   com o Instagram (R5 da SPEC 011) e fica fora desta SPEC.
4. A conta mostra **quanto cada post custou** e respeita o limite do plano.

**Métrica de produto:** tempo até o primeiro post aprovado. Custo por post aprovado é o número que
decide o preço depois (o gate do ADR 0004 continua valendo: sem preço antes de validar com a Pilar).

**Fora de escopo:** vídeo e Reels, carrossel, três direções por post, publicação automática por prazo
vencido, referências de terceiros (upload de print), biblioteca de inspirações, agência e portal do
cliente, cobrança. Cada um é uma SPEC própria depois desta.

## Decisões propostas

Cada uma tem uma recomendação e o motivo. As que dependem da prova de conceito dizem isso.

1. **Motor híbrido: a IA gera só o visual; texto, logo e grade são desenhados por código.**
   O modelo de imagem faz fundo, ilustração ou foto. O texto do post, o logo e a grade entram por
   código (HTML/SVG para PNG) com os tokens da marca do perfil. Motivo: modelo de imagem ainda erra
   acento e palavra em português, e texto desenhado por código nasce editável e com a fonte certa
   da lista curada. *Gate:* vale se a prova de conceito mostrar o híbrido acima da imagem inteira
   por IA (critérios no briefing da prova). Se só a imagem inteira passar, a fase 2 usa ela e adia
   as camadas editáveis.
2. **Uma direção por post, com "outra direção" e atalhos de ajuste.** Três direções triplicam o custo
   e o mercado foi no sentido oposto (o Metricool trocou 5 opções por 1 post com atalhos).
3. **Dois tipos de post, escolhidos pelo agente e trocáveis pela pessoa.** *Informativo*: o texto
   manda (dica, dado, passo a passo), o visual apoia. *Atmosfera*: a imagem manda, a legenda é curta
   (bastidor, produto, clima da marca). O tipo muda o layout e a densidade de texto.
4. **Cadeia de quatro agentes, com orquestração e agendamento sem IA.** Estrategista (tema, ângulo,
   tipo), redator (legenda, hashtags, CTA do perfil), diretor de arte (layout em slots e pedido do
   visual) e revisor. O revisor é **por regra, não por modelo**: contraste mínimo, tamanho mínimo da
   fonte, margem de segurança do feed, acento e ortografia do texto desenhado, palavras proibidas do
   perfil e fatos fora da base. Reprovou, volta ao agente com o motivo (no máximo 2 voltas).
5. **O post só afirma o que está na base de fatos da empresa.** Novo no perfil: fatos curtos, cada
   um com a **fonte** (site, texto do dono, outro) e uma lista "nunca afirmar" (claims sensíveis;
   engenharia e saúde têm regra de conselho profissional). Número, preço, prazo e funcionalidade só
   saem se estiverem na base.
6. **Modelos pelo Vertex AI, no projeto do Google Cloud do ambiente.** Mesma conta de serviço, sem
   chave no repositório nem no navegador, e os dados ficam no Google Cloud da BEZ (LGPD). *A
   validar na prova de conceito:* quais modelos de imagem e de texto o Vertex oferece na região e o
   custo real. O Gemini direto por chave (que já existe no código antigo) fica só como plano B.
7. **Todo passo grava o custo.** Uma linha por chamada: modelo e versão, tokens, imagens, custo em
   centavos e tempo. É a base do "custo por post aprovado" e do limite por plano.
8. **Reuso do que existe:** as tabelas `briefs`, `assets`, `post_variants`, `pending_approvals`,
   `feedback` e `style_rules`, a aprovação por ideia da SPEC 003 e o laço de feedback para regra. A
   geração em si é reescrita como agentes sobre o perfil (o código antigo serve de consulta na tag
   `pilar-v1`, nunca de cópia).
9. **Autonomia como dado, sem tela.** A conta guarda por tarefa (planejar, gerar, publicar) se pede
   aprovação ou é automática. Nesta fase tudo pede aprovação; "publicar no prazo" não existe.

## Requisitos

### R1. Pedir um post
Tela Criar post: tema livre ou "me sugira", tipo (informativo, atmosfera ou deixar o agente
escolher) e formato (feed quadrado 1:1 ou retrato 4:5). Só quem tem `content.create` (administrador
e criador). Com o perfil incompleto (falta nicho, o que vende ou para quem), a tela leva ao perfil.

### R2. Gerar
O pedido vira um `brief`. O orquestrador chama os agentes em ordem, grava cada passo e o custo, e
devolve um post: imagem final (PNG no bucket, caminho por conta), legenda, hashtags e o schema de
slots usado. Mostra o andamento por etapa. Falha numa etapa diz qual e oferece tentar de novo; nunca
deixa o pedido preso. O limite do plano é checado antes de gastar.

### R3. Aprovar
Tela Aprovar com o post em moldura de feed. Ações: aprovar (entra na grade), editar a legenda e
**editar o texto direto na imagem** (botão "Editar texto da imagem": cada texto ganha uma caixa
tracejada, a pessoa clica no texto dentro da imagem e digita ali; a imagem se redesenha enquanto ela
digita, sem chamar o modelo de imagem e sem gastar do limite), atalhos (encurtar, tom, CTA, traduzir),
outra direção (nova geração, conta no custo) e recusar com motivo por aspecto. Aprovar exige
`content.approve` (administrador; criador se a conta liberar, como hoje). Leitor dá parecer.

### R4. Aprender
Motivo de recusa e edição viram regra (SPEC 003): o feedback dos últimos 14 dias entra no prompt
como "evite" e o `reflect` semanal consolida em `style_rules`. A tela Aprendizado lista as regras,
com origem, e dá para ligar e desligar cada uma.

### R5. Custos e limites
`generation_runs` guarda o custo de cada passo. O plano ganha um limite de posts por mês (dado, sem
cobrança). A tela mostra "N de M posts este mês" e, no limite, diz o que fazer (esperar a virada do
mês ou falar com a Ekoai). Post manual e edição de texto não contam.

### R5.1. Controle de custo de IA (complemento, SPEC 013 E1.14)

Gastar uma vez, parar a tempo e saber de quem foi o gasto. O R5 diz o que o plano limita; isto diz
como a geração garante o limite e não paga duas vezes pela mesma coisa.

1. **Reserva antes de gastar.** O limite do plano é checado por gatilho no banco, no padrão de
   `app.check_seat_limit` (ADR 0012). A geração só chama um modelo depois de gravar, numa transação, uma
   linha em `generation_runs` com `status = reserved` que confere "posts do mês mais reservas abaixo do
   máximo". Duas gerações ao mesmo tempo no último post: só uma reserva passa. Sem reserva, nenhuma
   chamada ao modelo.
2. **Idempotência.** `generation_runs` tem chave única por (conta, brief, etapa, hash da entrada). Pedido
   repetido (duplo clique, nova tentativa de rede, repetição da fila) devolve o resultado gravado, não
   chama o modelo e não cobra. "Outra direção" é entrada nova (muda o hash) e conta no limite.
3. **Teto por post.** No máximo 2 voltas do revisor (decisão 4) e no máximo N chamadas de imagem por
   brief (N inicial 3, a calibrar na prova). Estourou: o post sai com o melhor resultado ou falha com
   mensagem clara. Nunca laço.
4. **Cache do visual.** O fundo ou ilustração gerado fica guardado por hash (prompt, modelo, versão e
   formato). Trocar legenda, editar texto ou re-renderizar com outro tema não chama o modelo de imagem.
   *A validar na prova:* se o mesmo visual serve ao trocar entre 1:1 e 4:5.
5. **Atribuição do custo.** Toda chamada ao Vertex leva labels (`product`, `env`, `step` e o id da conta,
   nunca nome nem dado pessoal) para a exportação de faturamento separar o custo por conta
   (SPEC 013, E1.16). `generation_runs.cost_cents` é a estimativa na hora; a exportação é a conciliação
   do mês, e divergência acima de 15% vira ajuste da tabela de preços do código. *A confirmar na
   prova:* que a chamada de geração aceita labels e que eles chegam à exportação.
6. **Freio no provedor.** Além do limite do plano, a cota de requisições do Vertex fica limitada por
   projeto e há um orçamento do projeto filtrado pelo serviço Vertex AI, com alerta. Um bug que
   contorne o banco não gasta além da cota. Valores iniciais definidos depois da prova.
7. **Degradação.** No limite do plano ou do provedor, "novo post" e "outra direção" param com a
   mensagem do R5; editar texto, aprovar, agendar, publicar e baixar continuam, porque não usam modelo.
   Falha do provedor (429, 5xx): até 2 tentativas com espera crescente e depois erro claro; o pedido
   nunca fica preso (R2).
8. **Anomalia.** Alerta quando o custo por post aprovado da semana passa de 2 vezes a mediana das 4
   semanas anteriores, ou quando uma conta gasta uma fração grande do limite em uma hora (valores a
   calibrar com a prova).

### R6. Agenda
Post aprovado cai no próximo slot livre da conta (a grade que já existe). Sem Instagram conectado
ele fica agendado e a tela diz que a publicação espera a conexão.

## Dados novos (migration 0023, entrega 3)

O motor ficou decidido na [ADR 0017](../adr/0017-motor-de-design-hibrido-com-biblioteca-de-layouts.md)
(híbrido, com biblioteca de famílias de layout). O que conta no limite mensal é cada **visual** gerado
pelo modelo de imagem: o primeiro de um post e cada "outra direção"; texto, render e revisão não
contam, e visual que falhou libera a vaga. O mês é o do calendário em UTC.

| Tabela | Para quê |
| --- | --- |
| `company_facts` | Fatos da empresa: texto, fonte, "nunca afirmar". Escopo por conta, RLS, entra em `TENANT_TABLES`. |
| `generation_runs` | Uma linha por chamada de modelo: conta, brief, etapa, modelo e versão, tokens, imagens, custo, tempo, resultado. Com `status` (`reserved`, `done`, `failed`) e chave única de idempotência (R5.1). |
| `post_designs` | O schema de slots do post (layout, texto de cada slot, referência do visual) para re-renderizar sem IA. Cada slot de texto é editável na imagem; o motor refaz a quebra de linha e o tamanho da fonte a cada edição e o revisor confere de novo (por exemplo, título acima de 6 palavras). O logo e as cores não se editam aí: vêm do perfil. |
| `plans.max_posts_per_month` | Limite mensal do plano. |

As tabelas antigas (`briefs`, `assets`, `post_variants`, `pending_approvals`, `feedback`,
`style_rules`) ganham só o que faltar (coluna de tipo do post, vínculo com `post_designs`).

## Telas (protótipo no Claude Design antes do código)

**Protótipo (v5 aprovada em 21/10/2026 para as telas da fase 1 do post; v9, com Pedir ajuste, versões e Estúdio, aprovada no mesmo dia e deixada para a fase 2, BEZ-193 a 196):**
https://claude.ai/artifact/55avs7vhgtwKFn9HMAR9Fz . Troque a tela no seletor do alto: Criar post,
Gerando o post, Aprovar (16 estados, com a edição do texto direto na imagem), Agenda, Aprendizado, Fatos da empresa (em Configurações) e o
Início com a criação de posts. Cada uma tem os estados vazio, carregando, erro e cheio quando se
aplicam, desktop e celular, e os quatro papéis. O post de exemplo mostra o motor híbrido: o visual
é só um fundo ilustrado de apoio e o texto, o selo e o logo são desenhados por código (aqui em SVG)
com as cores e a fonte do perfil da empresa. As telas da fase 1 foram portadas na entrega 6; a edição direta na imagem, o Pedir ajuste, as versões
e o Estúdio ficam para a fase 2.

O briefing em [012-briefing-claude-design.md](012-briefing-claude-design.md) segue valendo como
descrição das telas. Cada tela em desktop e mobile, com vazio, carregando, erro e cheio:

1. Criar post (pedido) e o andamento da geração.
2. Aprovar: lista de posts e o detalhe com moldura de feed, atalhos e recusa por aspecto.
3. Aprendizado: as regras, com ligar e desligar.
4. Agenda com os posts aprovados.
5. Perfil da empresa: a nova seção "Fatos e o que nunca dizer".
6. Limite do plano atingido.

## Ordem de entrega

| # | Entrega | Verificação |
| --- | --- | --- |
| 0 | **Prova de conceito de design** (script isolado, sem tela nem tabela), decide imagem inteira por IA ou híbrido e mede o custo por post aprovado | critérios definidos antes de rodar, no briefing da prova |
| 1 | ADR do motor de render e do modelo (Vertex AI) | decisão registrada com os números da prova |
| 2 | Protótipo aprovado no Claude Design | link na SPEC e nas PRs |
| 3 | Banco: `company_facts`, `generation_runs` (com reserva e chave de idempotência), `post_designs`, limite do plano | `rls_test.sql`, cascata da exclusão da conta cobre as tabelas novas; teste de reserva concorrente contra Postgres real |
| 4 | Motor de render (schema de slots para PNG, com os tokens do perfil) | testes de contraste, margem, acento; o mesmo schema gera o mesmo PNG |
| 5 | Agentes e revisor por regra | testes com modelo simulado; uma execução real por tipo de post |
| 6 | Telas: Criar, Aprovar, Aprendizado, fatos no perfil | prints, teste de rota por papel |
| 7 | Custos e limite (R5.1: labels do Vertex, cota e orçamento do provedor, alerta de anomalia, cache do visual) | teste de limite no servidor, tela de limite, labels conferidos na exportação de faturamento, cota conferida por `gcloud` |

## Critérios de aceite

1. Uma pessoa sem ajuda pede um post, recebe imagem e legenda, ajusta com um atalho e aprova.
2. O texto desenhado na imagem sai com a fonte da lista curada e sem erro de acento, sempre.
3. O post não afirma número, preço ou claim que não esteja na base de fatos.
4. Palavra proibida do perfil nunca aparece na legenda nem na imagem.
5. O custo de cada post aprovado está registrado e a conta para no limite do plano.
5.1. Dois pedidos idênticos seguidos geram uma linha em `generation_runs` e uma cobrança. Duas gerações
   ao mesmo tempo no último post do plano: uma passa e a outra recebe o aviso de limite (teste contra
   Postgres real). Sem reserva gravada, o modelo simulado falha se for chamado. A chamada ao Vertex leva
   os labels e a cota do provedor está limitada no projeto.
6. Excluir a conta apaga também as tabelas novas e os PNGs do bucket.
7. Leitor não cria nem aprova (404 e 403 como nas outras telas).

## Decisões do Matheus (20/10/2026)

Cartão: BEZ-75.

1. **Critérios da prova de conceito:** os do briefing. Aprovação de primeira acima de 50% e acima da
   imagem inteira por IA; nota até 0,5 ponto do controle de templates; custo por post aprovado
   abaixo de R$ 2; zero erro de acento no texto renderizado por código.
2. **Marcas da prova:** quatro, com 5 briefs por marca (20 no total). Pilar (empresa técnica),
   Ekoai (software), BEZ Company (holding: posicionamento de marca, não venda de software) e
   Projeto Fé (ONG com crianças e esporte, perfil oposto aos outros três).
3. **Quem avalia às cegas:** o Matheus e mais duas pessoas, ao menos uma de fora da BEZ.
4. **Limite do plano inicial:** 20 posts por mês (só dado, sem preço).
5. **Rótulo de conteúdo gerado por IA na legenda:** desligado por padrão, a conta liga se quiser.
   Confirmar com a advogada antes do lançamento (BEZ-32).
6. **Revisão do app na Meta:** começar a preparar agora ([meta-app-review](../arquitetura/meta-app-review.md), BEZ-78).

### Cuidados com o Projeto Fé

- O perfil e o logo entram pela própria plataforma no staging e saem pela exportação de dados da
  conta. É a entrada da prova e também um teste real da fase 1.
- Criança: nada de rosto de criança gerado por IA com aparência de foto, e foto real só com
  autorização de quem responde pela criança. A prova usa ilustração, bola, quadra, mãos e cenas
  sem rosto reconhecível.
- Ficha de marca, posts e notas da prova ficam fora deste repositório (público). No repositório
  entra só a conclusão, sem dado de marca.
