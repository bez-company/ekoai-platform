variable "project_id" {
  description = "Projeto do Google Cloud do ambiente (saint-jardin-staging ou saint-jardin-prod)."
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

variable "region" {
  type    = string
  default = "southamerica-east1"
}

variable "github_repo" {
  description = "owner/repo que o deploy do GitHub Actions pode assumir (Workload Identity Federation)."
  type        = string
  default     = "bez-company/saint-jardin-chatbot"
}

variable "deploy_branch" {
  description = "Branch do GitHub cujo deploy pode assumir a conta de deploy. Staging e prod saem da main (prod por dispatch manual)."
  type        = string
  default     = "main"
}

variable "deploy_can_power_db" {
  description = "O deploy pode ligar o Cloud SQL parado (staging sob demanda). Só no staging."
  type        = bool
  default     = false
}

variable "deploy_workloads" {
  description = "Falso na primeira aplicação: cria a base (rede, banco, segredos, registry) antes de existir imagem. Verdadeiro cria o serviço, o job de migration e o Scheduler."
  type        = bool
  default     = false
}

variable "bot_image" {
  description = "Imagem inicial do bot (serviço e job de migration). Depois o deploy do CI troca; o Terraform ignora a mudança."
  type        = string
  default     = ""
}

variable "sql_tier" {
  type    = string
  default = "db-f1-micro"
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

variable "min_instances" {
  description = "Instâncias sempre quentes. Zero tem cold start; 1 evita (só se estourar o prazo da Meta, E3.9)."
  type        = number
  default     = 0
}

variable "max_instances" {
  description = "Máximo de instâncias. O limite protege o banco de conexões (cada instância abre até 3)."
  type        = number
  default     = 2
}

variable "schedules_paused" {
  description = "Cloud Scheduler pausado. Fica pausado até o cutover da produção (o webhook ainda aponta para a Vercel) e nos testes do staging."
  type        = bool
  default     = true
}

variable "modo_teste" {
  description = "MODO_TESTE: responde na hora, sem esperar o Scheduler. Só no staging."
  type        = bool
  default     = false
}

variable "delay_segundos" {
  type    = number
  default = 60
}

variable "jitter_segundos" {
  type    = number
  default = 0
}

variable "alert_email" {
  description = "E-mail dos alertas. Passe por TF_VAR_alert_email: o repositório é público."
  type        = string
  default     = ""
}

variable "uptime_check" {
  description = "Cria o uptime check de /api/health (produção)."
  type        = bool
  default     = false
}
