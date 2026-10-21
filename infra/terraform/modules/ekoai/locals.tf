data "google_project" "this" {
  project_id = var.project_id
}

locals {
  name = "ekoai"

  # Labels de todo recurso: `product`, `env` e `tier` alimentam o painel de custo por produto
  # (SPEC 013). `app` fica por compatibilidade com os filtros que já existiam.
  labels = { app = local.name, product = local.name, env = var.env, tier = var.tier }

  # Padrões por nível (tabela de níveis da SPEC 013). O que muda entre níveis é configuração.
  tier_profile = {
    lab        = { max_instances = 2, pitr = false }
    beta       = { max_instances = 3, pitr = true }
    production = { max_instances = 10, pitr = true }
  }[var.tier]

  # Conexões padrão do Cloud SQL por tamanho de máquina (documentação do Google, 20/10/2026).
  # Servem de base ao alerta de conexões; instância maior cai no valor de 100.
  sql_max_connections = lookup({ "db-f1-micro" = 25, "db-g1-small" = 50 }, var.sql_tier, 100)

  apis = [
    "apikeys.googleapis.com",
    "artifactregistry.googleapis.com",
    "cloudkms.googleapis.com",
    "cloudscheduler.googleapis.com",
    "compute.googleapis.com",
    "iamcredentials.googleapis.com",
    "identitytoolkit.googleapis.com",
    "logging.googleapis.com",
    "monitoring.googleapis.com",
    "run.googleapis.com",
    "secretmanager.googleapis.com",
    "servicenetworking.googleapis.com",
    "sqladmin.googleapis.com",
    "sts.googleapis.com",
  ]

  # Domínio de entrada do Identity Platform e host da plataforma (domínios autorizados do login).
  firebase_auth_domain = "${var.project_id}.firebaseapp.com"
  platform_host        = replace(local.platform_url, "https://", "")

  # URL determinística do Cloud Run: serve de MEDIA_BASE_URL sem referência circular.
  platform_url = "https://${local.name}-platform-${data.google_project.this.number}.${var.region}.run.app"

  # Jobs do src/jobs.js. `cron` em UTC; vazio = sem agenda (execução manual ou pelo deploy).
  # Os jobs de geração (post, resolve, reflect, funnel, engage, repurpose, reel) saíram com o
  # ADR 0010 e voltam na fase 2 do produto: quando voltarem, entram aqui.
  jobs = {
    "refresh-tokens" = { cron = "0 3 1 * *", cpu = "1", memory = "512Mi", timeout = "300s" }
    "token-health"   = { cron = "0 6 * * *", cpu = "1", memory = "512Mi", timeout = "120s" }
    "weekly-report"  = { cron = "0 23 * * 0", cpu = "1", memory = "512Mi", timeout = "600s" }
    migrate          = { cron = "", cpu = "1", memory = "512Mi", timeout = "600s" }
    "tenant-create"  = { cron = "", cpu = "1", memory = "512Mi", timeout = "120s" }
    "access-grant"   = { cron = "", cpu = "1", memory = "512Mi", timeout = "120s" }
    "platform-admin" = { cron = "", cpu = "1", memory = "512Mi", timeout = "120s" }
  }

  # Segredos que o Terraform gera. O resto (redes, Gemini) o dono preenche depois.
  generated_secrets = ["auth-secret", "cron-secret", "platform-password"]

  integration_secrets = [
    "gemini-api-key",
    "ig-access-token",
    "ig-business-account-id",
    "linkedin-access-token",
    "linkedin-refresh-token",
    "linkedin-author-urn",
    "linkedin-client-id",
    "linkedin-client-secret",
    "x-api-key",
    "x-api-secret",
    "x-access-token",
    "x-access-token-secret",
    "sentry-dsn",
    "posthog-key",
  ]

  # Variável de ambiente => segredo. Plataforma e jobs leem os mesmos.
  integration_env = {
    GEMINI_API_KEY         = "gemini-api-key"
    IG_ACCESS_TOKEN        = "ig-access-token"
    IG_BUSINESS_ACCOUNT_ID = "ig-business-account-id"
    LINKEDIN_ACCESS_TOKEN  = "linkedin-access-token"
    LINKEDIN_REFRESH_TOKEN = "linkedin-refresh-token"
    LINKEDIN_AUTHOR_URN    = "linkedin-author-urn"
    LINKEDIN_CLIENT_ID     = "linkedin-client-id"
    LINKEDIN_CLIENT_SECRET = "linkedin-client-secret"
    X_API_KEY              = "x-api-key"
    X_API_SECRET           = "x-api-secret"
    X_ACCESS_TOKEN         = "x-access-token"
    X_ACCESS_TOKEN_SECRET  = "x-access-token-secret"
    SENTRY_DSN             = "sentry-dsn"
    POSTHOG_KEY            = "posthog-key"
  }

  platform_secret_env = merge(local.integration_env, {
    DATABASE_URL      = "database-url"
    AUTH_SECRET       = "auth-secret"
    CRON_SECRET       = "cron-secret"
    PLATFORM_PASSWORD = "platform-password" # gitleaks:allow (nome do segredo, não o valor)
  })

  # Nome completo da chave de cifra dos tokens das redes (env KMS_KEY_NAME).
  kms_key_name = google_kms_crypto_key.social_tokens.id

  # Só entra o que tem valor: variável vazia faria o app falhar com uma mensagem pior que a ausência.
  account_env = { for k, v in { TENANT_ID = var.tenant_id, SITE_URL = var.site_url, SENTRY_ENVIRONMENT = var.env == "prod" ? "production" : var.env } : k => v if v != "" }

  jobs_secret_env = merge(local.integration_env, {
    DATABASE_URL = "database-url"
  })
}

resource "google_project_service" "api" {
  for_each           = toset(local.apis)
  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}
