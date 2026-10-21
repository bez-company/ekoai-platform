# Runbook de operação

O que fazer quando algo precisa de mão humana. Cada item diz o que existe hoje; o que ainda
não existe está marcado como **pendente** e aponta para a [SPEC 006](specs/006-fundacao-saas.md).

## Pausar e retomar a publicação

`/settings` > Publicação. A pausa é **por tenant**: o scheduler (`/api/cron/publish-due`) pula o
tenant pausado e segue com os outros. Os agendados vencidos esperam e saem juntos no primeiro
ciclo depois de retomar. Todo tenant novo nasce pausado (migration 0013).

## Saber se está de pé

- `GET /api/health`: 200 se o app alcança o banco, 503 se não. Não expõe detalhe. Aponte um
  monitor externo (UptimeRobot, Better Stack) para ele. **Pendente:** monitor ainda não ligado.
- Logs: o Cloud Logging guarda uma linha JSON por evento (`severity`, `scope`, `message`); campos com
  token, senha, chave ou email saem como `[mascarado]`. Procure por `"level":"error"`.
- Falha de publicação: cada tentativa vira um aviso da conta (`notifications`), e o item vira
  `failed` depois de 3. `/calendar` tem o botão de tentar de novo.

## Login por pessoa falhando

Toda entrada voltando `401` com `invalid_token`: procure no log o escopo `api/auth/session`,
`api/account` ou `api/invitations/accept`. Aviso `ID token recusado` é rotina (token vencido ou
revogado). Um **erro** com o motivo é problema nosso: o mais provável é a conta de serviço da
plataforma sem `roles/firebaseauth.viewer` (o servidor consulta o usuário no Identity Toolkit para
saber se o token foi revogado), ou o `IDENTITY_PROJECT_ID` errado. Já aconteceu no staging.

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

1. **Staging** recebe tudo por PR de feature (base `staging`, merge por rebase ou squash). Depois do merge, o
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
(`staging` ou `main`); o environment recusa outra branch.

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
