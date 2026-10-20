# SPEC 012: fase 2, post de Instagram (imagem e legenda) feito por agentes

- **Status:** proposta (aguarda a prova de conceito de design e as decisões em aberto)
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
Tela Aprovar com o post em moldura de feed. Ações: aprovar (entra na grade), editar a legenda e o
texto da imagem (re-renderiza sem chamar o modelo de imagem), atalhos (encurtar, tom, CTA, traduzir),
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

### R6. Agenda
Post aprovado cai no próximo slot livre da conta (a grade que já existe). Sem Instagram conectado
ele fica agendado e a tela diz que a publicação espera a conexão.

## Dados novos (a detalhar na implementação)

| Tabela | Para quê |
| --- | --- |
| `company_facts` | Fatos da empresa: texto, fonte, "nunca afirmar". Escopo por conta, RLS, entra em `TENANT_TABLES`. |
| `generation_runs` | Uma linha por chamada de modelo: conta, brief, etapa, modelo e versão, tokens, imagens, custo, tempo, resultado. |
| `post_designs` | O schema de slots do post (layout, texto de cada slot, referência do visual) para re-renderizar sem IA. |
| `plans.max_posts_per_month` | Limite mensal do plano. |

As tabelas antigas (`briefs`, `assets`, `post_variants`, `pending_approvals`, `feedback`,
`style_rules`) ganham só o que faltar (coluna de tipo do post, vínculo com `post_designs`).

## Telas (protótipo no Claude Design antes do código)

Briefing em [012-briefing-claude-design.md](012-briefing-claude-design.md). Cada tela em desktop e
mobile, com vazio, carregando, erro e cheio:

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
| 3 | Banco: `company_facts`, `generation_runs`, `post_designs`, limite do plano | `rls_test.sql`, cascata da exclusão da conta cobre as tabelas novas |
| 4 | Motor de render (schema de slots para PNG, com os tokens do perfil) | testes de contraste, margem, acento; o mesmo schema gera o mesmo PNG |
| 5 | Agentes e revisor por regra | testes com modelo simulado; uma execução real por tipo de post |
| 6 | Telas: Criar, Aprovar, Aprendizado, fatos no perfil | prints, teste de rota por papel |
| 7 | Custos e limite | teste de limite no servidor, tela de limite |

## Critérios de aceite

1. Uma pessoa sem ajuda pede um post, recebe imagem e legenda, ajusta com um atalho e aprova.
2. O texto desenhado na imagem sai com a fonte da lista curada e sem erro de acento, sempre.
3. O post não afirma número, preço ou claim que não esteja na base de fatos.
4. Palavra proibida do perfil nunca aparece na legenda nem na imagem.
5. O custo de cada post aprovado está registrado e a conta para no limite do plano.
6. Excluir a conta apaga também as tabelas novas e os PNGs do bucket.
7. Leitor não cria nem aprova (404 e 403 como nas outras telas).

## Decisões em aberto (do Matheus)

1. **Critério da prova de conceito:** os números do briefing (aprovação de primeira acima de 50%,
   nota até 0,5 ponto do controle de templates, custo por post aprovado abaixo de R$ 2) são chute
   inicial. Quais valem?
2. **Piloto de perfil diferente:** a prova pede uma terceira marca de perfil oposto à Pilar e ao
   Ekoai (pequeno comércio ou influenciador). Quem é?
3. **Quem avalia às cegas:** três pessoas, ao menos uma de fora da empresa.
4. **Limite de posts por mês no plano inicial** (só como dado agora; preço fica para depois).
5. **Rótulo de conteúdo gerado por IA** na legenda: padrão ligado, desligado ou escolha da conta?
6. **Prazo da revisão do app na Meta** decide o cronograma da publicação (R5 da SPEC 011): começar o
   pedido de revisão já?
