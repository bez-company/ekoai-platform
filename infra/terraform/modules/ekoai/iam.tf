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
resource "google_project_iam_member" "app_auth_viewer" {
  project = var.project_id
  role    = "roles/firebaseauth.viewer"
  member  = "serviceAccount:${google_service_account.app.email}"
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

# Staging sob demanda: o deploy liga o banco parado antes de migrar. O papel só lê e atualiza a
# instância, e só existe onde `deploy_can_power_db` está ligado.
resource "google_project_iam_custom_role" "sql_power" {
  count       = var.deploy_can_power_db ? 1 : 0
  project     = var.project_id
  role_id     = "ekoaiSqlPower"
  title       = "Ligar o Cloud SQL parado"
  description = "Ler e atualizar a instância do Cloud SQL (ativar o banco do staging no deploy)."
  permissions = ["cloudsql.instances.get", "cloudsql.instances.update"]
}

resource "google_project_iam_member" "deploy_sql_power" {
  count   = var.deploy_can_power_db ? 1 : 0
  project = var.project_id
  role    = google_project_iam_custom_role.sql_power[0].id
  member  = "serviceAccount:${google_service_account.deploy.email}"
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
