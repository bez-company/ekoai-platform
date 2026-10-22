resource "google_secret_manager_secret" "s" {
  for_each  = toset(concat(["database-url"], local.generated_secrets, local.integration_secrets))
  project   = var.project_id
  secret_id = each.value
  labels    = local.labels

  replication {
    user_managed {
      replicas {
        location = var.region
      }
    }
  }
  depends_on = [google_project_service.api]
}

# Gerados pelo Terraform e entregues só por segredo.
resource "random_password" "generated" {
  for_each = toset(local.generated_secrets)
  length   = 48
  special  = false
}

resource "google_secret_manager_secret_version" "generated" {
  for_each    = toset(local.generated_secrets)
  secret      = google_secret_manager_secret.s[each.value].id
  secret_data = random_password.generated[each.value].result
}

# Conexão com o banco pelo IP interno. TLS obrigatório no servidor; `no-verify` porque o
# certificado é de uma CA por instância e o tráfego não sai da VPC.
resource "google_secret_manager_secret_version" "database_url" {
  secret = google_secret_manager_secret.s["database-url"].id
  secret_data = join("", [
    "postgresql://", google_sql_user.app.name, ":", random_password.db.result,
    "@", google_sql_database_instance.main.private_ip_address, ":5432/", google_sql_database.app.name,
    "?sslmode=no-verify",
  ])
}

# Redes e Gemini: o Cloud Run exige uma versão para montar o segredo, então nasce vazio. O dono
# grava a versão real (`gcloud secrets versions add`); o Terraform não mexe mais no valor.
resource "google_secret_manager_secret_version" "integration_placeholder" {
  for_each    = toset(local.integration_secrets)
  secret      = google_secret_manager_secret.s[each.value].id
  secret_data = " "

  lifecycle {
    ignore_changes = [secret_data, enabled]
  }
}

resource "google_secret_manager_secret_iam_member" "app_reads" {
  for_each  = google_secret_manager_secret.s
  project   = var.project_id
  secret_id = each.value.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.app.email}"
}

# O job refresh-tokens grava o token renovado do LinkedIn como versão nova. O do Instagram saiu: cada
# conta conectada é renovada pela plataforma e o token fica cifrado no banco, não no Secret Manager.
resource "google_secret_manager_secret_iam_member" "app_writes_tokens" {
  for_each  = toset(["linkedin-access-token", "linkedin-refresh-token"])
  project   = var.project_id
  secret_id = google_secret_manager_secret.s[each.value].secret_id
  role      = "roles/secretmanager.secretVersionAdder"
  member    = "serviceAccount:${google_service_account.app.email}"
}
