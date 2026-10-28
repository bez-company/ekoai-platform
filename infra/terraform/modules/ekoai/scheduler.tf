# Cloud Scheduler no lugar dos workflows do GitHub Actions (SPEC 010). Nasce pausado: só liga
# quando for para publicar de verdade.

resource "google_cloud_scheduler_job" "job" {
  for_each         = { for k, v in local.jobs : k => v if var.deploy_workloads && v.cron != "" }
  project          = var.project_id
  region           = var.region
  name             = "${local.name}-${each.key}"
  description      = "Roda o job ${each.key}"
  schedule         = each.value.cron
  time_zone        = "Etc/UTC"
  paused           = var.legacy_jobs_paused
  attempt_deadline = "60s"


  http_target {
    http_method = "POST"
    uri         = "https://run.googleapis.com/v2/projects/${var.project_id}/locations/${var.region}/jobs/${google_cloud_run_v2_job.job[each.key].name}:run"
    headers     = { "Content-Type" = "application/json" }
    body        = base64encode("{}")

    oauth_token {
      service_account_email = google_service_account.scheduler.email
      scope                 = "https://www.googleapis.com/auth/cloud-platform"
    }
  }
}

# publish-due não é job: o Scheduler chama a plataforma com um token OIDC, que ela confere. Pausa por
# `publish_paused`, não por `schedules_paused`: o staging mantém os outros jobs pausados e este ligado.
resource "google_cloud_scheduler_job" "publish_due" {
  count            = var.deploy_workloads ? 1 : 0
  project          = var.project_id
  region           = var.region
  name             = "${local.name}-publish-due"
  description      = "Publica o que está agendado e venceu"
  schedule         = "*/10 * * * *"
  time_zone        = "Etc/UTC"
  paused           = var.publish_paused
  attempt_deadline = "120s"


  http_target {
    http_method = "POST"
    uri         = "${local.platform_url}/api/cron/publish-due"

    oidc_token {
      service_account_email = google_service_account.scheduler.email
      audience              = local.platform_url
    }
  }
}

# generate: o worker da geração de posts (ADR 0018). O pedido acorda o worker na hora; o Scheduler
# é a reserva para o que ficou na fila (worker que caiu, chamada que falhou).
resource "google_cloud_scheduler_job" "generate" {
  count            = var.deploy_workloads ? 1 : 0
  project          = var.project_id
  region           = var.region
  name             = "${local.name}-generate"
  description      = "Processa a fila de pedidos de post"
  schedule         = "*/2 * * * *"
  time_zone        = "Etc/UTC"
  paused           = var.schedules_paused
  attempt_deadline = "300s"

  http_target {
    http_method = "POST"
    uri         = "${local.platform_url}/api/cron/generate"

    oidc_token {
      service_account_email = google_service_account.scheduler.email
      audience              = local.platform_url
    }
  }
}

# refresh-instagram: renova o token de cada conta de Instagram antes de vencer (SPEC 011 R5.3). Todo dia
# às 09:00 UTC (06:00 em Brasília); a rota só age sobre as contas que vencem em até 15 dias.
resource "google_cloud_scheduler_job" "refresh_instagram" {
  count            = var.deploy_workloads ? 1 : 0
  project          = var.project_id
  region           = var.region
  name             = "${local.name}-refresh-instagram"
  description      = "Renova os tokens de Instagram que vencem em breve"
  schedule         = "0 9 * * *"
  time_zone        = "Etc/UTC"
  paused           = var.schedules_paused
  attempt_deadline = "180s"

  http_target {
    http_method = "POST"
    uri         = "${local.platform_url}/api/cron/refresh-instagram"

    oidc_token {
      service_account_email = google_service_account.scheduler.email
      audience              = local.platform_url
    }
  }
}

# collect-metrics: lê curtidas e comentários (e os insights, quando a conta concedeu a permissão) dos posts
# publicados no Instagram nos últimos 30 dias (BEZ-183). A cada 6 horas; a rota decide quais posts já
# estão na hora (a cada 5 h nos 2 primeiros dias, depois uma vez por dia).
resource "google_cloud_scheduler_job" "collect_metrics" {
  count            = var.deploy_workloads ? 1 : 0
  project          = var.project_id
  region           = var.region
  name             = "${local.name}-collect-metrics"
  description      = "Coleta as métricas do Instagram dos posts publicados"
  schedule         = "15 */6 * * *"
  time_zone        = "Etc/UTC"
  paused           = var.schedules_paused
  attempt_deadline = "320s"

  http_target {
    http_method = "POST"
    uri         = "${local.platform_url}/api/cron/collect-metrics"

    oidc_token {
      service_account_email = google_service_account.scheduler.email
      audience              = local.platform_url
    }
  }
}

# plan-content: o coordenador de conteúdo propõe um post por horário livre dos próximos 7 dias (SPEC 017
# decisão 8, BEZ-239). Todo dia às 10:00 UTC (07:00 em Brasília), antes de a pessoa abrir o Início; na
# segunda, avisa a equipe das sugestões da semana. Nada é gerado sem a pessoa pedir.
resource "google_cloud_scheduler_job" "plan_content" {
  count            = var.deploy_workloads ? 1 : 0
  project          = var.project_id
  region           = var.region
  name             = "${local.name}-plan-content"
  description      = "Sugere os posts da semana por conta"
  schedule         = "0 10 * * *"
  time_zone        = "Etc/UTC"
  paused           = var.schedules_paused
  attempt_deadline = "320s"

  http_target {
    http_method = "POST"
    uri         = "${local.platform_url}/api/cron/plan-content"

    oidc_token {
      service_account_email = google_service_account.scheduler.email
      audience              = local.platform_url
    }
  }
}

resource "google_cloud_run_v2_job_iam_member" "scheduler_runs" {
  for_each = { for k, v in local.jobs : k => v if var.deploy_workloads && v.cron != "" }
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_job.job[each.key].name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.scheduler.email}"
}

# sleep-if-idle: desliga o banco do staging sem uso (SPEC 016). Não pausa com `schedules_paused`: o staging
# mantém os outros jobs pausados e este precisa rodar sempre, senão o banco fica ligado para sempre.
resource "google_cloud_scheduler_job" "sleep_if_idle" {
  count            = var.deploy_workloads && var.wake_enabled ? 1 : 0
  project          = var.project_id
  region           = var.region
  name             = "${local.name}-sleep-if-idle"
  description      = "Desliga o banco do staging depois de ${var.wake_idle_minutes} minutos sem uso"
  schedule         = "*/15 * * * *"
  time_zone        = "Etc/UTC"
  attempt_deadline = "60s"

  http_target {
    http_method = "POST"
    uri         = "${local.platform_url}/api/cron/sleep-if-idle"

    oidc_token {
      service_account_email = google_service_account.scheduler.email
      audience              = local.platform_url
    }
  }
}
