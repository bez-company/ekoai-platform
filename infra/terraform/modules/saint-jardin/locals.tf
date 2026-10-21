data "google_project" "this" {
  project_id = var.project_id
}

locals {
  name = "saint-jardin"

  # Labels de todo recurso: alimentam o painel de custo por produto (SPEC 013).
  labels = { app = local.name, product = local.name, env = var.env, tier = var.tier }

  pitr = var.tier != "lab"

  # Conexões padrão do Cloud SQL por tamanho de máquina (documentação do Google, 20/10/2026).
  sql_max_connections = lookup({ "db-f1-micro" = 25, "db-g1-small" = 50 }, var.sql_tier, 100)

  apis = [
    "artifactregistry.googleapis.com",
    "cloudscheduler.googleapis.com",
    "compute.googleapis.com",
    "iamcredentials.googleapis.com",
    "logging.googleapis.com",
    "monitoring.googleapis.com",
    "run.googleapis.com",
    "secretmanager.googleapis.com",
    "servicenetworking.googleapis.com",
    "sqladmin.googleapis.com",
    "storage.googleapis.com",
    "sts.googleapis.com",
  ]

  # URL determinística do Cloud Run: serve de público do token OIDC sem referência circular.
  bot_url = "https://${local.name}-bot-${data.google_project.this.number}.${var.region}.run.app"

  # Segredos que o dono preenche com `gcloud secrets versions add`. NUMEROS_TESTE só tem valor no staging.
  integration_secrets = [
    "gemini-api-key",
    "whatsapp-token",
    "whatsapp-phone-number-id",
    "whatsapp-verify-token",
    "whatsapp-app-secret",
    "telegram-bot-token",
    "telegram-chat-id",
    "numeros-teste",
  ]

  integration_env = {
    GEMINI_API_KEY           = "gemini-api-key"
    WHATSAPP_TOKEN           = "whatsapp-token"
    WHATSAPP_PHONE_NUMBER_ID = "whatsapp-phone-number-id"
    WHATSAPP_VERIFY_TOKEN    = "whatsapp-verify-token"
    WHATSAPP_APP_SECRET      = "whatsapp-app-secret"
    TELEGRAM_BOT_TOKEN       = "telegram-bot-token"
    TELEGRAM_CHAT_ID         = "telegram-chat-id"
    NUMEROS_TESTE            = "numeros-teste"
  }

  bot_secret_env = merge(local.integration_env, { DATABASE_URL = "database-url" })
}

resource "google_project_service" "api" {
  for_each           = toset(local.apis)
  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}
