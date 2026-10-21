# Bot (serviço) e job de migration. Só existem com deploy_workloads = true, depois de haver imagem.

locals {
  vpc = {
    network    = google_compute_network.main.id
    subnetwork = google_compute_subnetwork.run.id
  }
}

resource "google_cloud_run_v2_service" "bot" {
  count               = var.deploy_workloads ? 1 : 0
  project             = var.project_id
  name                = "${local.name}-bot"
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = var.protect_data
  labels              = local.labels

  # O webhook da Meta chega sem credencial do Google e a organização barra `allUsers` no IAM. A rota
  # do webhook confere a assinatura da Meta (x-hub-signature-256) e /api/process confere o token OIDC
  # do Scheduler, então a checagem de IAM do Cloud Run fica desligada.
  invoker_iam_disabled = true

  template {
    service_account                  = google_service_account.app.email
    max_instance_request_concurrency = 20
    timeout                          = "90s"

    scaling {
      min_instance_count = var.min_instances
      max_instance_count = var.max_instances
    }

    vpc_access {
      egress = "PRIVATE_RANGES_ONLY"
      network_interfaces {
        network    = local.vpc.network
        subnetwork = local.vpc.subnetwork
      }
    }

    containers {
      image = var.bot_image

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
        name  = "PROPOSTAS_BUCKET"
        value = google_storage_bucket.propostas.name
      }
      env {
        name  = "DB_POOL_MAX"
        value = "3"
      }
      env {
        name  = "DELAY_SEGUNDOS"
        value = tostring(var.delay_segundos)
      }
      env {
        name  = "JITTER_SEGUNDOS"
        value = tostring(var.jitter_segundos)
      }
      dynamic "env" {
        for_each = var.modo_teste ? [1] : []
        content {
          name  = "MODO_TESTE"
          value = "true"
        }
      }
      env {
        name  = "CRON_OIDC_AUDIENCE"
        value = local.bot_url
      }
      env {
        name  = "CRON_OIDC_EMAIL"
        value = google_service_account.scheduler.email
      }

      dynamic "env" {
        for_each = local.bot_secret_env
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
    google_secret_manager_secret_version.database_url,
    google_secret_manager_secret_version.integration_placeholder,
    google_secret_manager_secret_iam_member.app_reads,
    google_storage_bucket_iam_member.app_reads_propostas,
  ]
}

resource "google_cloud_run_v2_job" "migrate" {
  count               = var.deploy_workloads ? 1 : 0
  project             = var.project_id
  name                = "${local.name}-migrate"
  location            = var.region
  deletion_protection = var.protect_data
  labels              = local.labels

  template {
    parallelism = 1
    task_count  = 1

    template {
      service_account = google_service_account.app.email
      timeout         = "600s"
      max_retries     = 0

      vpc_access {
        egress = "PRIVATE_RANGES_ONLY"
        network_interfaces {
          network    = local.vpc.network
          subnetwork = local.vpc.subnetwork
        }
      }

      containers {
        image   = var.bot_image
        command = ["node"]
        args    = ["scripts/migrate.mjs"]

        resources {
          limits = { cpu = "1", memory = "512Mi" }
        }

        env {
          name = "DATABASE_URL"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.s["database-url"].secret_id
              version = "latest"
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
    google_secret_manager_secret_iam_member.app_reads,
  ]
}
