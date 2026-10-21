# Site da BEZ no projeto bez-site-prod (SPEC 013, Etapa 2): Cloud Run com mínimo 0 e Firebase Hosting
# na frente do domínio (o Cloud Run em São Paulo não tem domínio próprio nativo). Uma página, sem
# banco e sem login, então nível `beta`, só produção.
#
#   export GOOGLE_OAUTH_ACCESS_TOKEN=$(CLOUDSDK_ACTIVE_CONFIG_NAME=bez gcloud auth print-access-token)
#   export TF_VAR_alert_email=<e-mail dos alertas>          # fora do repositório, que é público
#   cd infra/terraform/envs/bez-site && terraform init && terraform apply
#
# Em duas etapas, como a Ekoai: primeiro a base (registry, conta de serviço, site do Hosting);
# com a imagem no registry, `-var site_image=<registry>/bez-website@sha256:...` cria o serviço e a
# versão do Hosting que aponta para ele. O domínio é ligado à parte (README, "Domínio do site").

terraform {
  required_version = ">= 1.9"

  backend "gcs" {
    bucket = "bez-platform-tfstate"
    prefix = "bez-site"
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
  project = "bez-site-prod"
  region  = "southamerica-east1"
  service = "bez-website"
  labels  = { app = "bez-site", product = "bez-site", env = "prod", tier = "beta" }
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

variable "site_image" {
  description = "Imagem do site (registry/bez-website@sha256:...). Vazio cria só a base."
  type        = string
  default     = ""
}

variable "site_id" {
  description = "ID do site do Firebase Hosting (único no mundo; vira SITE.web.app)."
  type        = string
  default     = "bezcompany"
}

variable "uptime_host" {
  description = "Domínio que o uptime check consulta. Vazio pula o check (antes de o domínio migrar)."
  type        = string
  default     = ""
}

variable "alert_email" {
  description = "E-mail dos alertas (TF_VAR_alert_email; o repositório é público)."
  type        = string
  default     = ""
}

resource "google_project_service" "api" {
  for_each = toset([
    "artifactregistry.googleapis.com",
    "firebase.googleapis.com",
    "firebasehosting.googleapis.com",
    "logging.googleapis.com",
    "monitoring.googleapis.com",
    "run.googleapis.com",
  ])
  service            = each.key
  disable_on_destroy = false
}

resource "google_artifact_registry_repository" "bez" {
  location      = local.region
  repository_id = "bez"
  format        = "DOCKER"
  description   = "Imagem do site da BEZ"
  labels        = local.labels

  cleanup_policies {
    id     = "delete-untagged"
    action = "DELETE"
    condition {
      tag_state  = "UNTAGGED"
      older_than = "604800s"
    }
  }
  cleanup_policies {
    id     = "keep-recent"
    action = "KEEP"
    most_recent_versions {
      keep_count = 10
    }
  }
  depends_on = [google_project_service.api]
}

# O serviço roda com uma conta própria, sem nenhum papel. A conta padrão do Compute era a usada antes.
resource "google_service_account" "site" {
  account_id   = "bez-site-run"
  display_name = "Site da BEZ (Cloud Run)"
}

resource "google_firebase_project" "this" {
  provider   = google-beta
  project    = local.project
  depends_on = [google_project_service.api]
}

resource "google_firebase_hosting_site" "site" {
  provider   = google-beta
  project    = local.project
  site_id    = var.site_id
  depends_on = [google_firebase_project.this]
}

resource "google_cloud_run_v2_service" "site" {
  count               = var.site_image == "" ? 0 : 1
  name                = local.service
  location            = local.region
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = false
  labels              = local.labels

  # A organização barra `allUsers` no IAM (compartilhamento restrito a domínio). O site é público
  # por definição, então a checagem de IAM do Cloud Run fica desligada.
  invoker_iam_disabled = true

  template {
    service_account                  = google_service_account.site.email
    max_instance_request_concurrency = 80
    timeout                          = "300s"

    scaling {
      min_instance_count = 0
      max_instance_count = 2
    }

    containers {
      image = var.site_image

      ports {
        container_port = 8080
      }

      resources {
        limits            = { cpu = "1", memory = "512Mi" }
        cpu_idle          = true
        startup_cpu_boost = true
      }

      startup_probe {
        tcp_socket {
          port = 8080
        }
        period_seconds    = 10
        timeout_seconds   = 5
        failure_threshold = 12
      }
    }
  }

  lifecycle {
    # O deploy troca a imagem; o Terraform não a desfaz.
    ignore_changes = [template[0].containers[0].image, client, client_version]
  }

  depends_on = [google_project_service.api]
}

# Hosting na frente do Cloud Run: toda rota cai no serviço. Sem arquivo estático.
resource "google_firebase_hosting_version" "live" {
  count    = var.site_image == "" ? 0 : 1
  provider = google-beta
  site_id  = google_firebase_hosting_site.site.site_id

  config {
    rewrites {
      glob = "**"
      run {
        service_id = google_cloud_run_v2_service.site[0].name
        region     = local.region
      }
    }
  }
}

resource "google_firebase_hosting_release" "live" {
  count        = var.site_image == "" ? 0 : 1
  provider     = google-beta
  site_id      = google_firebase_hosting_site.site.site_id
  version_name = google_firebase_hosting_version.live[0].name
  message      = "Terraform"
}

# Domínio no site. A troca de site foi feita pela migração ao vivo do Firebase (README, "Domínio do
# site"): TXT `hosting-site=` do apex e CNAME do www apontando para este site. O www redireciona
# para o apex.
resource "google_firebase_hosting_custom_domain" "apex" {
  provider              = google-beta
  project               = local.project
  site_id               = google_firebase_hosting_site.site.site_id
  custom_domain         = "bezcompany.com.br"
  wait_dns_verification = false
}

resource "google_firebase_hosting_custom_domain" "www" {
  provider              = google-beta
  project               = local.project
  site_id               = google_firebase_hosting_site.site.site_id
  custom_domain         = "www.bezcompany.com.br"
  redirect_target       = "bezcompany.com.br"
  wait_dns_verification = false
}

resource "google_monitoring_notification_channel" "email" {
  count        = var.alert_email == "" ? 0 : 1
  display_name = "E-mail da BEZ (site)"
  type         = "email"
  labels       = { email_address = var.alert_email }
  depends_on   = [google_project_service.api]
}

resource "google_monitoring_uptime_check_config" "site" {
  count        = var.uptime_host == "" ? 0 : 1
  display_name = "Site da BEZ no ar"
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
  depends_on = [google_project_service.api]
}

resource "google_monitoring_alert_policy" "site_down" {
  count                 = var.uptime_host == "" ? 0 : 1
  display_name          = "Site da BEZ fora do ar"
  combiner              = "OR"
  notification_channels = [for c in google_monitoring_notification_channel.email : c.id]

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

output "registry" {
  value = "${local.region}-docker.pkg.dev/${local.project}/${google_artifact_registry_repository.bez.repository_id}"
}

output "hosting_url" {
  value = "https://${google_firebase_hosting_site.site.site_id}.web.app"
}
