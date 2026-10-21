# Infra no Google Cloud (SPEC 010)

Dois projetos, `ekoai-staging` e `ekoai-prod`, numa pasta `ekoai` da organização da BEZ. O mesmo
módulo (`modules/ekoai`) cria os dois; cada ambiente só muda tamanho, proteção e agendas.

```
modules/ekoai/     rede privada, Cloud SQL (Postgres 17), Cloud Run (plataforma e jobs),
                   Scheduler, Secret Manager, bucket de mídia, Artifact Registry, Identity
                   Platform, Workload Identity Federation, alertas
envs/staging/      projeto ekoai-staging, banco f1-micro, sem proteção contra exclusão
envs/prod/         projeto ekoai-prod, banco f1-micro, proteção contra exclusão e uptime check
```

O estado do Terraform de todos os ambientes fica no bucket `bez-platform-tfstate` (versionado, projeto
`bez-platform`), um prefixo por ambiente. Os ambientes da Ekoai são só uma parte da BEZ: o que é da
organização inteira mora em `platform/` e `foundation/` ([SPEC 013](../../docs/specs/013-bez-cloud-platform.md)).

```
platform/      projeto bez-platform: orçamentos por projeto e o dataset da exportação de faturamento
foundation/    políticas de organização (valem para todas as pastas e projetos)
```

## Bootstrap do projeto de plataforma (uma vez, já feito)

O projeto `bez-platform` guarda o estado do Terraform de todos e o dataset da exportação de
faturamento. O Terraform não o cria: pastas, projetos e o bucket do estado nascem à mão. O ID
`bez-sandbox` estava em uso no mundo, então o sandbox é `bez-company-sandbox`.

```bash
ORG=<id da organização>; BILLING=<id da conta de faturamento>
PF=$(gcloud resource-manager folders create --display-name=bez-platform --organization=$ORG --format='value(name)')
SF=$(gcloud resource-manager folders create --display-name=sandbox --organization=$ORG --format='value(name)')
gcloud projects create bez-platform --folder=${PF#folders/} --labels=product=platform,env=prod,tier=production
gcloud projects create bez-company-sandbox --folder=${SF#folders/} --labels=product=sandbox,env=dev,tier=lab
for p in bez-platform bez-company-sandbox; do gcloud billing projects link $p --billing-account=$BILLING; done
gcloud services enable serviceusage.googleapis.com cloudresourcemanager.googleapis.com iam.googleapis.com \
  storage.googleapis.com cloudbilling.googleapis.com billingbudgets.googleapis.com orgpolicy.googleapis.com \
  bigquery.googleapis.com --project=bez-platform
gcloud storage buckets create gs://bez-platform-tfstate --project=bez-platform --location=southamerica-east1 \
  --uniform-bucket-level-access --public-access-prevention
gcloud storage buckets update gs://bez-platform-tfstate --versioning
```

Em 21/10/2026 os estados `foundation`, `prod` e `staging` foram copiados do `ekoai-prod-tfstate`, com
o hash conferido, e os backends passaram para o bucket novo. O bucket antigo fica até a próxima
release passar limpa e é apagado depois.

## Bootstrap da Ekoai (uma vez, já feito)

O que o Terraform não cria: a pasta, os projetos, o faturamento e o bucket do estado. Com a conta
administradora da BEZ (`CLOUDSDK_ACTIVE_CONFIG_NAME=bez`):

```bash
ORG=<id da organização>; BILLING=<id da conta de faturamento>
FOLDER=$(gcloud resource-manager folders create --display-name=ekoai --organization=$ORG --format='value(name)')
for env in staging prod; do
  gcloud projects create ekoai-$env --folder=${FOLDER#folders/} --labels=app=ekoai,env=$env
  gcloud billing projects link ekoai-$env --billing-account=$BILLING
  gcloud services enable serviceusage.googleapis.com cloudresourcemanager.googleapis.com \
    iam.googleapis.com storage.googleapis.com --project=ekoai-$env
done
```

Criar a pasta pede o papel `roles/resourcemanager.folderAdmin` no nível da organização
(`organizationAdmin` sozinho não basta).

## Orçamentos e exportação de faturamento (`platform/`)

Um orçamento mensal por projeto (50%, 80%, 100% e previsão de 100%) mais o global de R$ 330, todos
sobre o custo **antes** dos créditos, e o dataset `billing_export` em São Paulo. O aviso vai por
e-mail para quem administra a conta de faturamento.

```bash
export GOOGLE_OAUTH_ACCESS_TOKEN=$(CLOUDSDK_ACTIVE_CONFIG_NAME=bez gcloud auth print-access-token)
export TF_VAR_billing_account=<id da conta de faturamento>   # fora do repositório
export TF_VAR_site_project_id=<projeto onde o site roda hoje>
cd infra/terraform/platform && terraform init && terraform plan && terraform apply
```

A exportação de faturamento para o BigQuery só se liga pelo console (não há API): Faturamento >
Exportação do faturamento > Custo de uso padrão e detalhado > dataset `billing_export` do
`bez-platform`. Ela não recupera o passado.

Projeto novo entra em `local.project_budgets` com o valor do nível dele.

## Políticas de organização (`foundation/`)

Valem para a organização inteira, então toda pasta e todo projeto novo as herda: sem criar chave de
conta de serviço, Cloud SQL sem IP público, bucket sem acesso público e sem a rede `default`. A
subida de chave (`iam.disableServiceAccountKeyUpload`) já vem ligada na organização por padrão do
Google. Aplica-se uma vez, com a conta administradora, e só ela precisa de
`roles/orgpolicy.policyAdmin`, que o Google só deixa conceder no nível da organização: dê o papel,
aplique e revogue (`export TF_VAR_org_id=<id da organização>`, depois `terraform apply` em
`infra/terraform/foundation`). `run.requireInvokerIam` fica de fora de propósito: a plataforma é
pública pela opção `invoker_iam_disabled`. A restrição de região (`gcp.resourceLocations`) não foi
aplicada: segredos com replicação automática, o endpoint global do Vertex e o Identity Platform
podem esbarrar nela, e só entra depois de testada no sandbox.

## Aplicar

```bash
export GOOGLE_OAUTH_ACCESS_TOKEN=$(CLOUDSDK_ACTIVE_CONFIG_NAME=bez gcloud auth print-access-token)
export TF_VAR_alert_email=<e-mail dos alertas>   # fora do repositório, que é público
cd infra/terraform/envs/staging
terraform init && terraform plan && terraform apply
```

Em duas etapas, porque o serviço e os jobs precisam de imagem:

1. `terraform apply` (base: rede, banco, segredos, registry, IAM, Identity Platform).
2. Empurre as imagens (o deploy do GitHub Actions faz isso; na primeira vez, Cloud Build ou
   `docker buildx imagetools create` de um ambiente para o outro) e rode
   `terraform apply -var deploy_workloads=true -var platform_image=<...> -var jobs_image=<...>`.

Depois disso o CI troca a imagem a cada merge (`deploy.yml`) e o Terraform ignora a imagem.

## Cloud KMS (tokens das redes)

Um keyring `ekoai` e uma chave simétrica `social-tokens` por projeto, rotação a cada 90 dias. A
conta de serviço do app (a mesma da plataforma e dos jobs) tem
`roles/cloudkms.cryptoKeyEncrypterDecrypter` nela. O nome completo vai em `KMS_KEY_NAME` na
plataforma e nos jobs. O servidor cifra o token da rede e grava só o texto cifrado e a versão da
chave (SPEC 011 R5). Keyring e chave não se apagam no Cloud KMS, por isso o `prevent_destroy`.

## Segredos

O Terraform gera e guarda `database-url`, `auth-secret`, `cron-secret` e `platform-password`.
Os demais (Gemini, Instagram, LinkedIn, X) nascem com um valor em branco para o Cloud Run poder
montá-los; grave o valor real como versão nova:

```bash
printf '%s' "$VALOR" | gcloud secrets versions add ig-access-token --data-file=- --project=ekoai-prod
```

`terraform output secrets_to_fill` lista os nomes. O job `refresh-tokens` grava os tokens
renovados sozinho (a conta do app tem `secretVersionAdder` só nesses três).

## Deploy pelo GitHub Actions

`deploy.yml` roda depois do CI na `main`: staging sozinho, produção com aprovação no environment
`prod`. Cada environment do GitHub precisa de três variáveis (valores nos outputs do Terraform):

| Variável | Valor |
| --- | --- |
| `GCP_PROJECT` | `ekoai-staging` ou `ekoai-prod` |
| `WIF_PROVIDER` | `terraform output workload_identity_provider` |
| `DEPLOY_SA` | `terraform output deploy_service_account` |

A federação só aceita o repositório `bez-company/ekoai-platform` na branch `main`. Não existe chave
JSON de service account em lugar nenhum.

## Login (Identity Platform)

Ligado em cada projeto, com e-mail e senha e TOTP. O Terraform também cria a chave de API do
navegador (restrita às APIs do login e ao referer da plataforma), publica os domínios autorizados e
entrega ao Cloud Run `FIREBASE_WEB_API_KEY` e `FIREBASE_AUTH_DOMAIN`. O servidor deve ler os dois em
runtime e passá-los ao cliente: uma variável `NEXT_PUBLIC_` seria fixada no build da imagem. Os
textos dos e-mails de confirmação e de nova senha se editam no console (Authentication >
Templates); a API recusa a edição. O remetente é `noreply@<projeto>.firebaseapp.com` até haver
domínio próprio verificado.

## Segurança em resumo

- Cloud SQL só com IP interno, TLS obrigatório, backup diário e recuperação a qualquer ponto de 7
  dias, proteção contra exclusão em produção.
- Uma conta de serviço por função (`app`, `scheduler`, `deploy`), com o mínimo. O Scheduler chama a
  plataforma com token OIDC, que ela confere (assinatura, público e e-mail).
- A organização barra `allUsers` no IAM, então a plataforma fica pública com a checagem de IAM do
  Cloud Run desligada (`invoker_iam_disabled`); o app exige sessão em toda rota privada. A mídia
  fica em bucket privado e só sai pela rota `/api/media`.
- As agendas nascem **pausadas** (`schedules_paused = true`). Ligar é decisão explícita, quando for
  para publicar de verdade.
