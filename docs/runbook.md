# Runbook de operação

O que fazer quando algo precisa de mão humana. Cada item diz o que existe hoje; o que ainda
não existe está marcado como **pendente** e aponta para a [SPEC 006](specs/006-fundacao-saas.md).

## Pausar e retomar a publicação

`/settings` > Publicação. A pausa é **por tenant**: o scheduler (`/api/cron/publish-due`) pula o
tenant pausado e segue com os outros. Os agendados vencidos esperam e saem juntos no primeiro
ciclo depois de retomar. Todo tenant novo nasce pausado (migration 0013).

## Publicação: post preso, conferência e falha permanente (BEZ-258)

Como a publicação se protege (`platform/src/lib/publish.ts`, migration 0036):

- Cada tentativa em `publishing` leva um `attempt_id` e a hora de início (`publishing_started_at`). Só
  quem tem o `attempt_id` atual grava o resultado.
- O id do container da Meta (`meta_container_id`) é gravado **antes** do `media_publish`. Se o processo
  cai ou a resposta se perde, o post fica em `publishing` e o cron `/api/cron/publish-due` o reconcilia
  no ciclo seguinte à janela de 10 minutos (`LEASE_TTL_MS`): pergunta à Meta pelo container e só depois
  decide. Nunca repete às cegas.
- Timeout, queda de conexão ou 5xx no `media_publish` valem como resposta incerta: a própria tentativa
  já consulta o container na hora, sem esperar o cron.
- Cada decisão vira uma linha em `publish_reconciliations` (o que a rede disse, o que foi feito).

O que o reconciliador decide, pelo estado do container na Meta:

| A Meta diz | Decisão | Em `publish_reconciliations` |
|---|---|---|
| `PUBLISHED` | registra o post como publicado, sem publicar de novo (acha o id pela legenda) | `published` / `marked_published` |
| `FINISHED` (pronto, sem publicar) | publica o mesmo container uma vez | `not_published` / `published_now` |
| `ERROR` ou `EXPIRED`, ou sem container gravado | nada foi ao ar: volta para a fila (`scheduled`) | `not_published` ou `no_container` / `requeued` |
| sem resposta (rede, 5xx, 429) | espera o próximo ciclo; na 3ª conferência sem resposta vai para conferência | `unknown` / `waiting` |
| recusa (token vencido, container sumiu) ou canal sem como conferir (LinkedIn, X) | `failed` com aviso para a pessoa conferir | `unverifiable` / `failed_for_review` |

Post em conta **pausada** não é reconciliado (a pausa não chama rede); espera a retomada.

### Alerta

Cada post enviado para conferência escreve uma linha de log `ERROR` com a mensagem
`post preso: confira na rede antes de publicar de novo` (escopo `publish`), e a conta recebe o aviso
`publish.stuck` ("Confira o post no Instagram"). O alerta `publish_stuck` (`infra/terraform/modules/ekoai/monitoring.tf`)
dispara e-mail com essa linha; no Logs Explorer:

```
resource.type="cloud_run_revision" severity>=ERROR jsonPayload.scope="publish"
jsonPayload.message="post preso: confira na rede antes de publicar de novo"
```

O ciclo do cron também escreve `posts presos reconciliados` (resumo: `checked`, `published`, `requeued`,
`failed`, `waiting`, `errors`) e devolve o mesmo resumo em `reconciled` na resposta de `/api/cron/publish-due`.

### O que fazer com um post em conferência

1. Abra o Instagram (ou a rede do post) e veja se o post está lá.
2. Está lá: marque como publicado na mão (o post em `failed` ainda aponta o container):
   `update scheduled_posts set status = 'published', published_at = now(), last_error = 'conferido à mão' where id = '<id>';`
   (o histórico e as métricas desse post não são ligados; o `posts` fica sem linha). Não use o botão de tentar de novo.
3. Não está lá: use o botão de publicar de novo em `/calendar`.
4. Histórico da decisão: `select created_at, found, action, detail from publish_reconciliations where scheduled_post_id = '<id>' order by created_at;`

### Post em `publishing` que não sai

```sql
select id, tenant_id, channel, attempts, publishing_started_at, meta_container_id, last_error
from scheduled_posts where status = 'publishing' order by publishing_started_at;
```

Mais de 10 minutos: o cron deve reconciliar no próximo ciclo (10 em 10 minutos). Se continua depois de
2 ciclos, confira se o cron roda (log `ciclo concluído` de `cron/publish-due`), se a conta está pausada e se
o log tem `reconciliação não registrada` ou `falha` do escopo `publish reconcile`.

### Quem sai primeiro

Os vencidos saem em rodadas por conta (`app.due_scheduled_posts`): o mais antigo de cada conta, depois o
segundo de cada uma, até o lote de 20. Conta pausada fica de fora na própria consulta e não ocupa vaga.

## Saber se está de pé

- `GET /api/health`: 200 se o app alcança o banco, 503 se não. Não expõe detalhe. Aponte um
  monitor externo (UptimeRobot, Better Stack) para ele. **Pendente:** monitor ainda não ligado.
- Logs: o Cloud Logging guarda uma linha JSON por evento (`severity`, `scope`, `message`); campos com
  token, senha, chave ou email saem como `[mascarado]`. Procure por `"level":"error"`.
- Falha de publicação: cada tentativa vira um aviso da conta (`notifications`), e o item vira
  `failed` depois de 3. `/calendar` tem o botão de tentar de novo. Post preso ou de resultado incerto:
  seção "Publicação: post preso" acima.

## Login por pessoa falhando

Toda entrada voltando `401` com `invalid_token`: procure no log o escopo `api/auth/session`,
`api/account` ou `api/invitations/accept`. Aviso `ID token recusado` é rotina (token vencido ou
revogado). Um **erro** com o motivo é problema nosso: o mais provável é a conta de serviço da
plataforma sem `roles/firebaseauth.viewer` (o servidor consulta o usuário no Identity Toolkit para
saber se o token foi revogado), ou o `IDENTITY_PROJECT_ID` errado. Já aconteceu no staging.

## Limite de taxa no cadastro (BEZ-29)

Criar conta (`POST /api/account`) e aceitar convite (`POST /api/invitations/accept`) contam tentativas no
Postgres (`rate_limit_hits`, migration 0035), por IP antes de olhar o token e por e-mail depois de
verificá-lo. Tetos em `platform/src/lib/rate-limit-model.ts`: criar conta 10 por hora por IP e 5 por dia
por e-mail; aceitar convite 30 por hora por IP e 10 por hora por e-mail. Acima disso a rota responde 429
com `Retry-After` e a mensagem de quando tentar de novo; o log registra o balde, sem IP nem e-mail.

- O IP é o último do `X-Forwarded-For` (o front-end do Google acrescenta o IP real no fim). Com um proxy
  nosso na frente do Cloud Run (balanceador ou Firebase Hosting), defina `TRUSTED_PROXY_HOPS=1`.
- Se o contador falhar (banco fora), a entrada segue sem limite e o log avisa (`rate-limit`).
- Liberar alguém antes da hora: `delete from rate_limit_hits where bucket = 'account.email';` (apaga o
  balde inteiro; a chave é hash).

## Segundo fator (MFA)

`MFA_MODE` (Terraform `mfa_mode`): `required` exige o app autenticador do administrador para entrar,
criar conta e excluir conta; `optional` não exige em lugar nenhum. Staging está em `optional` desde
21/10/2026 (BEZ-169); produção em `required`. Para mudar, edite `mfa_mode` no `envs/<ambiente>/main.tf`
e aplique o Terraform. Quem já ativou o app continua com o desafio no login nos dois modos.

## Criar um tenant (piloto ou cliente)

```bash
npm run tenant:create -- --id acme --name "Acme"            # empresa (plano inicial, 5 pessoas)
npm run tenant:create -- --id marina --name "Marina" --kind pessoa   # pessoa (1 pessoa)
npm run access:grant -- --email pessoa@acme.com.br --tenant acme --role admin
```

Cria a linha em `tenants` (publicação pausada) e dá acesso ao primeiro administrador. Depois:
slots em `/settings` e retomar. Os jobs rodam com `TENANT_ID=acme`; sem ele, recusam subir
(ADR 0010). **Pendente:** cadastro, perfil da empresa e convites pela tela (SPEC 011).

## Exportar os dados de um tenant (LGPD)

Logado no tenant, `/settings` > Seus dados > Baixar meus dados. Vem um JSON com todas as
tabelas do conteúdo da conta (perfil, equipe convidada, redes conectadas, auditoria). O token das
redes fica cifrado em tabela à parte e o hash do convite é cortado: nenhum dos dois sai no arquivo.
**Pendente:** apagar os dados de um tenant (precisa de fluxo com confirmação e prazo).

## Migrations

Entram só pelo CI: o job `migrate` do Cloud Run roda `scripts/migrate.js` antes de cada deploy (fase 4 da SPEC 010; até lá, `npm run migrate`). Antes
disso, a PR aplica todas duas vezes num Postgres limpo e roda `supabase/ci/rls_test.sql`.
Migration é aditiva; apagar coluna ou tabela exige `-- allow-destructive` no arquivo.
Nunca aplicar à mão em produção.

## Segredos

| Segredo | Onde | Como girar |
|---|---|---|
| `AUTH_SECRET`, `PLATFORM_PASSWORD` | Secret Manager (Cloud Run) | trocar o valor e redeploy; as sessões caem |
| `CRON_SECRET` | Secret Manager e Cloud Scheduler | trocar nos dois; sem ele o endpoint do cron recusa tudo |
| `DATABASE_URL` (senha do banco) | Secret Manager | trocar a senha do usuário no Cloud SQL e a versão do segredo |
| tokens do Instagram e do LinkedIn | Secret Manager (até o R5 da SPEC 011 levar para o banco, cifrados) | o job `refresh-tokens` renova; vence em ~60 dias |

Segredo colado em chat ou log: girar sempre. **Pendente:** inventário com data da última rotação.

## Banco e backup

**Pendente.** O banco de produção precisa ser recriado (ver `infra-producao-estado` na memória
do projeto). Antes do primeiro cliente de fora: plano com backup diário e um restore
**executado** num banco de teste, não só documentado (gate 8 da esteira).

## Ambientes

Dois projetos do Google Cloud, `ekoai-staging` e `ekoai-prod`, com o mesmo Terraform
([SPEC 010](specs/010-migracao-google-cloud.md), D1). **Pendente:** os projetos ainda não foram
criados (fase 0); não há ambiente publicado.

## Release para produção

Fluxo completo e motivos em [ADR 0013](adr/0013-esteira-feature-staging-producao.md). Resumo:

1. **Staging** recebe tudo por PR de feature (base `staging`, merge por rebase (padrão) ou squash). Depois do merge, o
   deploy de staging é automático. Teste lá o que vai sair.
2. **Release:** `scripts/release.sh` mostra o que sai, confere que o staging publicou esse commit e
   leva a `main` até ele por fast-forward (mesmo SHA, sem PR).
3. **Aprovar o deploy:** o push na `main` roda, no run de Deploy, o CI, a conferência "Veio da
   staging" e o job de `prod`, que espera no GitHub (Actions > o run de Deploy > Review deployments
   > `prod`). Sem aprovação, nada muda em produção.
4. **Conferir:** `/api/health` de produção mostra a revisão (`sha-<7 primeiros>`).

**Desfazer:** `gcloud run services update-traffic ekoai-platform --to-revisions=<revisão anterior>=100
--region southamerica-east1` (migrations são aditivas, então o código antigo continua funcionando).
Para tirar a mudança de vez, reverta o commit na `staging` (por PR) e faça uma nova release.

**O que o deploy faz com o banco e com a imagem:** no staging liga o Cloud SQL se estiver parado (cerca
de 10 minutos, enquanto as imagens constroem) e espera ficar `RUNNABLE` antes de migrar; em produção,
banco fora de `RUNNABLE` interrompe o deploy. O staging constrói a imagem; a produção copia a imagem
do mesmo commit do registry da staging, confere o digest e publica por digest. Se a imagem do commit
não estiver no registry da staging, o deploy de produção para e pede para refazer o da staging.

**Refazer o deploy de um ambiente:** Actions > Deploy > Run workflow, escolhendo a branch do ambiente
(`staging` ou `main`); o environment recusa outra branch. Serve para o serviço reler um segredo novo:
refazer o mesmo commit cria a revisão `sha-<commit>-r<run>-<tentativa>` (antes o Cloud Run recusava o
nome repetido, BEZ-216), e o `/api/health` mostra esse nome.

**Aplicar o Terraform (à mão; nenhum workflow aplica):** segredo, variável ou recurso novo só existe
depois de um apply. As variáveis `deploy_workloads`, `platform_image`, `jobs_image`, `alert_email` e
`tenant_id` não têm valor no repositório, e com os padrões o plano propõe destruir o serviço e o canal de
alerta. Use o script, que lê cada uma do ambiente em execução e gera o plano:

```bash
gcloud auth application-default login            # se o init falhar com invalid_grant
CLOUDSDK_ACTIVE_CONFIG_NAME=bez scripts/tf-plan.sh staging
cd infra/terraform/envs/staging && terraform apply tfplan   # só depois de ler o plano
```

Leia o plano: nada deve ser destruído sem motivo, e a imagem não muda (o Terraform ignora a troca de
imagem; quem troca é o deploy). Os rótulos de custo (`app`, `env`, `product`, `tier`, SPEC 013) estão no
serviço e no template das revisões e dos jobs, então um apply não cria revisão sem eles.

## Conexões do banco (conta do `f1-micro`)

O Cloud SQL `db-f1-micro` aceita 25 conexões por padrão (`db-g1-small`, 50), e parte delas fica
reservada ao superusuário e ao próprio serviço: conte com cerca de 20 úteis.

| Quem | Conta | Conexões |
| --- | --- | --- |
| Plataforma | no máximo 3 instâncias (`platform_max_instances` do nível `beta`) × pool de 5 (`DB_POOL_MAX`) | 15 |
| Jobs | pool de 2 (`DB_POOL_MAX` do job) × até 2 jobs ao mesmo tempo (o `migrate` do deploy e um agendado) | 4 |
| **Pior caso** | | **19** |

Há folga de uma conexão. O alerta "Conexões do Cloud SQL acima de 80% do limite" dispara em 20, e o de
memória em 95%. Se subir o máximo de instâncias ou o pool, refaça a conta antes; instância maior
(`production`) tem limite maior (100 para 3,75 a 6 GB), e o alerta acompanha o tamanho da máquina.

## Ligar e desligar o banco do staging

Parado, o Cloud SQL não cobra a máquina (disco e IP continuam). O Terraform ignora a política de
ativação, então o próximo `apply` não religa.

```bash
CLOUDSDK_ACTIVE_CONFIG_NAME=bez scripts/sql-power.sh staging status
CLOUDSDK_ACTIVE_CONFIG_NAME=bez scripts/sql-power.sh staging down   # cerca de 40 segundos
CLOUDSDK_ACTIVE_CONFIG_NAME=bez scripts/sql-power.sh staging up     # cerca de 10 minutos
```

Medido em 21/10/2026: desligar levou 37 segundos; religar, cerca de 10 minutos, e a plataforma só voltou
a responder uns 2 minutos depois do banco ficar `RUNNABLE` (o probe de startup consulta o banco, então
sem banco o Cloud Run não sobe instância nova). Produção nunca desliga por este script. Com o banco
parado, o deploy do staging falha no `migrate`: ligue antes.

## Subir de nível (`beta` para `production`)

O nível (`tier`) é uma variável do Terraform e um label em todo recurso. Subir é este roteiro, na ordem:

1. `sql_tier` para uma máquina dedicada (1 vCPU ou mais) no `envs/prod`; reinicia o banco por alguns
   minutos, então faça fora do horário de uso.
2. `tier = "production"` no `envs/prod` (máximo de instâncias passa de 3 para 10, ajustável por
   `platform_max_instances` conforme a carga medida).
3. `protect_data` ligado em tudo que guarda dado (já está em produção).
4. Alta disponibilidade (`sql_availability = "REGIONAL"`) só se o cliente exigir.
5. Orçamento do projeto por cliente e por receita em `infra/terraform/platform/main.tf`.
6. Restore executado por trimestre (e agora, uma vez, para o nível novo), registrado aqui.
7. Conferir as conexões (seção acima) com o limite novo.

## Restore do banco (como se faz e quanto leva)

Clone por ponto no tempo numa instância temporária, consultada por um job temporário do Cloud Run na mesma
VPC. Nunca mexe no banco original.

```bash
gcloud sql instances clone ekoai-pg ekoai-pg-restore-test --project=<projeto> \
  --point-in-time=<UTC, ex.: 2026-10-21T14:17:46.000Z> --async
```

Medido em produção, 21/10/2026 (banco `db-f1-micro` com dados pequenos): o clone ficou `RUNNABLE` em cerca de
22 minutos e a operação só fechou uns 10 minutos depois, junto do primeiro backup do clone. A primeira
conexão logo ao ficar `RUNNABLE` foi recusada (o Postgres ainda termina a recuperação); a segunda passou.
Resultado: 34 tabelas, 21 migrations aplicadas e o tenant existente, lidos por um job que devolve só
contagens. Esse é o número a considerar em um incidente: **cerca de meia hora até ter o banco de volta**,
mais o tempo de apontar a plataforma para ele.

Para verificar sem expor dado: segredo temporário com a URL do clone (mesmo usuário e senha, host trocado), job
temporário com a imagem dos jobs e `--command node --args "^@^--input-type=module@-e@<script>"` (o `gcloud`
separa `--args` por vírgula, então use o delimitador `^@^`), que imprime só contagens.

Limpeza, nesta ordem: apagar o job e o segredo; esperar a operação `CLONE` terminar (antes disso a instância
recusa mudança); `gcloud sql instances patch <clone> --no-deletion-protection` (o clone herda a proteção do
original); `gcloud sql instances delete <clone>`. Confira o nome duas vezes: o banco de produção continua com a
proteção ligada.

## Dependências e alertas do Dependabot

- As PRs do Dependabot apontam para a `staging` (`.github/dependabot.yml`), nunca para a `main`. Os alertas de
  segurança são avaliados na branch padrão (`main`) e só fecham depois da release que leva a correção.
- O CI reprova `npm audit --omit=dev --audit-level=high` na raiz e na plataforma. Dependência de desenvolvimento
  não bloqueia, mas se triam os críticos (o vitest 3 e o tinypool foram críticos em 21/10/2026).
- O Next 15 fixa um `postcss` exato (8.4.31, vulnerável). A plataforma sobrescreve para `^8.5.30`
  (`overrides.next.postcss` em `platform/package.json`) e o `@grpc/grpc-js` do Firebase para `^1.14.6`. O npm não
  refaz sozinho a resolução de um `postcss` já gravado no lock: ao mudar o override, remova a entrada
  `node_modules/next/node_modules/postcss` do `package-lock.json` antes do `npm install`. Ao subir o Next, confira
  se o override ainda é necessário.
- **Exceção aceita:** sobram 7 avisos do `npm audit` na plataforma (`braces`, `micromatch`, `chokidar`, `fast-glob`,
  `postcss-nested`, `postcss-selector-parser`, `tailwindcss`), todos da cadeia do Tailwind 3, só em build e fora do
  que roda em produção. Saem com a migração para o Tailwind 4, que é mudança maior e entra à parte.

## Staging sob demanda (SPEC 016)

- **O que é:** o banco do staging fica desligado fora do uso. Abrir a URL com o banco parado mostra "O ambiente de teste
  está desligado" com o botão **Ligar o ambiente** (cerca de 15 minutos até o app abrir). Depois de 60 minutos sem
  requisição de gente, o Scheduler (`ekoai-sleep-if-idle`, a cada 15 min) desliga o banco.
- **Ligar e desligar à mão:** `CLOUDSDK_ACTIVE_CONFIG_NAME=bez scripts/sql-power.sh staging up|down|status`. O deploy também liga.
- **Ligado só no staging:** `wake_enabled = true` em `envs/staging/main.tf` (variáveis `WAKE_*` no Cloud Run, papel `ekoaiSqlPower`
  e `monitoring.viewer` na conta do app, métrica `ekoai_user_requests`, probes em `/api/live`). Produção não tem nada disso.
- **Por que o banco não desligou:** chame `POST /api/cron/sleep-if-idle` com `Bearer CRON_SECRET` e leia `reason`
  (`foi ligado há menos de 60 min`, `N requisições nos últimos 60 min`). Erro 500 é de propósito: métrica ausente ou API
  fora deixam o banco ligado. A métrica nasce no `terraform apply`; sem ela nada desliga.
- **Banco ligado e a tela não sai:** o app só deixa a tela quando `select 1` responde. Confira o `DATABASE_URL` e o estado em
  `GET /api/ambiente` (`state`, `elapsedS`, `message`).
- **Medido em 22/10/2026:** ligar leva 888 s (14,8 min); desligar, cerca de 46 s. O `state=RUNNABLE` do `gcloud` aparece em
  segundos e engana: o `scripts/sql-power.sh` espera o estado e o fim das operações, e `GET /api/health` confirma que a plataforma responde.
- **Deploy com o banco desligado ou ligando (BEZ-120):** o deploy não pede para ligar de novo se já há operação no banco
  (o `patch` voltava 409), espera `RUNNABLE` **sem operação pendente**, e o migrate tenta conectar por cerca de 2 minutos
  antes de desistir (`connect ETIMEDOUT` era o banco ainda fechado para a VPC). O health check confere primeiro
  `/api/live` (o processo; falha é imagem quebrada) e depois `/api/health` por até 3 minutos (o app alcançando o banco).
- **Probes:** staging em `/api/live`, para a instância subir com o banco parado e mostrar a tela; produção em `/api/health`,
  para um deploy com banco quebrado falhar no rollout (decisão do BEZ-120, SPEC 016 D8).

## Geração de posts (SPEC 012, ADR 0018)

- O pedido (`POST /api/posts`) só grava o brief e acorda o worker (`/api/cron/generate`, `Bearer
  CRON_SECRET`); o Cloud Scheduler `ekoai-generate` chama a cada 2 minutos como reserva (pausado na
  staging, como os outros). Brief preso em `generating` por mais de 15 minutos volta sozinho à fila.
- O Vertex AI roda no projeto do ambiente, pelo endpoint global, com a conta de serviço do app
  (`roles/aiplatform.user`). Variáveis: `VERTEX_PROJECT_ID`, `VERTEX_LOCATION`, `VERTEX_TEXT_MODEL`,
  `VERTEX_IMAGE_MODEL` (Terraform, variável `vertex_image_model`; a staging usa `gemini-3.1-flash-lite-image`, a produção o 3.1 Flash). Toda chamada leva os labels `tenant`, `step` e `brief`; filtrar por
  eles no relatório de faturamento.
- Custo e limite: cada chamada fica em `generation_runs` (tokens, custo estimado, tempo); o limite
  mensal do plano vale na reserva do visual (gatilho `app.check_post_limit`). Para ver o uso de uma
  conta no mês: `select count(*) from generation_runs where tenant_id = '<conta>' and step = 'visual'
  and status in ('reserved','done') and created_at >= date_trunc('month', now())`.
- Pedido que falhou: a tela oferece "Tentar de novo" (`POST /api/posts/<id>/retry`); as etapas que
  deram certo são reaproveitadas. Erro do Vertex (429, 503) tenta de novo 2 vezes com espera e depois
  falha com a mensagem do provedor no brief.
- Desenvolvimento local: `gcloud auth application-default login` (conta da BEZ) e as quatro variáveis
  no `.env.local`; `LOCAL_BLOB_DIR` guarda os PNGs numa pasta.

