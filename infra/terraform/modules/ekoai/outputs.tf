output "platform_url" {
  value = local.platform_url
}

output "registry" {
  description = "Prefixo das imagens no Artifact Registry."
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.images.repository_id}"
}

output "media_bucket" {
  value = google_storage_bucket.media.name
}

output "sql_instance" {
  value = google_sql_database_instance.main.name
}

output "app_service_account" {
  value = google_service_account.app.email
}

output "scheduler_service_account" {
  value = google_service_account.scheduler.email
}

output "deploy_service_account" {
  value = google_service_account.deploy.email
}

output "workload_identity_provider" {
  description = "Valor de `workload_identity_provider` no google-github-actions/auth."
  value       = google_iam_workload_identity_pool_provider.github.name
}

output "secrets_to_fill" {
  description = "Segredos que o dono preenche com `gcloud secrets versions add`."
  value       = local.integration_secrets
}
