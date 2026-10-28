# Uma conta de serviço por função, cada uma com o mínimo.

resource "google_service_account" "app" {
  project      = var.project_id
  account_id   = "${local.name}-app"
  display_name = "Plataforma e jobs"
  depends_on   = [google_project_service.api]
}

resource "google_service_account" "scheduler" {
  project      = var.project_id
  account_id   = "${local.name}-scheduler"
  display_name = "Cloud Scheduler"
  depends_on   = [google_project_service.api]
}

resource "google_service_account" "deploy" {
  project      = var.project_id
  account_id   = "${local.name}-deploy"
  display_name = "Deploy pelo GitHub Actions"
  depends_on   = [google_project_service.api]
}

resource "google_project_iam_member" "app_logging" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.app.email}"
}

resource "google_project_iam_member" "app_metrics" {
  project = var.project_id
  role    = "roles/monitoring.metricWriter"
  member  = "serviceAccount:${google_service_account.app.email}"
}

# O servidor confere o ID token do Identity Platform com checagem de revogação (SPEC 009), e isso
# consulta o usuário no Identity Toolkit pela conta do app. Só leitura: a sessão e o "sair de todos
# os dispositivos" são nossos, não revogam nada no Firebase. Sem este papel todo login volta 401.
# A geração de posts chama o Vertex AI (texto e imagem) com a credencial do serviço (SPEC 012,
# decisão 6): nada de chave no repositório nem no navegador. Só o papel de usuário do Vertex.
resource "google_project_iam_member" "app_vertex_user" {
  project = var.project_id
  role    = "roles/aiplatform.user"
  member  = "serviceAccount:${google_service_account.app.email}"
}

resource "google_project_iam_member" "app_auth_viewer" {
  project = var.project_id
  role    = "roles/firebaseauth.viewer"
  member  = "serviceAccount:${google_service_account.app.email}"
}

# E-mail pelo Gmail API (BEZ-28, ADR 0027): a conta do app assina, pelo IAM Credentials, o JWT da delegação de domínio.
# O papel vale só sobre ela mesma (nada de chave em arquivo). Depois do apply, autorize o client ID de
# `app_service_account_client_id` no Admin Console (Segurança > Controles de API > Delegação em todo o domínio)
# com o escopo https://www.googleapis.com/auth/gmail.send.
resource "google_service_account_iam_member" "app_signs_own_jwt" {
  count              = var.mail_provider == "gmail" ? 1 : 0
  service_account_id = google_service_account.app.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${google_service_account.app.email}"
}

# Deploy: troca revisão do serviço e dos jobs, empurra imagem e roda o job de migration.
resource "google_project_iam_member" "deploy_run" {
  project = var.project_id
  role    = "roles/run.developer"
  member  = "serviceAccount:${google_service_account.deploy.email}"
}

resource "google_project_iam_member" "deploy_registry" {
  project = var.project_id
  role    = "roles/artifactregistry.writer"
  member  = "serviceAccount:${google_service_account.deploy.email}"
}

# Leitura do Cloud SQL em todo ambiente: o deploy confere o estado do banco antes de migrar (e a
# produção para se ele não estiver de pé). Só leitura; ligar o banco parado é o papel abaixo, só do staging.
resource "google_project_iam_member" "deploy_sql_viewer" {
  project = var.project_id
  role    = "roles/cloudsql.viewer"
  member  = "serviceAccount:${google_service_account.deploy.email}"
}

# Staging sob demanda: o deploy liga o banco parado antes de migrar, e a plataforma o liga pela tela
# "Ligar o ambiente" e o desliga sem uso (SPEC 016). O papel só lê e atualiza a instância, e só
# existe onde `deploy_can_power_db` ou `wake_enabled` está ligado.
resource "google_project_iam_custom_role" "sql_power" {
  count       = var.deploy_can_power_db || var.wake_enabled ? 1 : 0
  project     = var.project_id
  role_id     = "ekoaiSqlPower"
  title       = "Ligar o Cloud SQL parado"
  description = "Ler, listar as operações e atualizar a instância do Cloud SQL (ligar e desligar o banco do staging)."
  permissions = ["cloudsql.instances.get", "cloudsql.instances.list", "cloudsql.instances.update"]
}

resource "google_project_iam_member" "deploy_sql_power" {
  count   = var.deploy_can_power_db ? 1 : 0
  project = var.project_id
  role    = google_project_iam_custom_role.sql_power[0].id
  member  = "serviceAccount:${google_service_account.deploy.email}"
}

# A plataforma liga e desliga o banco do staging, e lê a métrica de uso para decidir (SPEC 016).
resource "google_project_iam_member" "app_sql_power" {
  count   = var.wake_enabled ? 1 : 0
  project = var.project_id
  role    = google_project_iam_custom_role.sql_power[0].id
  member  = "serviceAccount:${google_service_account.app.email}"
}

resource "google_project_iam_member" "app_monitoring_viewer" {
  count   = var.wake_enabled ? 1 : 0
  project = var.project_id
  role    = "roles/monitoring.viewer"
  member  = "serviceAccount:${google_service_account.app.email}"
}

resource "google_service_account_iam_member" "deploy_acts_as_app" {
  service_account_id = google_service_account.app.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.deploy.email}"
}

# Workload Identity Federation: o GitHub Actions entra sem chave JSON, só pelo repositório e pela
# branch do ambiente (SPEC 010, D5; ADR 0013): staging aceita a branch staging, prod a main.
resource "google_iam_workload_identity_pool" "github" {
  project                   = var.project_id
  workload_identity_pool_id = "github"
  display_name              = "GitHub Actions"
  depends_on                = [google_project_service.api]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  project                            = var.project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github"
  display_name                       = "GitHub"

  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.repository" = "assertion.repository"
    "attribute.ref"        = "assertion.ref"
  }
  attribute_condition = "assertion.repository == '${var.github_repo}' && assertion.ref == 'refs/heads/${var.deploy_branch}'"

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

resource "google_service_account_iam_member" "deploy_from_github" {
  service_account_id = google_service_account.deploy.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${var.github_repo}"
}
