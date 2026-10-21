# Site da Ekoai (landing page) no projeto ekoai-prod (SPEC 015, ADR 0016): página estática num site
# próprio do Firebase Hosting, sem Cloud Run e sem banco. O código mora em bez-company/ekoai-website;
# o GitHub Actions de lá publica pelo Workload Identity, sem chave de conta de serviço.
#
#   export GOOGLE_OAUTH_ACCESS_TOKEN=$(CLOUDSDK_ACTIVE_CONFIG_NAME=bez gcloud auth print-access-token)
#   export TF_VAR_alert_email=<e-mail dos alertas>          # fora do repositório, que é público
#   cd infra/terraform/envs/ekoai-site && terraform init && terraform apply
#
# Estado separado do `envs/prod`: o site não espera a release da plataforma e um apply aqui não toca
# no módulo da Ekoai. O domínio só liga com `-var connect_domain=true`, quando a LP estiver pronta
# (README, "Domínio da Ekoai").

terraform {
  required_version = ">= 1.9"

  backend "gcs" {
    bucket = "bez-platform-tfstate"
    prefix = "ekoai-site"
  }

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 6.40, < 8.0"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = ">= 6.40, < 8.0"
    }
  }
}

locals {
  project     = "ekoai-prod"
  region      = "southamerica-east1"
  github_repo = "bez-company/ekoai-website"
  domain      = "ekoai.com.br"
  labels      = { app = "ekoai-site", product = "ekoai", env = "prod", tier = "beta" }
}

provider "google" {
  project               = local.project
  region                = local.region
  user_project_override = true
  billing_project       = local.project
}

provider "google-beta" {
  project               = local.project
  region                = local.region
  user_project_override = true
  billing_project       = local.project
}

variable "site_id" {
  description = "ID do site do Firebase Hosting (único no mundo; vira SITE.web.app)."
  type        = string
  default     = "ekoai"
}

variable "connect_domain" {
  description = "Liga ekoai.com.br e www no site. Só com a LP pronta (decisão de 21/10/2026)."
  type        = bool
  default     = false
}

variable "uptime_host" {
  description = "Domínio que o uptime check consulta. Vazio pula o check (antes de o domínio ligar)."
  type        = string
  default     = ""
}

variable "alert_email" {
  description = "E-mail dos alertas (TF_VAR_alert_email; o repositório é público)."
  type        = string
  default     = ""
}

# O projeto Firebase e a API do Hosting já existem no ekoai-prod (Identity Platform, módulo da Ekoai).
resource "google_firebase_hosting_site" "site" {
  provider = google-beta
  project  = local.project
  site_id  = var.site_id
}

# Quem publica: uma conta só com o Hosting. Não lê segredo, banco nem Cloud Run.
resource "google_service_account" "deploy" {
  account_id   = "ekoai-site-deploy"
  display_name = "Site da Ekoai (deploy pelo GitHub Actions)"
}

resource "google_project_iam_member" "deploy_hosting" {
  project = local.project
  role    = "roles/firebasehosting.admin"
  member  = "serviceAccount:${google_service_account.deploy.email}"
}

# O pool `github` é do módulo da Ekoai; aqui só entra um provider novo, preso ao repositório do site.
# Qualquer branch: o PR publica num canal de preview e a `main` publica no ar (o workflow decide).
data "google_iam_workload_identity_pool" "github" {
  provider                  = google-beta
  project                   = local.project
  workload_identity_pool_id = "github"
}

resource "google_iam_workload_identity_pool_provider" "site" {
  project                            = local.project
  workload_identity_pool_id          = data.google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-site"
  display_name                       = "GitHub (site da Ekoai)"

  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.repository" = "assertion.repository"
    "attribute.ref"        = "assertion.ref"
  }
  attribute_condition = "assertion.repository == '${local.github_repo}'"

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

resource "google_service_account_iam_member" "deploy_from_github" {
  service_account_id = google_service_account.deploy.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${data.google_iam_workload_identity_pool.github.name}/attribute.repository/${local.github_repo}"
}

# Domínio: o apex serve a LP e o www redireciona para ele. `app.` fica para a plataforma (BEZ-42).
resource "google_firebase_hosting_custom_domain" "apex" {
  count                 = var.connect_domain ? 1 : 0
  provider              = google-beta
  project               = local.project
  site_id               = google_firebase_hosting_site.site.site_id
  custom_domain         = local.domain
  wait_dns_verification = false
}

resource "google_firebase_hosting_custom_domain" "www" {
  count                 = var.connect_domain ? 1 : 0
  provider              = google-beta
  project               = local.project
  site_id               = google_firebase_hosting_site.site.site_id
  custom_domain         = "www.${local.domain}"
  redirect_target       = local.domain
  wait_dns_verification = false
}

resource "google_monitoring_notification_channel" "email" {
  count        = var.alert_email == "" || var.uptime_host == "" ? 0 : 1
  display_name = "E-mail da BEZ (site da Ekoai)"
  type         = "email"
  labels       = { email_address = var.alert_email }
}

resource "google_monitoring_uptime_check_config" "site" {
  count        = var.uptime_host == "" ? 0 : 1
  display_name = "Site da Ekoai no ar"
  timeout      = "10s"
  period       = "300s"

  http_check {
    path         = "/"
    port         = 443
    use_ssl      = true
    validate_ssl = true
  }

  monitored_resource {
    type = "uptime_url"
    labels = {
      project_id = local.project
      host       = var.uptime_host
    }
  }
}

resource "google_monitoring_alert_policy" "site_down" {
  count                 = var.uptime_host == "" ? 0 : 1
  display_name          = "Site da Ekoai fora do ar"
  combiner              = "OR"
  notification_channels = [for c in google_monitoring_notification_channel.email : c.id]
  user_labels           = local.labels

  conditions {
    display_name = "Uptime check falhando"
    condition_threshold {
      filter          = "resource.type=\"uptime_url\" AND metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\" AND metric.labels.check_id=\"${google_monitoring_uptime_check_config.site[0].uptime_check_id}\""
      comparison      = "COMPARISON_GT"
      threshold_value = 1
      duration        = "300s"
      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_NEXT_OLDER"
        cross_series_reducer = "REDUCE_COUNT_FALSE"
        group_by_fields      = ["resource.label.*"]
      }
    }
  }
}

output "hosting_url" {
  value = "https://${google_firebase_hosting_site.site.site_id}.web.app"
}

output "site_id" {
  value = google_firebase_hosting_site.site.site_id
}

output "deploy_service_account" {
  value = google_service_account.deploy.email
}

output "workload_identity_provider" {
  value = google_iam_workload_identity_pool_provider.site.name
}

# Registros que o Registro.br precisa receber quando o domínio ligar (TXT, A e CNAME).
output "dns_records" {
  value = {
    apex = try(google_firebase_hosting_custom_domain.apex[0].required_dns_updates, null)
    www  = try(google_firebase_hosting_custom_domain.www[0].required_dns_updates, null)
  }
}
