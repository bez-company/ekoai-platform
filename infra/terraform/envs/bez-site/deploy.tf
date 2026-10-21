# Deploy do site pelo GitHub Actions (BEZ-106): cada push na main do bez-company/bez-website publica.
# Mesmo desenho da Ekoai (modules/ekoai/iam.tf): Workload Identity Federation, sem chave JSON, e uma
# conta de deploy com o mínimo. O workflow troca só a imagem do serviço (o Terraform ignora a imagem,
# ver main.tf) e publica uma release do Hosting, que purga o cache do CDN.
#
# Valores para o repositório do site (Settings > Environments > prod > Variables):
#   GCP_PROJECT  = bez-site-prod
#   WIF_PROVIDER = terraform output -raw wif_provider
#   DEPLOY_SA    = terraform output -raw deploy_sa

variable "github_repo" {
  description = "Repositório que pode publicar o site."
  type        = string
  default     = "bez-company/bez-website"
}

variable "deploy_branch" {
  description = "Única branch aceita pelo Workload Identity."
  type        = string
  default     = "main"
}

# APIs do Workload Identity (troca do token do GitHub por um token do Google).
resource "google_project_service" "deploy_api" {
  for_each = toset([
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "sts.googleapis.com",
  ])
  service            = each.key
  disable_on_destroy = false
}

resource "google_service_account" "deploy" {
  account_id   = "bez-site-deploy"
  display_name = "Deploy do site pelo GitHub Actions"
}

# Troca a revisão do serviço (gcloud run services update --image).
resource "google_project_iam_member" "deploy_run" {
  project = local.project
  role    = "roles/run.developer"
  member  = "serviceAccount:${google_service_account.deploy.email}"
}

# Empurra a imagem só no repositório do site.
resource "google_artifact_registry_repository_iam_member" "deploy_registry" {
  location   = google_artifact_registry_repository.bez.location
  repository = google_artifact_registry_repository.bez.name
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${google_service_account.deploy.email}"
}

# A nova revisão roda com a conta do site; o deploy precisa poder "agir como" ela.
resource "google_service_account_iam_member" "deploy_acts_as_site" {
  service_account_id = google_service_account.site.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.deploy.email}"
}

# Cria a versão e a release do Hosting (scripts/hosting-release.sh) e cobra a chamada no projeto
# (cabeçalho X-Goog-User-Project).
resource "google_project_iam_member" "deploy_hosting" {
  project = local.project
  role    = "roles/firebasehosting.admin"
  member  = "serviceAccount:${google_service_account.deploy.email}"
}

resource "google_project_iam_member" "deploy_usage" {
  project = local.project
  role    = "roles/serviceusage.serviceUsageConsumer"
  member  = "serviceAccount:${google_service_account.deploy.email}"
}

resource "google_iam_workload_identity_pool" "github" {
  workload_identity_pool_id = "github"
  display_name              = "GitHub Actions"
  depends_on                = [google_project_service.deploy_api]
}

# Só o repositório do site, só a branch main.
resource "google_iam_workload_identity_pool_provider" "github" {
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

output "wif_provider" {
  description = "Valor de `workload_identity_provider` no google-github-actions/auth."
  value       = google_iam_workload_identity_pool_provider.github.name
}

output "deploy_sa" {
  value = google_service_account.deploy.email
}
