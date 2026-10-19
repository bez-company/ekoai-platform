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
  paused           = var.schedules_paused
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

# publish-due não é job: o Scheduler chama a plataforma com um token OIDC, que ela confere.
resource "google_cloud_scheduler_job" "publish_due" {
  count            = var.deploy_workloads ? 1 : 0
  project          = var.project_id
  region           = var.region
  name             = "${local.name}-publish-due"
  description      = "Publica o que está agendado e venceu"
  schedule         = "*/10 * * * *"
  time_zone        = "Etc/UTC"
  paused           = var.schedules_paused
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

resource "google_cloud_run_v2_job_iam_member" "scheduler_runs" {
  for_each = { for k, v in local.jobs : k => v if var.deploy_workloads && v.cron != "" }
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_job.job[each.key].name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.scheduler.email}"
}
