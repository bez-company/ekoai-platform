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

O estado do Terraform fica no bucket `bez-platform-tfstate` (do projeto `bez-platform`), um prefixo por
ambiente: `staging`, `prod` e `ekoai-site`. Pastas, projetos, orçamentos, políticas e o próprio bucket são da
plataforma da BEZ, no repositório `bez-company/bez-platform`; aqui fica só a Ekoai.

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
printf '%s' "$VALOR" | gcloud secrets versions add instagram-app-secret --data-file=- --project=ekoai-prod
```

`terraform output secrets_to_fill` lista os nomes. O job `refresh-tokens` grava os tokens
renovados sozinho (a conta do app tem `secretVersionAdder` só nos do LinkedIn; o token de Instagram de cada conta fica cifrado no banco e a plataforma o renova).

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
