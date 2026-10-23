# SPEC 022: análise do público, conteúdo que funciona e horários recomendados

- **Status:** proposta (23/10/2026). Aguarda o protótipo no Claude Design e as 7 decisões abaixo; nenhum código de tela antes disso
- **Data:** 2026-10-23
- **Cards:** BEZ-206 (esta spec e as entregas)
- **Depende de:** BEZ-183 (coleta de métricas por post, entregue em `lib/instagram-metrics.ts`),
  BEZ-264 (permissão opcional `instagram_business_manage_insights` no login do Instagram),
  [SPEC 017](017-do-primeiro-uso-a-rotina-de-posts.md) (Publicados e Agenda › Horários)
- **Liga com:** BEZ-201 / [SPEC 019](019-estudio-incremental-e-aprendizado-com-a-edicao.md) (aprendizado da conta:
  o que o público prefere entra na mesma tela de Aprendizado), [SPEC 018](018-objetivos-campanhas-e-fatos.md)
  (a análise de efeito por regra fica aqui quando houver posts suficientes)
- **Protótipo:** pendente (seção "Telas")

## Problema

Publicados mostra curtidas, comentários e alcance de cada post, e a Agenda tem uma grade de horários que a
pessoa escolheu no chute. Falta ligar as duas pontas: o que o público de fato prefere, quem ele é e quando
está ativo. Hoje a pessoa não tem como saber se "informativo" rende mais que "atmosfera", nem se vale mudar
o horário das 9h.

## Resultado esperado

1. **Conteúdo que funciona.** Em Publicados › Análise, o engajamento médio por tipo (informativo x
   atmosfera), por formato (imagem, carrossel) e por tema, mais o post de melhor resultado. Cada comparação
   diz quantos posts entram nela.
2. **Público.** Faixa etária e gênero dos seguidores e, quando a Meta devolver, o horário em que estão online.
3. **Horários recomendados.** Em Agenda › Horários, a linha "Poste nos horários em que seu público está mais
   ativo" com até 3 horários sugeridos e um botão que abre a grade já com eles marcados. Quem salva é a pessoa.
4. **Vira aprendizado.** O que a análise concluir aparece em Aprendizado como observação da conta
   ("Posts informativos renderam 1,8x o engajamento dos de atmosfera nos últimos 60 dias") e alimenta o
   planejamento de ideias como preferência, nunca como regra obrigatória.
5. **Sem número inventado.** Sem permissão, sem seguidores suficientes ou sem posts suficientes, a tela diz o
   que falta e qual é o próximo passo.

## O que a Meta entrega (conferido na documentação em 23/10/2026)

Fonte: [Instagram Account Insights](https://developers.facebook.com/docs/instagram-platform/api-reference/instagram-user/insights),
Instagram API com Instagram Login (`graph.instagram.com`), permissão `instagram_business_manage_insights`.

| Dado | Endpoint | Limites |
| --- | --- | --- |
| Faixa etária e gênero | `GET /{ig-user-id}/insights?metric=follower_demographics&period=lifetime&metric_type=total_value&breakdown=age` (e `gender`) | só com 100 seguidores ou mais; top 45; atraso de até 48 h; `timeframe` obrigatório |
| Quem engaja, por faixa e gênero | `metric=engaged_audience_demographics`, mesmos parâmetros | só com 100 interações no período |
| Horário online dos seguidores | `online_followers` | **não consta na tabela de métricas da página atual**; só aparece na nota de limitações (100 seguidores, 30 dias). Tratar como incerto |

A página se contradiz em dois pontos (o `timeframe` `last_30_days` aparece como removido na v20 e ainda é
usado no exemplo; `breakdown` x `breakdowns`). A coleta valida a resposta e guarda a resposta crua, então um
formato novo não quebra a tela, só deixa o dado como "indisponível".

## Decisões (recomendação em negrito)

1. **Fonte do horário recomendado.** A base é o desempenho dos **próprios posts por dia da semana e faixa de
   hora** (engajamento = interações / alcance, já calculado). `online_followers`, se a Meta devolver, entra
   como reforço e muda o texto ("seu público está online às 19h"). **Próprios posts primeiro**: funciona sem
   permissão de demografia e não depende de uma métrica que a documentação não confirma.
2. **Quando recomendar.** Só com **pelo menos 12 posts publicados com alcance** na rede, em pelo menos 3 horários
   diferentes. Antes disso a linha diz "Faltam N posts para recomendar horários". Alternativa: recomendar
   com poucos dados e marcar "baixa confiança". **Esperar**, porque recomendação errada com cara de dado
   ensina a pessoa a ignorar a tela.
3. **Adotar o horário.** O botão abre o diálogo de Horários com os sugeridos marcados e a grade atual intacta;
   a pessoa salva (`replaceSlots`, a fila vai para os horários novos como hoje). Alternativa: trocar a grade
   num clique. **Abrir e confirmar**, porque a grade mexe na fila de posts já agendados.
4. **Comparação por tipo, formato e tema.** Mostra a média do grupo e o número de posts. Grupo com menos de 4
   posts aparece cinza como "poucos posts" e não entra na frase de aprendizado. Isso é correlação, e a tela
   diz "nos seus posts", sem prometer causa.
5. **Aprendizado.** Observação gerada por **template com números** (nunca texto livre do modelo), guardada com
   a contagem e a janela. Fica ligada à regra de marca da SPEC 019 só quando a pessoa aceita. Alimenta o
   planejador de ideias como dica de peso, e o planejador continua obedecendo fatos, campanha e regras.
6. **Quando coletar.** Demografia **uma vez por dia** (muda devagar), junto do cron `collect-metrics`, e um
   registro por conta e por dia. Horário online, se disponível, no mesmo passo. Sem permissão de insights a
   coleta pula a conta sem erro.
7. **Dado pessoal.** Só agregados da Meta (faixas, percentuais). Nenhum seguidor individual é lido ou guardado.
   A exclusão de conta e a exportação (`/api/account/delete`, `/api/export`) incluem a nova tabela.

## Modelo de dados (aditivo, reaplicável)

`audience_snapshots`: `id`, `tenant_id` (RLS, entra em `TENANT_TABLES`), `channel`, `captured_on date`,
`followers int null`, `age jsonb null` (`{"18-24": 0.31, ...}`), `gender jsonb null`
(`{"F": 0.62, "M": 0.36, "U": 0.02}`), `online_hours jsonb null` (24 posições, 0 a 1, em UTC),
`status text` (`ok | no_permission | too_few_followers | unavailable`), `raw jsonb` (limite de tamanho),
`unique (tenant_id, channel, captured_on)`. Leitura por `profile.view`; só o servidor grava, como
`design_rules`.

Sem tabela nova para a análise de posts: sai de `metrics_snapshots` (última leitura por post) com
`posts.published_at`, `post_designs.kind` (pelo `brief_id` do agendamento) e `posts.format`.

## Regras puras (parser em `lib`, testadas sem rede)

- `parseDemographics(json, breakdown)`: valida o shape, soma, normaliza para fração, descarta faixa fora da
  lista; resposta fora do formato vira `unavailable`, nunca exceção.
- `contentBreakdown(posts)`: média de engajamento por grupo, com `n`; ignora post sem alcance.
- `recommendSlots(posts, onlineHours?, tzOffset)`: pontua dia da semana x faixa de 2 h pelo engajamento médio
  (encolhido para a média da conta quando `n` é pequeno), devolve até 3 horários separados por pelo menos 3 h,
  em horário local, ou `null` com o motivo.
- `insightSentence(group, other)`: frase do aprendizado por template, só com grupos de `n >= 4`.

## Telas (protótipo antes do código)

1. **Publicados › Análise** (aba ao lado de "Posts"): três blocos. *O que funciona* (barras por tipo, formato e
   tema, post de melhor resultado), *Seu público* (faixa etária em barras, gênero em proporção), *Quando está
   ativo* (mapa dia x hora ou barras por hora).
2. **Agenda › Horários**: faixa de recomendação no topo do diálogo, com os horários e o botão "Usar estes
   horários".
3. **Aprendizado**: seção "O que o público prefere" com as observações e a data da última leitura.

Cada tela sai em desktop e mobile, com os estados: **sem permissão de insights** (botão "Conceder permissão"
que reconecta o Instagram), **menos de 100 seguidores** (demografia indisponível, o resto continua),
**poucos posts** (faltam N), **carregando**, **erro** (o que houve e tentar de novo) e **cheio**. Dado fictício.

## Entregas

| # | Entrega | Verificação |
| --- | --- | --- |
| a | Migration `audience_snapshots`, parsers puros e testes | `npm test`; migration aplicada duas vezes no CI; teste de RLS |
| b | Coleta diária de demografia (e horário online, se vier) no `collect-metrics` | teste com `fetchFn` falso: ok, sem permissão, <100 seguidores, formato novo; conta real na staging quando o app review liberar |
| c | `contentBreakdown`, `recommendSlots` e a aba Análise | testes de tabela das regras; tela no navegador contra a staging com posts reais |
| d | Recomendação no diálogo de Horários | teste do estado e exercício do fluxo real (abrir, marcar, salvar) |
| e | Observação em Aprendizado e dica no planejador | teste de que a dica nunca vira regra e some com `n < 4` |

**O que não dá para verificar antes do app review da Meta:** a resposta real de `follower_demographics` e de
`online_followers`. As entregas a e b rodam com respostas gravadas do exemplo da documentação, e o card segue
aberto até uma conta real devolver os dados.

## Fora de escopo

LinkedIn e X (a API do X cobra por leitura, SPEC 002), localização por cidade e país, comparação com
concorrentes, previsão de alcance, mudar a grade sem confirmação da pessoa.

## Perguntas em aberto

1. A faixa de 2 h e o mínimo de 12 posts servem, ou prefere outro corte?
2. O mapa dia x hora precisa aparecer já na primeira versão, ou só as barras por hora?
3. Observação de aprendizado entra no planejador desde a entrega e, ou só depois de a pessoa marcar "usar"?
