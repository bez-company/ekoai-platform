# Cloud Scheduler no lugar de pg_cron e pg_net (SPEC 014, D2): chama /api/process a cada minuto com
# token OIDC, que a rota confere (assinatura do Google, público e e-mail desta conta). Nasce pausado:
# só liga no cutover (staging: só durante os testes).

resource "google_cloud_scheduler_job" "process" {
  count            = var.deploy_workloads ? 1 : 0
  project          = var.project_id
  region           = var.region
  name             = "${local.name}-process"
  description      = "Processa a fila de mensagens vencidas e as varreduras de follow-up"
  schedule         = "* * * * *"
  time_zone        = "Etc/UTC"
  paused           = var.schedules_paused
  attempt_deadline = "90s"

  # Sem retentativa: o próximo minuto já refaz a varredura, e repetir em cima de um turno em andamento
  # só disputa a trava.
  retry_config {
    retry_count = 0
  }

  http_target {
    http_method = "POST"
    uri         = "${local.bot_url}/api/process"

    oidc_token {
      service_account_email = google_service_account.scheduler.email
      audience              = local.bot_url
    }
  }
}
