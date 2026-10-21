terraform {
  required_version = ">= 1.9"

  # Estado dos dois ambientes no bucket do projeto de produção, um prefixo por ambiente.
  backend "gcs" {
    bucket = "ekoai-prod-tfstate"
    prefix = "staging"
  }
}

provider "google" {
  project               = "ekoai-staging"
  region                = "southamerica-east1"
  user_project_override = true
  billing_project       = "ekoai-staging"
}

variable "deploy_workloads" {
  type    = bool
  default = false
}

variable "platform_image" {
  type    = string
  default = ""
}

variable "jobs_image" {
  type    = string
  default = ""
}

variable "tenant_id" {
  description = "Conta da instalação (TF_VAR_tenant_id; o id da conta real não vai para o repositório)."
  type        = string
  default     = "exemplo"
}

variable "alert_email" {
  description = "E-mail dos alertas (TF_VAR_alert_email; o repositório é público)."
  type        = string
  default     = ""
}

module "ekoai" {
  source = "../../modules/ekoai"

  project_id    = "ekoai-staging"
  env           = "staging"
  deploy_branch = "staging"

  tier             = "beta"
  deploy_workloads = var.deploy_workloads
  platform_image   = var.platform_image
  jobs_image       = var.jobs_image
  alert_email      = var.alert_email
  tenant_id        = var.tenant_id

  # Staging: login por pessoa e cadastro aberto, para testar a entrada de verdade com dado de teste.
  # Produção segue com senha única e cadastro por convite até haver limite de taxa no cadastro.
  auth_provider = "identity"
  signup_mode   = "open"

  sql_tier               = "db-f1-micro"
  sql_availability       = "ZONAL"
  protect_data           = false
  platform_min_instances = 0
  schedules_paused       = true
  uptime_check           = false
}

output "platform_url" { value = module.ekoai.platform_url }
output "registry" { value = module.ekoai.registry }
output "media_bucket" { value = module.ekoai.media_bucket }
output "sql_instance" { value = module.ekoai.sql_instance }
output "deploy_service_account" { value = module.ekoai.deploy_service_account }
output "workload_identity_provider" { value = module.ekoai.workload_identity_provider }
output "secrets_to_fill" { value = module.ekoai.secrets_to_fill }
