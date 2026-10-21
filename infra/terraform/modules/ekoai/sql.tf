resource "random_password" "db" {
  length  = 32
  special = false
}

resource "google_sql_database_instance" "main" {
  project             = var.project_id
  name                = "${local.name}-pg"
  region              = var.region
  database_version    = "POSTGRES_17"
  deletion_protection = var.protect_data

  settings {
    tier              = var.sql_tier
    edition           = "ENTERPRISE"
    availability_type = var.sql_availability
    activation_policy = var.sql_activation_policy
    disk_type         = "PD_SSD"
    disk_size         = var.sql_disk_size_gb
    disk_autoresize   = true

    deletion_protection_enabled = var.protect_data

    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = local.tier_profile.pitr
      start_time                     = "06:00" # UTC, 03:00 em Brasília
      transaction_log_retention_days = local.tier_profile.pitr ? 7 : null
      backup_retention_settings {
        retained_backups = 14
      }
    }

    ip_configuration {
      ipv4_enabled    = false
      private_network = google_compute_network.main.id
      ssl_mode        = "ENCRYPTED_ONLY"
    }

    maintenance_window {
      day  = 7 # domingo
      hour = 7 # 04:00 em Brasília
    }

    insights_config {
      query_insights_enabled = true
    }

    user_labels = local.labels
  }

  # Ligar e desligar o banco do staging é operação (scripts/sql-power.sh), não Terraform: sem isto o
  # próximo apply religaria a máquina parada. Vale para os dois ambientes; em produção a política
  # nasce ALWAYS e não muda por aqui.
  lifecycle {
    ignore_changes = [settings[0].activation_policy]
  }

  depends_on = [google_service_networking_connection.sql]
}

resource "google_sql_database" "app" {
  project  = var.project_id
  instance = google_sql_database_instance.main.name
  name     = local.name
}

# Usuário único da aplicação: dono das tabelas, usado pela plataforma e pelo job `migrate`
# (o app ignora o RLS por ser o dono; ADR 0008). Senha só no Secret Manager.
resource "google_sql_user" "app" {
  project  = var.project_id
  instance = google_sql_database_instance.main.name
  name     = local.name
  password = random_password.db.result
}
