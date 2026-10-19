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
