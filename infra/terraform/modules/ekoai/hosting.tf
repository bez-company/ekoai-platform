# Domínio próprio da plataforma (ADR 0020). O Cloud Run não aceita domain mapping em southamerica-east1
# e o Load Balancer custa cerca de US$ 18 por mês por ambiente (BEZ-42, antes do lançamento). Até lá, um
# site do Firebase Hosting recebe o domínio e repassa tudo ao Cloud Run por rewrite. O Hosting só entrega
# o cookie `__session` ao serviço: é o nome do cookie de sessão da plataforma.

locals {
  app_hosting_site = "${var.project_id}-app"
}

resource "google_firebase_hosting_site" "app" {
  count    = var.app_domain == "" ? 0 : 1
  provider = google-beta
  project  = var.project_id
  site_id  = local.app_hosting_site
}

# Toda rota vai para o Cloud Run. A configuração é imutável: mudar o rewrite cria uma versão nova. Sem
# depends_on no serviço de propósito: ele já existe (app_domain exige deploy_workloads) e a dependência
# arrastaria o serviço para um `-target` do Hosting.
resource "google_firebase_hosting_version" "app" {
  count    = var.app_domain == "" ? 0 : 1
  provider = google-beta
  site_id  = google_firebase_hosting_site.app[0].site_id

  config {
    rewrites {
      glob = "**"
      run {
        service_id = "${local.name}-platform"
        region     = var.region
      }
    }
  }
}

resource "google_firebase_hosting_release" "app" {
  count        = var.app_domain == "" ? 0 : 1
  provider     = google-beta
  site_id      = google_firebase_hosting_site.app[0].site_id
  version_name = google_firebase_hosting_version.app[0].name
  message      = "Rewrite para o Cloud Run (Terraform)"
}

resource "google_firebase_hosting_custom_domain" "app" {
  count                 = var.app_domain == "" ? 0 : 1
  provider              = google-beta
  project               = var.project_id
  site_id               = google_firebase_hosting_site.app[0].site_id
  custom_domain         = var.app_domain
  wait_dns_verification = false

  depends_on = [google_firebase_hosting_release.app]
}
