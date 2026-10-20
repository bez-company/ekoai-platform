# Plataforma (serviço) e jobs. Só existem com deploy_workloads = true, depois de haver imagem.

locals {
  vpc = {
    network    = google_compute_network.main.id
    subnetwork = google_compute_subnetwork.run.id
  }
}

resource "google_cloud_run_v2_service" "platform" {
  count               = var.deploy_workloads ? 1 : 0
  project             = var.project_id
  name                = "${local.name}-platform"
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = var.protect_data
  labels              = { app = local.name, env = var.env }

  # A organização barra `allUsers` no IAM (compartilhamento restrito a domínio). O app já exige
  # sessão em toda rota privada, então a checagem de IAM do Cloud Run fica desligada.
  invoker_iam_disabled = true

  template {
    service_account                  = google_service_account.app.email
    max_instance_request_concurrency = 40
    timeout                          = "60s"

    scaling {
      min_instance_count = var.platform_min_instances
      max_instance_count = var.platform_max_instances
    }

    vpc_access {
      egress = "PRIVATE_RANGES_ONLY"
      network_interfaces {
        network    = local.vpc.network
        subnetwork = local.vpc.subnetwork
      }
    }

    containers {
      image = var.platform_image

      ports {
        container_port = 8080
      }

      resources {
        limits            = { cpu = "1", memory = "512Mi" }
        cpu_idle          = true
        startup_cpu_boost = true
      }

      startup_probe {
        http_get {
          path = "/api/health"
        }
        initial_delay_seconds = 3
        period_seconds        = 5
        timeout_seconds       = 4
        failure_threshold     = 12
      }

      liveness_probe {
        http_get {
          path = "/api/health"
        }
        period_seconds  = 30
        timeout_seconds = 5
      }

      env {
        name  = "STORAGE_BUCKET"
        value = google_storage_bucket.media.name
      }
      env {
        name  = "MEDIA_BASE_URL"
        value = "${local.platform_url}/api/media"
      }
      env {
        name  = "AUTH_PROVIDER"
        value = var.auth_provider
      }
      env {
        name  = "SIGNUP_MODE"
        value = var.signup_mode
      }
      env {
        name  = "IDENTITY_PROJECT_ID"
        value = var.project_id
      }
      # Config web do Firebase, lida em runtime pelo servidor e entregue ao cliente (variável
      # NEXT_PUBLIC_ seria fixada no build da imagem).
      env {
        name  = "FIREBASE_WEB_API_KEY"
        value = google_apikeys_key.web.key_string
      }
      env {
        name  = "FIREBASE_AUTH_DOMAIN"
        value = local.firebase_auth_domain
      }
      env {
        name  = "PUBLISH_TZ_OFFSET"
        value = "-3"
      }
      dynamic "env" {
        for_each = local.account_env
        content {
          name  = env.key
          value = env.value
        }
      }
      env {
        name  = "KMS_KEY_NAME"
        value = local.kms_key_name
      }
      # Endereço público: base dos links de convite (/convite/<token>). No Cloud Run, os
      # cabeçalhos do proxy podem trazer o endereço interno. Troca para o domínio próprio quando houver.
      env {
        name  = "APP_BASE_URL"
        value = local.platform_url
      }
      env {
        name  = "CRON_OIDC_AUDIENCE"
        value = local.platform_url
      }
      env {
        name  = "CRON_OIDC_EMAIL"
        value = google_service_account.scheduler.email
      }

      dynamic "env" {
        for_each = local.platform_secret_env
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.s[env.value].secret_id
              version = "latest"
            }
          }
        }
      }
    }
  }

  lifecycle {
    # O deploy do CI troca a imagem a cada merge; o Terraform não a desfaz.
    ignore_changes = [template[0].containers[0].image, client, client_version]
  }

  depends_on = [
    google_secret_manager_secret_version.generated,
    google_secret_manager_secret_version.database_url,
    google_secret_manager_secret_version.integration_placeholder,
    google_secret_manager_secret_iam_member.app_reads,
    google_storage_bucket_iam_member.app_media,
  ]
}

resource "google_cloud_run_v2_job" "job" {
  for_each            = var.deploy_workloads ? local.jobs : {}
  project             = var.project_id
  name                = "${local.name}-${each.key}"
  location            = var.region
  deletion_protection = var.protect_data
  labels              = { app = local.name, env = var.env }

  template {
    parallelism = 1
    task_count  = 1

    template {
      service_account = google_service_account.app.email
      timeout         = each.value.timeout
      # Publicar não é idempotente: falha não repete sozinha.
      max_retries = 0

      vpc_access {
        egress = "PRIVATE_RANGES_ONLY"
        network_interfaces {
          network    = local.vpc.network
          subnetwork = local.vpc.subnetwork
        }
      }

      containers {
        image = var.jobs_image
        args  = [each.key]

        resources {
          limits = { cpu = each.value.cpu, memory = each.value.memory }
        }

        env {
          name  = "STATE_BACKEND"
          value = "postgres"
        }
        env {
          name  = "STORAGE_BUCKET"
          value = google_storage_bucket.media.name
        }
        env {
          name  = "MEDIA_BASE_URL"
          value = "${local.platform_url}/api/media"
        }
        dynamic "env" {
          for_each = local.account_env
          content {
            name  = env.key
            value = env.value
          }
        }
        env {
          name  = "GOOGLE_CLOUD_PROJECT"
          value = var.project_id
        }
        env {
          name  = "KMS_KEY_NAME"
          value = local.kms_key_name
        }

        dynamic "env" {
          for_each = local.jobs_secret_env
          content {
            name = env.key
            value_source {
              secret_key_ref {
                secret  = google_secret_manager_secret.s[env.value].secret_id
                version = "latest"
              }
            }
          }
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [template[0].template[0].containers[0].image, client, client_version]
  }

  depends_on = [
    google_secret_manager_secret_version.database_url,
    google_secret_manager_secret_version.integration_placeholder,
    google_secret_manager_secret_iam_member.app_reads,
  ]
}
