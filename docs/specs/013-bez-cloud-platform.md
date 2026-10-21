# SPEC 013: BEZ Cloud Platform, a base comum de todos os produtos no Google Cloud

- **Status:** aprovada em 21/10/2026 (ordem: Ekoai, site, bot, Pilar só preparado), decisões D1 a D10 no [ADR 0015](../adr/0015-bez-cloud-platform.md). Etapa 1 em andamento; ver o registro no fim
- **Data:** 2026-10-21
- **Depende de:** [ADR 0006](../adr/0006-google-cloud-como-plataforma.md) (Google Cloud),
  [ADR 0013](../adr/0013-esteira-feature-staging-producao.md) (esteira),
  [SPEC 010](010-migracao-google-cloud.md) (migração da Ekoai, fases 0 a 4 feitas),
  [análise de 21/10](../analises/2026-10-21-plataforma-gcp-cinco-anos.md)
- **Cartão:** BEZ-86 (pai), com um cartão por etapa e as tarefas E1.x a E4.x como filhos
- **Escopo:** o que é comum a todos os produtos da BEZ no Google Cloud: organização, projetos,
  níveis de maturidade, banco, módulos de Terraform, custo e governança. A migração de cada produto
  existente tem a sua própria SPEC; esta só diz em que ordem e com que condição ela entra.

## Problema

A BEZ tem quatro produtos em quatro arranjos: a Ekoai já no Google Cloud (SPEC 010), o site da BEZ
no Cloud Run, o bot de atendimento na Vercel com Supabase e o Pilar na Vercel com Supabase. A meta é
ver tudo num lugar só, com um padrão repetível para os próximos, sem que cada produto novo comece a
infraestrutura do zero e sem que produto sem cliente gere custo fixo relevante.

O que existe hoje cobre só a Ekoai: o estado do Terraform mora no projeto `ekoai-prod`, as políticas
de organização valem só para a pasta `ekoai`, o módulo se chama `ekoai`, e o faturamento tem um
orçamento único de R$ 100 que a própria Ekoai já ultrapassa.

## Estado de partida (lido em 21/10/2026)

| Peça | Estado | Leitura |
| --- | --- | --- |
| Organização `bezcompany.com.br` | criada, vinda do Google Workspace em teste até **02/11/2026** | prazo curto, ver E1.1 |
| Faturamento | uma conta em modo de teste (R$ 1.779, vence 17/01/2027), orçamento "BEZ mensal R$ 100" | falta conta paga e orçamento por projeto |
| Pastas e projetos | pasta `ekoai` com `ekoai-staging` e `ekoai-prod`; `My First Project` solto na raiz | o site da BEZ provavelmente roda no projeto solto |
| Terraform | `modules/ekoai`, `envs/staging`, `envs/prod`, `foundation` (políticas da pasta `ekoai`) | um módulo único, nomeado pelo produto |
| Estado do Terraform | bucket `ekoai-prod-tfstate`, um prefixo por ambiente | acoplado a um projeto de produto |
| Exportação de faturamento | não existe | não recupera o passado: ligar cedo |
| Pilar | Vercel e Supabase da organização Trinity, plano Free, sem backup (BEZ-81) | fora da BEZ ainda |
| Bot de atendimento | Vercel, Supabase, `pg_cron` e `pg_net` por minuto | sem projeto no Google Cloud |

Não consegui consultar a organização por `gcloud` (login da BEZ expirado nesta sessão); as linhas de
pasta, projeto e faturamento vêm da SPEC 010 e do painel de contextos, e a E1.2 começa conferindo.

## Decisões (recomendação minha)

| # | Decisão | Recomendação | Por quê |
| --- | --- | --- | --- |
| D1 | Plataforma-alvo | Google Cloud para todo produto novo; os existentes entram na ordem da seção Ordem de execução (Ekoai, site, bot, Pilar só preparado) | já decidido para a Ekoai (ADR 0006); o argumento é governança, não preço (análise de 21/10) |
| D2 | Estrutura | uma pasta por produto; um projeto por produto e ambiente (`<produto>-staging`, `<produto>-prod`; `-dev` único para `lab`); mais `bez-platform` e `bez-sandbox` | IAM, cotas, Identity Platform e franquias gratuitas separados por projeto. Muda parte do D1 da SPEC 010: o estado do Terraform sai do `ekoai-prod`, porque outro produto não pode morar no projeto da Ekoai |
| D3 | Níveis | `lab`, `beta`, `production`, escolhidos pela variável `tier` do Terraform e pelo label `tier` | produto sem cliente não paga fixo; produto com cliente sobe de nível sem trocar de arquitetura |
| D4 | Banco | Postgres para SaaS multi-tenant com RLS; Firestore só para bot e agente com dado simples; Postgres local em Docker no `lab`. **Sem Cloud SQL compartilhado entre projetos até haver 3 produtos com cliente**; o módulo aceita uma instância externa como entrada, para não precisar reescrever quando chegar a hora | compartilhar entre projetos exige Shared VPC ou Private Service Connect e juntar riscos; antes de medir CPU, memória e conexões é palpite |
| D5 | Módulos de Terraform | extrair cada bloco **quando o segundo consumidor real precisar**, não antes: `project-baseline` com o site (E2.2); `cloud-run-service`, `cloud-tasks-queue`, `firestore` e `cloud-sql` com o bot (E3.5); `modules/ekoai` continua funcionando até lá | regra de três: extrair com um só consumidor produz abstração errada |
| D6 | Governança | políticas na organização (não só na pasta), orçamento por projeto, exportação de faturamento para BigQuery, labels `product`, `env`, `tier` em tudo, regra de custo compartilhado declarada | permite responder "quanto custa cada produto" e impede produto novo de nascer sem guarda |
| D7 | Pilar | **preparar sem migrar** (Etapa 4): a produção segue no Supabase Pro com backup (BEZ-81) até a virada. No Google Cloud nascem projetos, Terraform, Identity Platform, buckets e um staging com dado anonimizado; o Cloud SQL de produção só nasce na janela da virada. A virada tem SPEC própria (E4.12), depois de: autorização da Trinity e transferência do repo e do Supabase, inventário das 58 funções e 259 políticas, piloto de `auth.uid()` com teste de isolamento e ensaio cronometrado | o ensaio prova a infra sem pagar US$ 76,55 por mês por um banco de produção parado, e a produção do Pilar não muda antes de estar provada |
| D8 | Bot de atendimento | primeiro produto migrado depois da Ekoai: Cloud Run, Cloud Tasks (atraso de 60 s) e Scheduler; banco por spike (Firestore ou Postgres) | pequeno, com portas que isolam o banco, e sai da Vercel e do `pg_net`. Valida o padrão de módulos |
| D9 | Site da BEZ | segue no Cloud Run com mínimo 0 e Firebase Hosting, num projeto próprio (`bez-site-prod`) | já custa perto de zero; exportação estática é opcional e fica para depois |
| D10 | Créditos | nenhum crédito entra no orçamento. Pedir PostHog e Sentry for Startups; Google for Startups só se a BEZ pretende captar investimento (o programa pede) | crédito vence e a conta precisa fechar sem ele |

## Níveis de maturidade (D3)

Valores iniciais, a testar e ajustar com medida. O que muda entre níveis é configuração, não código.

| Parâmetro | `lab` | `beta` | `production` |
| --- | --- | --- | --- |
| Quem é | protótipo, experimento, sem cliente | publicado, sem cliente pagante | tem cliente e receita |
| Cloud Run, instâncias mínima e máxima | 0 e 1 a 2 | 0 e 3 | 0 (ou 1 só se o cold start medido atrapalhar) e conforme a carga |
| Banco | Postgres local em Docker, ou Firestore | `f1-micro`, staging ligado só nos testes | dedicado (1 vCPU ou mais), HA se o cliente exigir |
| Backup | nenhum | diário e recuperação a qualquer ponto de 7 dias | o mesmo, mais restore executado por trimestre |
| Proteção contra exclusão | não | no banco | em tudo que guarda dado |
| Orçamento do projeto | US$ 5 | US$ 25 | por cliente e por receita |
| Alertas | e-mail de orçamento | mais 5xx e job falho | mais uptime check e meta de disponibilidade |
| Cota de IA | fixa e baixa | por conta | por conta, com alerta |

A Ekoai já é `beta` (produção em `f1-micro` até haver cliente pagante, BEZ-79). Subir para
`production` reinicia o banco por alguns minutos.

## Estrutura alvo (D2)

```
bezcompany.com.br (organização)
├── bez-platform/        projeto bez-platform: estado do Terraform de todos, exportação de
│                        faturamento (BigQuery), orçamentos
├── ekoai/               ekoai-staging, ekoai-prod
├── bez-site/            bez-site-prod
├── saint-jardin/        saint-jardin-staging, saint-jardin-prod   (Etapa 3)
├── pilar/               pilar-staging, pilar-prod                 (Etapa 4, sem Cloud SQL de produção)
└── sandbox/             bez-sandbox: experimentos, cota baixa, sem dado real
```

IDs de projeto são únicos no mundo: conferir a disponibilidade ao criar, e não commitar IDs
sensíveis (repositório público). Staging de produto sem Cloud SQL custa perto de zero (Cloud Run com
mínimo 0 e Firestore no banco `(default)`, com franquia por projeto), então esses produtos têm
staging sem custo.

## Ordem de execução

Ordem decidida em 21/10/2026: **1. Ekoai** (com a base da organização), **2. site da BEZ**, **3. bot de
atendimento**, **4. Pilar, só preparado**: o Pilar continua rodando no Supabase até a virada, e nada
muda na produção dele antes disso. Cada etapa termina verificada e mergeável sozinha, e só começa a
seguinte quando a anterior fecha. Os cartões do Linear seguem a mesma numeração (BEZ-86 é o pai).

### Onde cada dica entra

| Dica (conversa de 20/10) | Onde entra |
| --- | --- |
| Cloud Run com mínimo 0 e máximo baixo | já na Ekoai; passa a ser o padrão do módulo (E1.9) e confere a conta de conexões (E1.10) |
| Postgres local em desenvolvimento | já no CI da Ekoai; regra do nível `lab` |
| Staging sob demanda | E1.11 (script e `ignore_changes`) |
| Direct VPC egress, sem conector | já na Ekoai (`network_interfaces`); conferir no Pilar e no bot |
| Uma imagem promovida entre ambientes | E1.12 (digest da `staging` para a `main`) |
| Cota de IA por produto e por cliente | E1.14 (spec própria) |
| Backup com restore testado | executado uma vez na Ekoai; por trimestre (runbook, E1.15) e no ensaio do Pilar (E4.10) |
| Exportação de faturamento para BigQuery | E1.4, cedo, porque não recupera o passado |
| Terraform e módulos versionados | E1.9, E2.2 (`project-baseline`) e E3.5 (`cloud-run-service`) |
| CI sem poder de apagar produção | já (Workload Identity por branch, ADR 0013); replicar em cada produto novo |
| Custo compartilhado por regra declarada | E1.16 |

### Etapa 1: Ekoai e a base da organização

Base que vale para todos os produtos (E1.1 a E1.8), depois o que falta na Ekoai.

- **E1.1** Confirmar o Workspace (ou Cloud Identity Free) antes de 02/11/2026 (BEZ-87).
- **E1.2** Renovar o login do `gcloud` da BEZ e conferir a estrutura real: pastas, projetos, onde o
  site roda.
- **E1.3** Projeto `bez-platform` e o estado do Terraform movido do `ekoai-prod-tfstate` para ele
  (`terraform init -migrate-state`, fora de janela de deploy).
- **E1.4** Exportação de faturamento para o BigQuery.
- **E1.5** Orçamento por projeto no Terraform (50%, 80%, 100%) e ajuste do orçamento global de R$ 100,
  conferindo se ele conta antes ou depois do crédito.
- **E1.6** Políticas de organização na organização, não só na pasta. Testar antes o efeito da
  restrição de região no Vertex (endpoint global de imagem), no sandbox.
- **E1.7** Conta de faturamento paga até 20/12/2026 (BEZ-89).
- **E1.8** Projeto `bez-sandbox`, com cota baixa e corte de faturamento no limite (só nele).
- **E1.9** Na Ekoai: labels `product`, `env` e `tier` em todo recurso (hoje só `app` e `env`) e a
  variável `tier` com os valores da tabela de níveis. `plan` sem diferença de recurso além dos
  labels. Registrar no runbook a lista do que muda ao subir de `beta` para `production`.
- **E1.10** Conta de conexões: pool de 5 por instância, máximo de 3 instâncias da plataforma e os
  jobs, contra as 25 conexões padrão do `f1-micro`, deixando folga para o `migrate`. Alertas de
  memória e de conexões do Cloud SQL (hoje só há o de disco).
- **E1.11** Staging sob demanda: script para ligar e desligar o banco do staging, `ignore_changes`
  em `activation_policy` para o Terraform não religar, e o deploy ligando o banco antes do `migrate`.
  Parado, a máquina não cobra; disco e IP continuam.
- **E1.12** Promover a imagem por digest da `staging` para a produção, em vez de reconstruir
  (consequência registrada no ADR 0013).
- **E1.13** Política de limpeza do Artifact Registry (manter as últimas versões, apagar sem tag em 14
  dias) e investigar o Cloud Build de R$ 1,69 em outubro (BEZ-79).
- **E1.14** Controle de custo de IA: **spec antes** (é feature). Custo estimado por geração, limite
  por plano em gatilho no banco (como `app.check_seat_limit`, ADR 0012), idempotência para não gerar
  a mesma imagem duas vezes, cache, degradação sem derrubar o resto. Hoje só há limite de pessoas e de
  contas do Instagram.
- **E1.15** Medir por 30 dias: CPU, memória, conexões e p95 do banco e da plataforma; fatura por SKU
  sem crédito. Alimenta a D4 e o tamanho de `production`. Teste de restore por trimestre no
  calendário.
- **E1.16** Painel de custo por produto e por conta no BigQuery (BEZ-91).

**Verificação da etapa:** `plan` limpo nos dois ambientes depois de mover o estado; exportação com
linhas no BigQuery; chave de conta de serviço barrada por política num projeto novo; alerta de
orçamento recebido num teste; a soma do painel fecha com a fatura do mês.

### Etapa 2: site da BEZ

Nível `beta`, só produção (uma página, sem banco): sem staging, com revisão do Cloud Run para
conferir antes de virar o tráfego.

- **E2.1** Conferir onde o site roda hoje e o que mais existe no `My First Project`.
- **E2.2** Extrair o `project-baseline` do módulo da Ekoai (projeto, APIs, labels, orçamento, deploy
  com Workload Identity, Artifact Registry): o site é o segundo consumidor.
- **E2.3** Projeto `bez-site-prod`, Cloud Run com mínimo 0 e máximo 2, e o deploy do repositório do
  site pelo GitHub Actions, sem chave de conta de serviço.
- **E2.4** Firebase Hosting no projeto novo com cabeçalhos de cache para os estáticos (o CDN atende o
  acerto e o Cloud Run só recebe o resto) e troca do domínio `bezcompany.com.br`, com TTL do DNS
  reduzido antes.
- **E2.5** Orçamento de US$ 5, alerta, labels e Sentry do site.
- **E2.6** Desligar o antigo e apagar o `My First Project`. Antes, repontar os MCPs do Google Cloud
  da BEZ (`gcp-bez-*`, hoje presos a esse projeto) para o `bez-platform` e atualizar
  `~/.claude/contexts.json`. Exportação estática do Next fica opcional, na lista de baixa prioridade.

**Verificação:** o domínio responde pelo projeto novo, o painel de custo mostra o site com labels
próprios, e nada quebrou quando o projeto antigo saiu.

### Etapa 3: bot de atendimento

Cliente real: sem janela de manutenção no horário de atendimento, e um só receptor do webhook por vez
(dois receptores respondem em dobro).

- **E3.1** Conferir o material público do repositório (BEZ-95) antes de mexer nele.
- **E3.2** Levantamento do bot em produção: mensagens por mês, plano atual da Vercel (o Hobby é só
  para uso não comercial), custo de hoje, dados reais no banco, horários de pico e quem avisa o
  cliente numa janela.
- **E3.3** Spike de banco, meio dia: adapter de Firestore atrás de `src/ports` contra o emulador,
  com fila e idempotência. Decide Firestore ou Postgres (`f1-micro`).
- **E3.4** Spec curta do bot no Google Cloud (é mudança de arquitetura).
- **E3.5** Extrair o `cloud-run-service` (e `cloud-tasks-queue`, e `firestore` se escolhido) do módulo
  da Ekoai: o bot é o segundo consumidor desses blocos.
- **E3.6** Projetos `saint-jardin-staging` e `saint-jardin-prod` por Terraform, com CI por Workload
  Identity. Staging sem Cloud SQL custa perto de zero.
- **E3.7** Webhook enxuto (valida a assinatura da Meta, grava o evento, cria a tarefa e responde
  200) e worker em serviço separado; Cloud Tasks com `scheduleTime` de agora mais 60 s e nome igual
  ao `message_id`; `eventos_processados` mantida, porque a entrega é pelo menos uma vez.
- **E3.8** Medir o p95 do webhook depois de inatividade com mínimo 0 e confirmar o prazo de resposta
  da Meta na documentação oficial. Só manter instância mínima se estourar.
- **E3.9** Alertas: fila parada, tentativas excedidas, mensagem duplicada, falha do Telegram.
- **E3.10** Cutover: exportar contatos, conversas abertas e handoffs, importar, apontar o webhook da
  Meta para a URL nova e deixar a Vercel como volta (trocar o webhook de volta basta).
- **E3.11** Desligar a Vercel e o Supabase do bot depois de 30 dias sem tráfego.

**Verificação:** conversa completa simulada no staging; a mesma entrega reenviada não duplica
resposta; fila parada gera alerta; restore do banco escolhido executado; uma semana de atendimento
real sem diferença para a atendente.

### Etapa 4: Pilar, só preparar

**Regra da etapa:** o Pilar segue no Supabase; nenhuma mudança na produção dele. Nada aqui escreve no
repositório ou no Supabase da Trinity sem autorização por escrito. O custo da preparação fica em
poucos dólares por mês: o Cloud SQL de produção (dedicado, cerca de US$ 76,55 por mês) só nasce na
janela da virada, e o ensaio de produção roda em staging por um dia.

- **E4.0** Pré-requisitos: autorização e acesso só de leitura ao repositório e ao Supabase; Supabase
  Pro com backup (BEZ-81), porque é ele que sustenta o Pilar até a virada; definir para onde a
  organização do Supabase vai.
- **E4.1** Inventário somente leitura, num documento privado: as 58 Edge Functions (usam
  `supabase-js`, cliente admin, só SQL, IA, Asaas?), as 259 políticas de RLS (`auth.uid()`,
  `auth.jwt()`, claims), as 326 funções SQL (`SECURITY DEFINER`), os 181 triggers, os 12 jobs de
  `pg_cron` (cobrança ou repetíveis?), o `pg_net`, os 7 segredos do Vault, os 8 buckets, os provedores
  de login e as extensões.
- **E4.2** Pasta `pilar` e projetos `pilar-staging` e `pilar-prod` por Terraform, com Workload
  Identity e labels. Aplicar só o que não cobra: projeto, IAM, Artifact Registry, Secret Manager,
  Identity Platform, buckets e rede. **Não** criar o Cloud SQL de produção.
- **E4.3** Cloud SQL de staging (`f1-micro` ou `g1-small`, ligado só nos ensaios) com **cópia
  anonimizada** do banco: rodar as migrations, conferir as extensões (incluindo `pg_net`) e os testes
  de RLS. Nunca dado de cliente em staging.
- **E4.4** Identity Platform no staging: importação de usuários com hash bcrypt preservando os UUIDs,
  Google, MFA e sessões.
- **E4.5** Piloto da compatibilidade de `auth.uid()`: a API valida o JWT, abre a transação e define o
  contexto com `set_config(..., true)`, executando sob papel que não ignora RLS. Teste de acesso
  entre empresas com IDs manipulados é critério de aceite.
- **E4.6** POC de três funções em contêiner Deno no Cloud Run (uma de IA, uma do Asaas, uma só de SQL)
  e o desenho do agrupamento das 58 em poucos serviços por responsabilidade; `pg_net` por Cloud Tasks;
  Secret Manager; máximo de instâncias e pool somando abaixo do limite de conexões.
- **E4.7** Storage: 8 buckets para Cloud Storage com URL assinada, testado com cópia.
- **E4.8** Front: Firebase Hosting para a SPA React/Vite, apontando para o Supabase (não depende do
  resto e tira o Pilar da Vercel Hobby). Testar callback do Google, rotas profundas, CSP e links de
  e-mail. Mexe no repositório: só com autorização.
- **E4.9** Jobs: classificar os 12 de `pg_cron` e levá-los para `pg_cron` do Cloud SQL (flag
  `cloudsql.enable_pg_cron`) ou Cloud Scheduler, com cuidado nos que cobram ou notificam.
- **E4.10** Ensaio de virada em staging com o nível `production` por um dia: carga, restore,
  duração da janela e custo do ensaio.
- **E4.11** Tamanho e custo do Cloud SQL de produção decididos com a carga medida; HA só se o cliente
  exigir.
- **E4.12** SPEC de migração do Pilar: janela, congelamento, TTL do DNS, sincronização (com 42 MB, um
  `pg_dump` e restore cabe numa janela curta; reavaliar o tamanho no dia), rollback com o Supabase
  mantido por 30 dias, lista de go/no-go.

**Verificação:** inventário fechado; staging do Pilar funcionando de ponta a ponta com dado anonimizado;
isolamento entre empresas testado com IDs manipulados; ensaio de virada cronometrado; produção do
Pilar no Supabase intocada e com backup.

## Fora do escopo

- A virada do Pilar para o Google Cloud (SPEC própria, E4.12). A Etapa 4 só prepara.
- Cloud SQL compartilhado entre projetos (D4, só depois de medir e de ter 3 produtos com cliente).
- Script `create-product` automatizado: só depois do segundo produto, para não automatizar um
  molde que ainda não existe.
- Trocar Sentry e PostHog por Cloud Monitoring: os três convivem.
- Telas e protótipo: nada aqui muda interface.

## Riscos

| Risco | Impacto | Mitigação |
| --- | --- | --- |
| Teste do Workspace vence em 02/11/2026 | organização depende do domínio | E1.1, primeiro item |
| Teste do Google Cloud vence em 17/01/2027 | recursos suspensos | conta paga até dezembro |
| Apagar `My First Project` com o site dentro | site fora do ar | conferir e mover antes (E2.1 a E2.6); repontar os MCPs do Google Cloud |
| Mover o estado do Terraform com ambiente em uso | `apply` concorrente corrompe o estado | mover fora de janela de deploy, com o lock do bucket |
| Política de região bloquear o Vertex global | geração de imagem para | testar no sandbox antes de aplicar na organização |
| Banco do bot em Firestore não caber no modelo | retrabalho de um adapter | spike antes de decidir; o Postgres fica como saída |
| Pilar depende da Trinity | preparação parada, ou escrita no que não é nosso | a Etapa 4 é a última; E4.0 exige autorização por escrito; inventário só de leitura |
| Ensaio do Pilar com dado real em staging | vazamento de dado de cliente | cópia anonimizada, nunca dado real fora da produção |
| Dois receptores do webhook do bot ao mesmo tempo | resposta em dobro ao cliente | cutover com um só receptor; volta é repontar o webhook (E3.10) |
| Orçamento com alerta não corta gasto | fatura acima do previsto | corte automático só no sandbox; nos demais, alerta e revisão semanal |

## Critérios de aceite

- [ ] Organização sem dependência de teste vencendo (Workspace e faturamento).
- [ ] Estado do Terraform em `bez-platform`; `plan` limpo em todos os ambientes.
- [ ] Exportação de faturamento ativa e um painel com custo por `product` e `tier`.
- [ ] Cada projeto com orçamento próprio e alerta testado.
- [ ] Políticas valendo na organização; nenhum projeto sem label `product`, `env` e `tier`.
- [ ] Ekoai com labels `product`, `env` e `tier`, staging sob demanda, promoção por digest, limpeza do registry e controle de custo de IA (E1.9 a E1.16).
- [ ] Site da BEZ em projeto próprio e `My First Project` apagado (Etapa 2).
- [ ] Bot de atendimento no Google Cloud com a Vercel e o Supabase desligados (Etapa 3).
- [ ] Pilar preparado: inventário, staging anonimizado, piloto de isolamento, ensaio cronometrado e SPEC de virada aprovada, com a produção ainda no Supabase (Etapa 4).

## O que depende do Matheus

| Quando | O quê |
| --- | --- |
| Hoje | aprovar D1 a D10, em especial D2 (projeto `bez-platform`), D4 (sem banco compartilhado ainda) e D7 (Pilar fora da fundação) |
| Antes de 02/11/2026 | decidir Workspace pago ou Cloud Identity Free |
| Etapa 1 | renovar o login do `gcloud` da BEZ; confirmar a criação dos projetos (cobram do crédito) |
| Etapa 3 | acesso ao Supabase e à Vercel do bot, uma conversa de teste com a atendente e a data da janela do cutover |
| Etapa 4 | autorização por escrito da Trinity para ler o repositório e o Supabase do Pilar, e para mover o front |
| D10 | dizer se a BEZ pretende captar investimento e a data de constituição do CNPJ |

## Não verificado

Ver o fim da [análise](../analises/2026-10-21-plataforma-gcp-cinco-anos.md): preços de Cloud Run e
Firestore em São Paulo, `pg_net` no Cloud SQL, SLA do Supabase Pro, elegibilidade aos créditos,
horas de migração do Pilar e consumo real de cada produto.

## Registro de implementação

### Etapa 1, base da organização (2026-10-21)

- **E1.2, estrutura lida por `gcloud`:** pasta `ekoai` com `ekoai-staging` e `ekoai-prod`, mais o
  `My First Project` na raiz. O site da BEZ (`bez-website`, Cloud Run em São Paulo) **roda nesse
  projeto padrão**, confirmando o risco: ele só pode ser apagado depois da Etapa 2.
- **E1.3, `bez-platform` e estado do Terraform:** pastas `bez-platform` e `sandbox`; projeto
  `bez-platform` com faturamento e as APIs de orçamento, política de organização e BigQuery; bucket
  `bez-platform-tfstate` (São Paulo, versionado, sem acesso público). O ID `bez-sandbox` já estava em
  uso no mundo, então o sandbox é `bez-company-sandbox`. Os três estados (`foundation`, `prod`,
  `staging`) foram copiados com o hash conferido e os backends apontados para o bucket novo. O
  `plan` dos dois ambientes lê os recursos reais e só mostra código ainda não liberado (banco de
  produção para `db-f1-micro`, papel `firebaseauth.viewer` e uma variável de ambiente); nada foi
  destruído. O bucket antigo `ekoai-prod-tfstate` fica até a próxima release passar limpa.
- **Orçamento existente:** o "BEZ mensal R$ 100" já conta o custo **antes** dos créditos
  (`EXCLUDE_ALL_CREDITS`), então mede a fatura real e vai alertar enquanto a Ekoai ficar em R$ 118 a 142.
- **Políticas da organização:** a organização já tinha `iam.managed.disableServiceAccountKeyCreation` e
  `iam.disableServiceAccountKeyUpload` (padrão do Google). A pasta `ekoai` acrescenta só
  `sql.restrictPublicIp`, `storage.publicAccessPrevention` e `compute.skipDefaultNetworkCreation`.
- **E1.5, orçamentos (PR #68):** um orçamento mensal por projeto (50%, 80%, 100% e previsão de 100%) e o
  global passou de R$ 100 para R$ 330, o teto da infraestrutura fixa. Todos medem o custo **antes** dos
  créditos. Aplicado e conferido por `gcloud`.
- **E1.6, políticas na organização (PR #68):** as quatro políticas que só a pasta `ekoai` tinha subiram
  para a organização e a pasta ficou sem nenhuma. Teste real: criar chave de conta de serviço no
  sandbox é negado pela política. A restrição de região **não** foi aplicada (segredos com replicação
  automática, endpoint global do Vertex e Identity Platform podem esbarrar nela).
- **E1.4, exportação de faturamento:** ligada pelo console (não há API), custo padrão e detalhado, no
  dataset `billing_export` de `bez-platform`. Não recupera o passado e as tabelas levam horas para
  aparecer; a conferência com dados fica para a E1.15.
- **E1.8 e E1.9 (PR #69):** labels `product`, `env` e `tier` em todo recurso da Ekoai e nos projetos, variável
  `tier`, alertas de conexões e memória do Cloud SQL, pool de 2 nos jobs. Aplicado no staging;
  produção recebe com a próxima release (o `envs/prod` também carrega código ainda não liberado, como o
  banco para `db-f1-micro`).
- **E1.11, staging sob demanda (PRs #69 e #70):** script `sql-power.sh`, `ignore_changes` e o deploy ligando o
  banco. Medido: desligar leva 37 segundos, ligar cerca de 10 minutos, e a plataforma volta uns 2
  minutos depois.
- **E1.12, digest (PR #70):** produção promove a imagem da staging, com o digest conferido. O caminho de
  produção só roda de verdade na próxima release.
- **E1.13:** a política de limpeza do registry já existia e o Cloud Build está desligado em todo projeto.
- **E1.14 (PR #71):** controle de custo de IA entrou como R5.1 da SPEC 012, não como spec nova.
- **Achado (BEZ-120):** o probe de startup consulta o banco; sem banco o Cloud Run não sobe instância.
- **E1.8, sandbox sem corte automático (decisão de 21/10/2026):** o projeto `bez-company-sandbox` existe com
  orçamento de R$ 30 e alerta. O corte automático do faturamento (orçamento para Pub/Sub, função que
  desliga o faturamento) foi construído, aplicado e **desfeito**: o orçamento não consegue publicar no
  Pub/Sub porque a política de domínios da organização (`iam.allowedPolicyMemberDomains`, padrão do
  Google) barra a conta de sistema do faturamento ("users named in the policy do not belong to a
  permitted customer"). Abrir exceção nessa política só para ganhar o corte seria afrouxar segurança por
  conveniência. Alternativas: (a) exceção da política no `bez-platform`; (b) canal do Monitoring em vez
  de Pub/Sub; (c) função agendada lendo o gasto na exportação do BigQuery, com atraso de horas;
  (d) só alerta e cota baixa. Fica (d) por ora, com (c) como candidata (BEZ-121).

### Etapa 2, site da BEZ (2026-10-21)

- **E2.1:** o site roda no projeto padrão (`bez-website`, Cloud Run em São Paulo, Firebase Hosting `bez-company`
  na frente). O projeto só tem o site e o registry: sem dado, usuário nem segredo.
- **Achado grave, código-fonte:** o repositório `bez-company/bez-website` não tem o código do site. A imagem
  foi construída de um diretório não commitado (tag `89c0080-...` sobre um commit que só tem marca e design
  system), o workspace foi arquivado e a imagem não guarda o código (sourcemaps vazios). A imagem é o único
  artefato; foi copiada para o registry novo com o digest conferido. **Sem o código não há CI (E2.3) nem
  mudança de conteúdo**: precisa recuperar de outra cópia ou reescrever.
- **Achado, 404 no ar:** o domínio raiz servia um "Site Not Found" em cache no CDN do Firebase (as outras
  URLs davam 200). Resolvido com um novo release da mesma configuração.
- **E2.2, `project-baseline`:** adiado. Sem CI do site não há consumidor para a conta de deploy e o WIF; o
  módulo é extraído na Etapa 3, quando o bot trouxer o segundo consumidor real.
- **E2.3 a E2.5:** projeto `bez-site-prod` e `envs/bez-site` por Terraform (Cloud Run mínimo 0 e máximo 2, registry,
  conta de serviço sem papel, Hosting, domínios, uptime check e alerta). Orçamento de R$ 30. Sentry não, pelo
  mesmo motivo do código. Domínio migrado pela migração ao vivo do Firebase (dois registros no GoDaddy);
  apex e www ativos no site novo, HTML idêntico ao de antes. Teste: 200 no apex, 301 do www e do HTTP para
  o apex, certificado válido, 404 e ícone como antes.
- **Achado, limite de faturamento:** a conta de teste só aceita 5 projetos vinculados. O sandbox ficou sem
  faturamento (vazio) para o site entrar. Os projetos do bot e do Pilar exigem aumento de cota ou conta
  paga (E1.7).
- **E2.6, em andamento:** os MCPs do Google Cloud da BEZ passaram para o `bez-platform` (helper e
  `contexts.json`; os três endpoints respondem 200). O `My First Project` fica 48 horas como volta
  rápida e depois é apagado (BEZ-92).
