terraform {
  required_version = ">= 1.9"

  # Estado no bucket do projeto bez-platform (SPEC 013), um prefixo por ambiente.
  backend "gcs" {
    bucket = "bez-platform-tfstate"
    prefix = "staging"
  }
}

provider "google" {
  project               = "ekoai-staging"
  region                = "southamerica-east1"
  user_project_override = true
  billing_project       = "ekoai-staging"
}

provider "google-beta" {
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

variable "studio_image" {
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
  studio_image     = var.studio_image
  # Estúdio de posts (SPEC 030 F3c): liga no staging primeiro. Produção liga depois do eval e da aprovação do Matheus.
  studio_job_enabled = true
  alert_email        = var.alert_email
  tenant_id          = var.tenant_id

  # Staging: login por pessoa e cadastro aberto, para testar a entrada de verdade com dado de teste.
  # Produção segue com senha única e cadastro por convite até haver limite de taxa no cadastro.
  auth_provider = "identity"
  signup_mode   = "open"
  # E-mail dos convites pelo Gmail API (BEZ-28, ADR 0027). Remetente e resposta são endereços do produto.
  # `mail_provider` só vira "gmail" depois dos passos do runbook (segredo, delegação de domínio, "Enviar e-mail
  # como"): ligado antes, o convite falha em vez de devolver o link para copiar. Staging ligado em 28/10/2026.
  mail_provider = "gmail"
  mail_from     = "Ekoai <no-reply@ekoai.com.br>"
  mail_reply_to = "suporte@ekoai.com.br"

  # Sem segundo fator obrigatório por enquanto (decisão de 21/10/2026, BEZ-169). Produção segue em `required`.
  mfa_mode = "optional"

  # Imagem: Flash Lite aprovou 100% das fotos do torneio de 22/10/2026 por metade do preço (BEZ-220).
  # A produção segue no 3.1 Flash até a rodada com briefs reais.
  vertex_image_model = "gemini-3.1-flash-lite-image"

  sql_tier               = "db-f1-micro"
  sql_availability       = "ZONAL"
  protect_data           = false
  platform_min_instances = 0
  schedules_paused       = true
  uptime_check           = false

  # Os agendados saem no horário (BEZ-228). O sleep-if-idle não desliga o banco com post esperando.
  publish_paused = false

  # O Instagram conectado aqui é o perfil oficial da marca, então o staging ensaia: cria o container na Meta,
  # valida e não publica. Para publicar de verdade num teste, troque para "live" com uma conta de teste conectada.
  publish_mode = "rehearsal"

  # O deploy liga o banco parado antes de migrar (o staging fica desligado fora dos testes).
  deploy_can_power_db = true

  # Staging sob demanda (SPEC 016): tela "Ligar o ambiente", corte por ociosidade e probes que não dependem do banco.
  wake_enabled      = true
  wake_idle_minutes = 60
  probe_path        = "/api/live"
}

# Promoção por digest (SPEC 013, E1.12): o deploy de produção lê daqui a imagem que passou na
# staging e a copia para o registry de produção, sem reconstruir. Só leitura, e só a conta de
# deploy de produção.
resource "google_artifact_registry_repository_iam_member" "prod_deploy_reads_staging" {
  project    = "ekoai-staging"
  location   = "southamerica-east1"
  repository = "ekoai"
  role       = "roles/artifactregistry.reader"
  member     = "serviceAccount:ekoai-deploy@ekoai-prod.iam.gserviceaccount.com"
}

output "platform_url" { value = module.ekoai.platform_url }
output "registry" { value = module.ekoai.registry }
output "media_bucket" { value = module.ekoai.media_bucket }
output "sql_instance" { value = module.ekoai.sql_instance }
output "deploy_service_account" { value = module.ekoai.deploy_service_account }
output "app_service_account_client_id" { value = module.ekoai.app_service_account_client_id }
output "workload_identity_provider" { value = module.ekoai.workload_identity_provider }
output "secrets_to_fill" { value = module.ekoai.secrets_to_fill }
