# Arquivos das propostas (3 PDFs e o vídeo de apresentação). O bot só lê, e entrega URL assinada de
# 10 minutos ao WhatsApp.
resource "google_storage_bucket" "propostas" {
  project                     = var.project_id
  name                        = "${var.project_id}-propostas"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = !var.protect_data
  labels                      = local.labels

  versioning {
    enabled = true
  }
  depends_on = [google_project_service.api]
}

resource "google_storage_bucket_iam_member" "app_reads_propostas" {
  bucket = google_storage_bucket.propostas.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.app.email}"
}

resource "google_artifact_registry_repository" "images" {
  project       = var.project_id
  location      = var.region
  repository_id = local.name
  format        = "DOCKER"
  description   = "Imagem do bot"
  labels        = local.labels

  cleanup_policies {
    id     = "delete-untagged"
    action = "DELETE"
    condition {
      tag_state  = "UNTAGGED"
      older_than = "604800s"
    }
  }
  cleanup_policies {
    id     = "keep-recent"
    action = "KEEP"
    most_recent_versions {
      keep_count = 20
    }
  }
  depends_on = [google_project_service.api]
}
