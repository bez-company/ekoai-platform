resource "google_monitoring_notification_channel" "email" {
  count        = var.alert_email == "" ? 0 : 1
  project      = var.project_id
  display_name = "E-mail da equipe (${var.env})"
  type         = "email"
  labels       = { email_address = var.alert_email }
  depends_on   = [google_project_service.api]
}

locals {
  channels = [for c in google_monitoring_notification_channel.email : c.id]
}

resource "google_monitoring_alert_policy" "platform_5xx" {
  count                 = var.deploy_workloads ? 1 : 0
  project               = var.project_id
  display_name          = "Plataforma com erro 5xx (${var.env})"
  combiner              = "OR"
  notification_channels = local.channels

  conditions {
    display_name = "Mais de 5 respostas 5xx em 5 minutos"
    condition_threshold {
      filter          = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${local.name}-platform\" AND metric.type=\"run.googleapis.com/request_count\" AND metric.labels.response_code_class=\"5xx\""
      comparison      = "COMPARISON_GT"
      threshold_value = 5
      duration        = "0s"
      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_SUM"
        cross_series_reducer = "REDUCE_SUM"
      }
    }
  }
  depends_on = [google_cloud_run_v2_service.platform]
}

resource "google_monitoring_alert_policy" "job_failed" {
  project               = var.project_id
  display_name          = "Job do Cloud Run falhou (${var.env})"
  combiner              = "OR"
  notification_channels = local.channels

  conditions {
    display_name = "Execução com falha"
    condition_threshold {
      filter          = "resource.type=\"cloud_run_job\" AND metric.type=\"run.googleapis.com/job/completed_execution_count\" AND metric.labels.result=\"failed\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "0s"
      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_SUM"
        cross_series_reducer = "REDUCE_SUM"
        group_by_fields      = ["resource.labels.job_name"]
      }
    }
  }
  depends_on = [google_project_service.api]
}

# Cron HTTP que falhou (BEZ-127): os jobs do Cloud Run já têm o alerta acima; os crons que o Scheduler
# chama na plataforma (generate, publish-due, plan-content e os demais) falham sem criar execução de job.
# O Scheduler registra `AttemptFinished` com severidade ERROR quando a tentativa volta com erro.
resource "google_monitoring_alert_policy" "scheduler_failed" {
  count                 = var.deploy_workloads ? 1 : 0
  project               = var.project_id
  display_name          = "Cron do Scheduler falhou (${var.env})"
  combiner              = "OR"
  notification_channels = local.channels

  conditions {
    display_name = "Tentativa do Scheduler com erro"
    condition_matched_log {
      filter = "resource.type=\"cloud_scheduler_job\" AND resource.labels.job_id=~\"^${local.name}-\" AND severity>=ERROR AND jsonPayload.\"@type\"=\"type.googleapis.com/google.cloud.scheduler.logging.AttemptFinished\""
    }
  }

  alert_strategy {
    notification_rate_limit {
      period = "3600s"
    }
  }

  documentation {
    content   = "Um cron do Cloud Scheduler voltou com erro. Veja o job em Cloud Scheduler e os logs da plataforma na mesma hora (docs/runbook.md, Observabilidade)."
    mime_type = "text/markdown"
  }
  depends_on = [google_project_service.api]
}

# Conexão do Instagram de um cliente que falhou (BEZ-528). O callback registra ERROR quando algo quebra do nosso
# lado e a Meta recusar um passo (`instagram/oauth`) vira WARNING com `step`, `code` e `reason`. O cron de renovação
# (`step=refresh`) fica de fora: ele tem o próprio aviso por conta. Código 100 no passo `exchange` é conta sem papel
# no app enquanto a revisão da Meta (BEZ-332) não aprova o acesso avançado.
resource "google_monitoring_alert_policy" "instagram_connect_failed" {
  count                 = var.deploy_workloads ? 1 : 0
  project               = var.project_id
  display_name          = "Conexão do Instagram falhou (${var.env})"
  combiner              = "OR"
  notification_channels = local.channels

  conditions {
    display_name = "Callback do Instagram com erro ou recusa da Meta"
    condition_matched_log {
      filter = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${local.name}-platform\" AND ((jsonPayload.scope=\"api/instagram/callback\" AND severity>=ERROR) OR (jsonPayload.scope=\"instagram/oauth\" AND jsonPayload.message=\"a Meta recusou o passo\" AND jsonPayload.step!=\"refresh\"))"
      label_extractors = {
        step   = "EXTRACT(jsonPayload.step)"
        code   = "EXTRACT(jsonPayload.code)"
        reason = "EXTRACT(jsonPayload.reason)"
      }
    }
  }

  alert_strategy {
    notification_rate_limit {
      period = "300s"
    }
  }

  documentation {
    content   = "Um cliente tentou conectar o Instagram e não conseguiu. Passo: $${log.extracted_label.step}, código da Meta: $${log.extracted_label.code}, motivo: $${log.extracted_label.reason}.\n\nCódigo 100 no passo `exchange` quer dizer que a conta não tem papel no app da Meta e o acesso avançado ainda não foi aprovado (BEZ-332): convide a conta como testador do Instagram ou espere a revisão. Outro caso: veja os logs da plataforma na mesma hora (escopos `api/instagram/callback` e `instagram/oauth`, docs/runbook.md, Observabilidade)."
    mime_type = "text/markdown"
  }
  depends_on = [google_project_service.api]
}

resource "google_monitoring_alert_policy" "sql_disk" {
  project               = var.project_id
  display_name          = "Disco do Cloud SQL acima de 80% (${var.env})"
  combiner              = "OR"
  notification_channels = local.channels

  conditions {
    display_name = "Uso de disco"
    condition_threshold {
      filter          = "resource.type=\"cloudsql_database\" AND metric.type=\"cloudsql.googleapis.com/database/disk/utilization\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0.8
      duration        = "300s"
      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_MEAN"
      }
    }
  }
  depends_on = [google_project_service.api]
}

# Conexões perto do limite da máquina (o f1-micro aceita 25 por padrão). Cada instância da
# plataforma abre até DB_POOL_MAX conexões (5), e os jobs somam: a conta está no runbook.
resource "google_monitoring_alert_policy" "sql_connections" {
  project               = var.project_id
  display_name          = "Conexões do Cloud SQL acima de 80% do limite (${var.env})"
  combiner              = "OR"
  notification_channels = local.channels

  conditions {
    display_name = "Conexões abertas"
    condition_threshold {
      filter          = "resource.type=\"cloudsql_database\" AND metric.type=\"cloudsql.googleapis.com/database/postgresql/num_backends\""
      comparison      = "COMPARISON_GT"
      threshold_value = floor(local.sql_max_connections * 0.8)
      duration        = "300s"
      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_MAX"
        cross_series_reducer = "REDUCE_SUM"
      }
    }
  }
  depends_on = [google_project_service.api]
}

# Memória: o f1-micro tem 0,6 GB e o Postgres usa quase tudo como cache, então o limiar é alto e
# deve ser recalibrado com os 30 dias medidos (SPEC 013, E1.15).
resource "google_monitoring_alert_policy" "sql_memory" {
  project               = var.project_id
  display_name          = "Memória do Cloud SQL acima de 95% (${var.env})"
  combiner              = "OR"
  notification_channels = local.channels

  conditions {
    display_name = "Uso de memória"
    condition_threshold {
      filter          = "resource.type=\"cloudsql_database\" AND metric.type=\"cloudsql.googleapis.com/database/memory/utilization\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0.95
      duration        = "900s"
      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_MEAN"
      }
    }
  }
  depends_on = [google_project_service.api]
}

resource "google_monitoring_uptime_check_config" "health" {
  count        = var.uptime_check && var.deploy_workloads ? 1 : 0
  project      = var.project_id
  display_name = "Health da plataforma (${var.env})"
  timeout      = "10s"
  period       = "300s"

  http_check {
    path         = "/api/health"
    port         = 443
    use_ssl      = true
    validate_ssl = true
  }

  monitored_resource {
    type = "uptime_url"
    labels = {
      project_id = var.project_id
      host       = replace(local.platform_url, "https://", "")
    }
  }
}

resource "google_monitoring_alert_policy" "uptime" {
  count                 = var.uptime_check && var.deploy_workloads ? 1 : 0
  project               = var.project_id
  display_name          = "Plataforma fora do ar (${var.env})"
  combiner              = "OR"
  notification_channels = local.channels

  conditions {
    display_name = "Health check falhando"
    condition_threshold {
      filter          = "resource.type=\"uptime_url\" AND metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\" AND metric.labels.check_id=\"${google_monitoring_uptime_check_config.health[0].uptime_check_id}\""
      comparison      = "COMPARISON_GT"
      threshold_value = 1
      duration        = "300s"
      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_NEXT_OLDER"
        cross_series_reducer = "REDUCE_COUNT_FALSE"
        group_by_fields      = ["resource.label.*"]
      }
    }
  }
}

# Requisições de gente na plataforma (SPEC 016): tudo menos os caminhos de máquina (probes, cron e a própria
# tela de espera). É o que a rota sleep-if-idle lê para saber se o staging está em uso.
resource "google_logging_metric" "user_requests" {
  count   = var.wake_enabled ? 1 : 0
  project = var.project_id
  name    = "ekoai_user_requests"
  filter  = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${local.name}-platform\" AND log_id(\"run.googleapis.com/requests\") AND NOT httpRequest.requestUrl=~\"/api/(live|health|cron|ambiente)\""

  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "1"
  }
  depends_on = [google_project_service.api]
}

# Post preso na publicação (BEZ-258): o reconciliador não conseguiu confirmar na rede se o post saiu e o
# mandou para a pessoa conferir. A linha vem de platform/src/lib/publish.ts (STUCK_LOG_MESSAGE).
resource "google_monitoring_alert_policy" "publish_stuck" {
  count                 = var.deploy_workloads ? 1 : 0
  project               = var.project_id
  display_name          = "Post preso na publicação (${var.env})"
  combiner              = "OR"
  notification_channels = local.channels

  conditions {
    display_name = "Post enviado para conferência manual"
    condition_matched_log {
      filter = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${local.name}-platform\" AND severity>=ERROR AND jsonPayload.scope=\"publish\" AND jsonPayload.message=\"post preso: confira na rede antes de publicar de novo\""
    }
  }

  alert_strategy {
    notification_rate_limit {
      period = "3600s"
    }
  }
  documentation {
    mime_type = "text/markdown"
    content   = "Um post ficou sem resposta da rede e foi marcado como falhou para conferência. Veja docs/runbook.md, seção Publicação: post preso."
  }
  depends_on = [google_cloud_run_v2_service.platform]
}

# Custo por post aprovado acima de 2x a mediana (BEZ-410): a rota collect-metrics grava uma linha WARNING com
# escopo `cost-anomaly`; a política avisa a equipe, no máximo um e-mail por hora.
resource "google_monitoring_alert_policy" "cost_anomaly" {
  count                 = var.deploy_workloads ? 1 : 0
  project               = var.project_id
  display_name          = "Custo por post aprovado acima do normal (${var.env})"
  combiner              = "OR"
  notification_channels = local.channels

  conditions {
    display_name = "Linha de log cost-anomaly"
    condition_matched_log {
      filter = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${local.name}-platform\" AND jsonPayload.scope=\"cost-anomaly\""
    }
  }

  alert_strategy {
    notification_rate_limit {
      period = "3600s"
    }
  }

  documentation {
    content   = "Um post aprovado custou mais de 2x a mediana da plataforma (BEZ-410). A linha de log traz brief_id, tenant_id, cost_usd e median_usd. Veja as chamadas em generation_runs desse brief (regeneração, falha em loop)."
    mime_type = "text/markdown"
  }
  depends_on = [google_cloud_run_v2_service.platform]
}
