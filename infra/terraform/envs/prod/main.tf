terraform {
  required_version = ">= 1.9"

  # Estado no bucket do projeto bez-platform (SPEC 013), um prefixo por ambiente.
  backend "gcs" {
    bucket = "bez-platform-tfstate"
    prefix = "prod"
  }
}

provider "google" {
  project               = "ekoai-prod"
  region                = "southamerica-east1"
  user_project_override = true
  billing_project       = "ekoai-prod"
}

provider "google-beta" {
  project               = "ekoai-prod"
  region                = "southamerica-east1"
  user_project_override = true
  billing_project       = "ekoai-prod"
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
  default     = ""
}

variable "alert_email" {
  description = "E-mail dos alertas (TF_VAR_alert_email; o repositório é público)."
  type        = string
  default     = ""
}

module "ekoai" {
  source = "../../modules/ekoai"

  project_id = "ekoai-prod"
  env        = "prod"

  tier             = "beta"
  deploy_workloads = var.deploy_workloads
  platform_image   = var.platform_image
  jobs_image       = var.jobs_image
  alert_email      = var.alert_email
  tenant_id        = var.tenant_id

  # O ekoai-prod recebe 404 no gemini-2.5-flash e no 2.5-flash-lite (testado em 23/10/2026 com generateContent);
  # o 3 Flash em preview responde. O preço de lista do texto em vertex.ts ainda é o do 2.5 Flash.
  vertex_text_model = "gemini-3-flash-preview"

  # f1-micro até haver cliente pagante (US$ 11,53 por mês em São Paulo, contra US$ 38,33 do g1-small):
  # sem SLA, CPU compartilhada e 0,6 GB de RAM. Subir para db-g1-small ou uma instância dedicada
  # reinicia o banco por alguns minutos. Custo medido na análise de custo da plataforma BEZ (repositório bez-platform).
  sql_tier         = "db-f1-micro"
  sql_availability = "ZONAL"
  protect_data     = true
  # Zero até o lançamento (19/01/2027): sem cold start só depois de haver tráfego real.
  platform_min_instances = 0
  schedules_paused       = true
  uptime_check           = true

  # Lançamento-base (23/10/2026): cada empresa cria a própria conta e entra por pessoa. O limite de taxa
  # no cadastro entrou com o BEZ-29 (migration 0035), a condição que este ambiente esperava para abrir.
  # Segundo fator desligado por padrão (27/10/2026): quem quiser liga em Perfil.
  auth_provider = "identity"
  signup_mode   = "open"
  mfa_mode      = "optional"

  # E-mail dos convites pelo Gmail API (BEZ-28, ADR 0027). Remetente e resposta são endereços do produto.
  # `mail_provider` só vira "gmail" depois dos passos do runbook (segredo, delegação de domínio, "Enviar e-mail
  # como"): ligado antes, o convite falha em vez de devolver o link para copiar. Produção liga só depois da release que leva o GmailMailer para a `main` (a imagem de produção vem da `main`: com o provedor ligado e o código antigo, o convite falha) e da delegação do client ID da conta do app.
  mail_provider = ""
  mail_from     = "Ekoai <no-reply@ekoai.com.br>"
  mail_reply_to = "suporte@ekoai.com.br"

  # Os posts agendados saem no horário, como no staging (BEZ-228). Os outros jobs seguem pausados.
  publish_paused = false

  # Domínio da plataforma no Firebase Hosting (ADR 0020). Os registros de DNS saem em `app_dns_records`.
  app_domain = "app.ekoai.com.br"
}

output "platform_url" { value = module.ekoai.platform_url }
output "app_dns_records" { value = module.ekoai.app_dns_records }
output "registry" { value = module.ekoai.registry }
output "media_bucket" { value = module.ekoai.media_bucket }
output "sql_instance" { value = module.ekoai.sql_instance }
output "deploy_service_account" { value = module.ekoai.deploy_service_account }
output "app_service_account_client_id" { value = module.ekoai.app_service_account_client_id }
output "workload_identity_provider" { value = module.ekoai.workload_identity_provider }
output "secrets_to_fill" { value = module.ekoai.secrets_to_fill }
