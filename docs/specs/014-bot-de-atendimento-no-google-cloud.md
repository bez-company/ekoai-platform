# SPEC 014: bot de atendimento no Google Cloud

- **Status:** proposta (21/10/2026), Etapa 3 da [SPEC 013](013-bez-cloud-platform.md)
- **Depende de:** [ADR 0015](../adr/0015-bez-cloud-platform.md), [ADR 0008](../adr/0008-acesso-ao-postgres-sem-supabase-js.md)
  (`@ekoai/db`), [BEZ-95](https://linear.app/bez-company/issue/BEZ-95) (dado pessoal no repositório do bot)
- **Escopo:** levar o bot de atendimento no WhatsApp (repositório `bez-company/saint-jardin-chatbot`) da
  Vercel e do Supabase para o Google Cloud, com paridade de comportamento. Nada de produto novo.

## Problema

O bot é de um cliente real (espaço de eventos e casamentos) e hoje roda em Next.js 15 na Vercel, com
Supabase (Postgres, `pg_cron` e `pg_net`). Precisa entrar no padrão da BEZ (projeto por ambiente,
Terraform, orçamento, alerta) sem mudar o que a atendente vê e sem janela de manutenção no horário de
atendimento.

## O que o código mostra (lido em 21/10/2026)

| Peça | Fato | Consequência |
| --- | --- | --- |
| Webhook (`/api/whatsapp`) | valida a assinatura da Meta, deduplica por `message_id`, grava na fila com atraso (60 s mais jitter) e responde 200 | já é o webhook enxuto; só muda onde roda |
| Fila e ciclo (`/api/process`) | o `pg_cron` chama a rota a cada minuto por `pg_net`; ela processa a fila vencida (`fila_mensagens.processar_apos`), cuida da trava por telefone (`turno_trava`) e faz três varreduras por janela de tempo com reivindicação atômica (follow-up de 12 h, convite de 5 min, retomada do orçamento) | um agendador por minuto continua sendo a peça certa; Cloud Tasks por mensagem **não** cobre as varreduras |
| Acesso a dados | um arquivo (`src/adapters/supabase.ts`, 539 linhas), só `from`, `select`, `update`, `upsert`, `insert`, `delete`, `or`, `is`, `lte`, `gte`, `order`, `limit`, `maybeSingle`; nenhum `rpc`, nenhum embed | o `@ekoai/db` (mesma forma do supabase-js, ADR 0008) cobre o subconjunto: troca de import no adaptador |
| Esquema | 11 migrations, tabelas pequenas, RLS ligado sem política (o backend usa a chave de serviço) | roda em Postgres puro; no Cloud SQL o dono das tabelas é o usuário da aplicação |
| Variáveis | Gemini, Supabase, WhatsApp (token, número, verify token, app secret), Telegram, `PROCESS_SECRET`, modo teste | vão para o Secret Manager |

## Decisões (recomendação)

| # | Decisão | Por quê |
| --- | --- | --- |
| D1 | **Banco: Postgres no Cloud SQL `db-f1-micro`, pelo `@ekoai/db`.** Firestore descartado | a fila, a trava e as três reivindicações atômicas dependem de semântica SQL (atualização condicional, varredura por faixa de tempo). No Firestore seriam transações e índices compostos novos e a reescrita de 539 linhas, para economizar cerca de US$ 14 por mês (R$ 83). Postgres mantém as 11 migrations e o comportamento |
| D2 | **Agendador: Cloud Scheduler a cada minuto chamando `/api/process`** com token OIDC, no lugar de `pg_cron` e `pg_net`. A tabela `fila_mensagens` e a trava ficam como estão. **Cloud Tasks não entra** | preserva o desenho já provado em produção; muda só quem dispara. O Scheduler cobra US$ 0,10 por job por mês depois dos 3 gratuitos da conta |
| D3 | **Cloud Run (Next standalone), mínimo 0, máximo 2**, mesma forma de imagem e de deploy da Ekoai | webhook pequeno; cold start medido antes de pagar instância mínima (E3.8) |
| D4 | **Dois projetos:** `saint-jardin-staging` (banco ligado só nos testes, Scheduler pausado, `MODO_TESTE`) e `saint-jardin-prod` (banco com backup e recuperação a qualquer ponto). Nível `beta` | padrão da SPEC 013. Depende da cota de projetos por faturamento (BEZ-123) |
| D5 | **Segredos no Secret Manager;** `PROCESS_SECRET` some porque o Scheduler autentica por OIDC (a rota confere o token, como a `publish-due` da Ekoai) | sem segredo compartilhado em variável de ambiente |
| D6 | **Gemini continua pela chave** (`@google/genai`) na primeira etapa. Passar para o Vertex com a conta de serviço, sem chave, fica como melhoria | não misturar migração de hospedagem com troca de provedor de modelo |
| D7 | **Dados: `pg_dump` do Supabase e restauração no Cloud SQL** numa janela curta combinada com a atendente. O banco é pequeno | sem replicação contínua |

## Custo estimado

Produção: Cloud SQL `f1-micro` com 10 GB cerca de US$ 14, Cloud Run e Scheduler perto de zero, Secret
Manager e Artifact Registry centavos. Total em torno de US$ 15 a 18 por mês (R$ 90 a 105). Staging com o
banco ligado só nos testes: cerca de US$ 3. No plano comercial dos dois fornecedores atuais (Supabase
Micro US$ 10 mais Vercel Pro US$ 20 por assento) são cerca de US$ 30, então a migração não encarece e
tira o bot do plano Hobby da Vercel (uso não comercial).

## Fases

1. **E3.1, antes de tudo:** limpar o repositório público (BEZ-95): há um telefone real e nomes de clientes
   nos documentos de descoberta.
2. **E3.2, levantamento em produção:** mensagens por mês, plano atual da Vercel, custo, tamanho do banco,
   horários de pico, janela de cutover com a atendente. Precisa de acesso ao Supabase e à Vercel do bot.
3. **E3.5 e E3.6, infraestrutura:** extrair `project-baseline` e `cloud-run-service` do módulo da Ekoai (o bot é o
   segundo consumidor); projetos, Cloud SQL, Scheduler pausado, Secret Manager, deploy por Workload
   Identity restrito à branch.
4. **Adaptador:** trocar o import do `supabase-js` pelo `@ekoai/db` em `src/adapters/supabase.ts`; teste com
   Postgres real (as 11 migrations e a suíte atual); `upsert` com `onConflict` e `or` conferidos primeiro.
5. **Rota `/api/process` com OIDC** no lugar de `PROCESS_SECRET`; verificação do token como na Ekoai.
6. **E3.7 a E3.9, staging:** conversa completa em `MODO_TESTE` com número de teste da Meta; reentrega do mesmo
   webhook não duplica resposta; fila parada, tentativa excedida e falha do Telegram geram alerta; p95 do
   webhook depois de inatividade com mínimo 0 (e o prazo de resposta da Meta, conferido na documentação).
7. **E3.10, cutover:** `pg_dump` e restauração; apontar o webhook da Meta para a URL nova; desligar o
   `pg_cron` do Supabase; a Vercel fica como volta (repontar o webhook basta).
8. **E3.11:** desligar a Vercel e o Supabase do bot depois de 30 dias sem tráfego. O Telegram continua.

## Riscos

| Risco | Mitigação |
| --- | --- |
| Cliente real em produção | cutover fora do horário de atendimento, atendente avisada, volta por repontar o webhook |
| Mensagem duplicada ou perdida na troca | a deduplicação por `message_id` e a trava por telefone ficam; um só receptor do webhook por vez (a Meta tem uma URL de callback) |
| Cold start passar do prazo da Meta | medir antes; instância mínima só se estourar |
| Cota de projetos por faturamento (5) | BEZ-123: conta paga ou aumento de cota antes de criar os projetos |
| Dado pessoal em repositório público | BEZ-95 antes de qualquer outra coisa |

## Critérios de aceite

- [ ] Suíte do bot passa contra Postgres real com o `@ekoai/db`.
- [ ] Conversa completa no staging; a mesma entrega reenviada não duplica resposta.
- [ ] Alertas de fila parada, tentativa excedida e falha do Telegram testados.
- [ ] Restauração de backup do Cloud SQL executada e registrada.
- [ ] Uma semana de atendimento real em produção sem diferença para a atendente.
- [ ] Vercel e Supabase do bot desligados depois de 30 dias sem tráfego.

## O que depende do Matheus

| Quando | O quê |
| --- | --- |
| Agora | decidir o que fazer com o repositório público (BEZ-95): limpar o histórico ou torná-lo privado |
| E3.2 | acesso ao Supabase e à Vercel do bot e o plano atual da Vercel |
| E3.10 | combinar a janela do cutover com a atendente |
