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
envs/bez-site/ projeto bez-site-prod: site da BEZ (Cloud Run, Firebase Hosting, domínio)
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

## Site da BEZ (`envs/bez-site/`)

Projeto `bez-site-prod`, pasta `bez-site`, nível `beta`, só produção (uma página, sem banco): Cloud Run
com mínimo 0 e máximo 2 em São Paulo, Firebase Hosting na frente (o Cloud Run em São Paulo não tem
domínio próprio nativo), conta de serviço própria sem papel nenhum, uptime check no domínio e alerta.

```bash
gcloud resource-manager folders create --display-name=bez-site --organization=<id da organização>
gcloud projects create bez-site-prod --folder=<id da pasta> --labels=product=bez-site,env=prod,tier=beta
gcloud billing projects link bez-site-prod --billing-account=<id da conta de faturamento>
gcloud services enable serviceusage.googleapis.com cloudresourcemanager.googleapis.com iam.googleapis.com \
  run.googleapis.com artifactregistry.googleapis.com firebase.googleapis.com firebasehosting.googleapis.com \
  logging.googleapis.com monitoring.googleapis.com --project=bez-site-prod
cd infra/terraform/envs/bez-site && terraform init && terraform apply            # 1. base
# copie a imagem para o registry (docker pull, tag, push; o digest se mantém) e depois:
terraform apply -var site_image=<registry>/bez-website@sha256:... -var uptime_host=bezcompany.com.br
```

**Limite de projetos por faturamento.** A conta de faturamento de teste aceita 5 projetos vinculados
("Cloud billing quota exceeded"). O sandbox ficou sem faturamento até sobrar vaga (ele está vazio) e o
projeto padrão antigo sai depois de 48 horas de observação. Pedir aumento de cota ou converter a conta
para paga antes de criar os projetos do bot e do Pilar.

**Domínio do site (migração ao vivo, sem tirar o site do ar).** O Firebase migra um domínio de um site
para outro quando o DNS passa a apontar para o novo. Foram só dois registros no GoDaddy:
`TXT @ hosting-site=bezcompany` (no lugar de `hosting-site=bez-company`) e
`CNAME www bezcompany.web.app.` (no lugar de `bez-company.web.app.`). O A (`199.36.158.100`), o MX, o SPF
e a verificação do Google ficam como estão. O apex passou em cerca de 1 minuto; o `www` esperou o cache
de 1 hora do CNAME antigo. Para voltar atrás, restaure os dois registros e recrie os domínios no site
antigo.

**Código-fonte.** O repositório `bez-company/bez-website` não tem o código do Next.js: só marca e
design system. A imagem em produção foi construída de um diretório de trabalho que não foi commitado e
cujo workspace já foi arquivado, e a imagem não guarda o código original (os sourcemaps vêm vazios). A
imagem (digest `sha256:88a18b7f...`) é hoje o único artefato do site; ela está no registry de
`bez-site-prod`. Sem o código não há deploy por GitHub Actions.

## Site da Ekoai (`envs/ekoai-site/`)

Landing page de `ekoai.com.br` ([SPEC 015](../../docs/specs/015-site-da-ekoai-em-ekoai-com-br.md),
[ADR 0016](../../docs/adr/0016-site-da-ekoai-estatico-no-hosting-do-ekoai-prod.md)). Site estático num
site próprio do Firebase Hosting (`ekoai`) no projeto `ekoai-prod`, sem Cloud Run. O código está em
`bez-company/ekoai-website`, que publica pelo provider `github-site` do pool `github` com a conta
`ekoai-site-deploy` (só Hosting). Estado próprio (prefixo `ekoai-site`): não depende da release.

```bash
cd infra/terraform/envs/ekoai-site && terraform init && terraform apply    # base (aplicada em 21/10/2026)
```

**Domínio da Ekoai.** Só com a página pronta (BEZ-137). O DNS é servido pela GoDaddy (`ns09` e `ns10.domaincontrol.com`).

```bash
terraform apply -var connect_domain=true
terraform output dns_records      # registros que o Firebase pede para o apex e o www
# GoDaddy › ekoai.com.br › DNS: trocar o A "Parked" pelo do Hosting, criar o TXT e apontar o CNAME do www
# certificado emitido (minutos a 24 h) e depois:
terraform apply -var connect_domain=true -var uptime_host=ekoai.com.br
```

`app.ekoai.com.br` é da plataforma (BEZ-42, Load Balancer): o Hosting só repassa o cookie
`__session` ao Cloud Run, e o login usa outro.

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
