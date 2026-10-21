terraform {
  required_version = ">= 1.9"

  # Estado no bucket do projeto bez-platform (SPEC 013), um prefixo por ambiente.
  backend "gcs" {
    bucket = "bez-platform-tfstate"
    prefix = "saint-jardin-staging"
  }
}

provider "google" {
  project               = "saint-jardin-staging"
  region                = "southamerica-east1"
  user_project_override = true
  billing_project       = "saint-jardin-staging"
}

variable "deploy_workloads" {
  type    = bool
  default = false
}

variable "bot_image" {
  type    = string
  default = ""
}

variable "alert_email" {
  description = "E-mail dos alertas (TF_VAR_alert_email; o repositório é público)."
  type        = string
  default     = ""
}

module "saint_jardin" {
  source = "../../modules/saint-jardin"

  project_id = "saint-jardin-staging"
  env        = "staging"

  tier             = "beta"
  deploy_workloads = var.deploy_workloads
  bot_image        = var.bot_image
  alert_email      = var.alert_email

  # Staging: banco desligado fora dos testes, Scheduler pausado, resposta imediata com número de teste.
  sql_tier         = "db-f1-micro"
  protect_data     = false
  min_instances    = 0
  schedules_paused = true
  modo_teste       = true
  uptime_check     = false

  # O deploy liga o banco parado antes de migrar.
  deploy_can_power_db = true
}

# Promoção por digest: o deploy de produção lê daqui a imagem que passou na staging e a copia para o
# registry de produção, sem reconstruir. Só leitura, e só a conta de deploy de produção.
resource "google_artifact_registry_repository_iam_member" "prod_deploy_reads_staging" {
  project    = "saint-jardin-staging"
  location   = "southamerica-east1"
  repository = "saint-jardin"
  role       = "roles/artifactregistry.reader"
  member     = "serviceAccount:saint-jardin-deploy@saint-jardin-prod.iam.gserviceaccount.com"
}

output "bot_url" { value = module.saint_jardin.bot_url }
output "registry" { value = module.saint_jardin.registry }
output "propostas_bucket" { value = module.saint_jardin.propostas_bucket }
output "sql_instance" { value = module.saint_jardin.sql_instance }
output "deploy_service_account" { value = module.saint_jardin.deploy_service_account }
output "workload_identity_provider" { value = module.saint_jardin.workload_identity_provider }
output "secrets_to_fill" { value = module.saint_jardin.secrets_to_fill }
