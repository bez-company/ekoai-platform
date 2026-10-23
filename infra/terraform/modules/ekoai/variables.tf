variable "project_id" {
  description = "Projeto do Google Cloud do ambiente (ekoai-staging ou ekoai-prod)."
  type        = string
}

variable "env" {
  description = "Nome do ambiente: staging ou prod."
  type        = string
}

variable "tier" {
  description = "Nível de maturidade do produto (SPEC 013): lab, beta ou production. Vira o label `tier` e define os padrões de escala e de recuperação."
  type        = string
  default     = "beta"

  validation {
    condition     = contains(["lab", "beta", "production"], var.tier)
    error_message = "tier deve ser lab, beta ou production."
  }
}

variable "deploy_can_power_db" {
  description = "O deploy pode ligar o Cloud SQL parado (staging sob demanda, SPEC 013 E1.11). Só no staging: em produção o banco nunca desliga e o papel não existe."
  type        = bool
  default     = false
}

variable "wake_enabled" {
  description = "Staging sob demanda (SPEC 016): a plataforma mostra a tela \"Ligar o ambiente\" com o banco parado e o Scheduler o desliga sem uso. Só no staging."
  type        = bool
  default     = false
}

variable "wake_idle_minutes" {
  description = "Minutos sem nenhuma requisição de gente até o banco do staging desligar sozinho (a partir de 15)."
  type        = number
  default     = 60
}

variable "probe_path" {
  description = "Caminho dos probes do Cloud Run. /api/health confere o banco; /api/live só o processo, para o staging subir com o banco parado (BEZ-120)."
  type        = string
  default     = "/api/health"
}

variable "region" {
  type    = string
  default = "southamerica-east1"
}

variable "github_repo" {
  description = "owner/repo que o deploy do GitHub Actions pode assumir (Workload Identity Federation)."
  type        = string
  default     = "bez-company/ekoai-platform"
}

variable "deploy_branch" {
  description = "Branch do GitHub cujo deploy pode assumir a conta de deploy deste ambiente (staging: staging; prod: main). ADR 0013."
  type        = string
  default     = "main"
}

variable "deploy_workloads" {
  description = "Falso na primeira aplicação: cria a base (rede, banco, segredos, registry) antes de existirem imagens. Verdadeiro cria o serviço, os jobs e as agendas."
  type        = bool
  default     = false
}

variable "platform_image" {
  description = "Imagem inicial da plataforma. Depois o deploy do CI troca a imagem; o Terraform ignora a mudança."
  type        = string
  default     = ""
}

variable "jobs_image" {
  description = "Imagem inicial dos jobs. Idem."
  type        = string
  default     = ""
}

variable "vertex_image_model" {
  description = "Modelo de imagem do Vertex AI (env VERTEX_IMAGE_MODEL). O preço por modelo está em IMAGE_PRICING (platform/src/lib/vertex.ts)."
  type        = string
  default     = "gemini-3.1-flash-image"
}

variable "sql_tier" {
  type    = string
  default = "db-f1-micro"
}

variable "sql_availability" {
  description = "ZONAL ou REGIONAL (alta disponibilidade, dobra o custo)."
  type        = string
  default     = "ZONAL"
}

variable "sql_activation_policy" {
  description = "ALWAYS liga o banco; NEVER o para (paga só o disco). O staging fica parado fora de teste."
  type        = string
  default     = "ALWAYS"
}

variable "sql_disk_size_gb" {
  type    = number
  default = 10
}

variable "protect_data" {
  description = "Proteção contra exclusão do banco e do bucket. Verdadeiro em produção."
  type        = bool
  default     = false
}

variable "platform_min_instances" {
  description = "Instâncias sempre quentes da plataforma. Zero tem cold start; 1 evita."
  type        = number
  default     = 0
}

variable "platform_max_instances" {
  description = "Máximo de instâncias da plataforma. Nulo usa o padrão do nível (lab 2, beta 3, production 10). O máximo protege o banco de conexões, não só a fatura."
  type        = number
  default     = null
}

variable "schedules_paused" {
  description = "Agendas do Cloud Scheduler pausadas. Só liga quando for para publicar de verdade."
  type        = bool
  default     = true
}

variable "publish_paused" {
  description = "Agenda do publish-due pausada, à parte das outras: o staging a mantém ligada para os posts agendados saírem no horário."
  type        = bool
  default     = true
}

variable "site_url" {
  description = "Site da conta, destino dos links com UTM (env SITE_URL). Vazio = post sem link rastreado."
  type        = string
  default     = ""
}

variable "tenant_id" {
  description = "Conta da instalação (env TENANT_ID): os jobs de conta e o login de senha única exigem. O id da conta real vem de TF_VAR_tenant_id, fora do repositório."
  type        = string
  default     = ""
}

variable "alert_email" {
  description = "E-mail dos alertas. Passe por TF_VAR_alert_email: o repositório é público, não grave aqui."
  type        = string
  default     = ""
}

variable "uptime_check" {
  description = "Cria o uptime check de /api/health (produção)."
  type        = bool
  default     = false
}

variable "auth_provider" {
  description = "Login da plataforma (env AUTH_PROVIDER): `password` (senha única, exige TENANT_ID) ou `identity` (por pessoa, Identity Platform)."
  type        = string
  default     = "password"

  validation {
    condition     = contains(["password", "identity"], var.auth_provider)
    error_message = "auth_provider deve ser password ou identity."
  }
}

variable "signup_mode" {
  description = "Cadastro (env SIGNUP_MODE): `invite` (só por convite) ou `open` (qualquer pessoa cria conta). Criar conta e aceitar convite têm limite de taxa por IP e por e-mail (BEZ-29, migration 0035); abrir em produção é decisão de produto."
  type        = string
  default     = "invite"

  validation {
    condition     = contains(["invite", "open"], var.signup_mode)
    error_message = "signup_mode deve ser invite ou open."
  }
}

variable "mfa_mode" {
  description = "Segundo fator (env MFA_MODE): `required` (administrador entra, cria e exclui conta com app autenticador, SPEC 009) ou `optional` (não exigido em lugar nenhum; quem ativou continua com o desafio). Só vale com auth_provider = identity."
  type        = string
  default     = "required"

  validation {
    condition     = contains(["required", "optional"], var.mfa_mode)
    error_message = "mfa_mode deve ser required ou optional."
  }
}
