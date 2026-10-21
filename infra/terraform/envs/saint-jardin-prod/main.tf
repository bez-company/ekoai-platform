terraform {
  required_version = ">= 1.9"

  # Estado no bucket do projeto bez-platform (SPEC 013), um prefixo por ambiente.
  backend "gcs" {
    bucket = "bez-platform-tfstate"
    prefix = "saint-jardin-prod"
  }
}

provider "google" {
  project               = "saint-jardin-prod"
  region                = "southamerica-east1"
  user_project_override = true
  billing_project       = "saint-jardin-prod"
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

variable "schedules_paused" {
  description = "Scheduler pausado até o cutover (o webhook da Meta ainda aponta para a Vercel). Passa a false no dia do cutover."
  type        = bool
  default     = true
}

module "saint_jardin" {
  source = "../../modules/saint-jardin"

  project_id = "saint-jardin-prod"
  env        = "prod"

  tier             = "beta"
  deploy_workloads = var.deploy_workloads
  bot_image        = var.bot_image
  alert_email      = var.alert_email

  # f1-micro basta para o volume do bot (SPEC 014). Resposta em 40 a 100 s, como na produção atual.
  sql_tier         = "db-f1-micro"
  protect_data     = true
  min_instances    = 0
  schedules_paused = var.schedules_paused
  delay_segundos   = 40
  jitter_segundos  = 60
  uptime_check     = true
}

output "bot_url" { value = module.saint_jardin.bot_url }
output "registry" { value = module.saint_jardin.registry }
output "propostas_bucket" { value = module.saint_jardin.propostas_bucket }
output "sql_instance" { value = module.saint_jardin.sql_instance }
output "deploy_service_account" { value = module.saint_jardin.deploy_service_account }
output "workload_identity_provider" { value = module.saint_jardin.workload_identity_provider }
output "secrets_to_fill" { value = module.saint_jardin.secrets_to_fill }
