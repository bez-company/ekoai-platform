# Projeto bez-platform (SPEC 013): o que é da BEZ inteira e não de um produto. Orçamentos por projeto
# e o dataset que recebe a exportação de faturamento. O estado de todos os ambientes mora no bucket
# deste mesmo projeto. Aplicar com a conta administradora da BEZ:
#
#   export TF_VAR_billing_account=<id da conta de faturamento>   # fora do repositório
#   terraform init && terraform plan && terraform apply
#
# A exportação de faturamento para o BigQuery só se liga pelo console (não há API pública):
# Faturamento > Exportação do faturamento > Custo de uso padrão e detalhado > dataset
# `billing_export` deste projeto. Ela não recupera o passado, então liga-se cedo.

terraform {
  required_version = ">= 1.9"

  backend "gcs" {
    bucket = "bez-platform-tfstate"
    prefix = "platform"
  }

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 6.40, < 8.0"
    }
  }
}

provider "google" {
  project               = "bez-platform"
  region                = "southamerica-east1"
  user_project_override = true
  billing_project       = "bez-platform"
}

variable "billing_account" {
  description = "Id da conta de faturamento (TF_VAR_billing_account; fora do repositório)."
  type        = string
}

variable "site_project_id" {
  description = "Projeto onde o site da BEZ roda hoje (TF_VAR_site_project_id). Vazio pula o orçamento dele; some quando o site ganhar projeto próprio (SPEC 013, Etapa 2)."
  type        = string
  default     = ""
}

locals {
  # Orçamento mensal por projeto, em reais. Os valores seguem o nível de cada projeto (tabela de
  # níveis da SPEC 013): beta cerca de US$ 25, lab cerca de US$ 5. O staging da Ekoai fica mais
  # alto enquanto o banco estiver sempre ligado (E1.11 o desliga fora dos testes).
  project_budgets = merge(
    {
      "ekoai-prod"          = 150
      "ekoai-staging"       = 100
      "bez-platform"        = 30
      "bez-site-prod"       = 30
      "bez-company-sandbox" = 30
    },
    var.site_project_id == "" ? {} : { (var.site_project_id) = 30 },
  )

  # Teto do conjunto: o limite que o Matheus fixou para a infraestrutura fixa da BEZ.
  global_budget_brl = 330
}

data "google_project" "budgeted" {
  for_each   = local.project_budgets
  project_id = each.key
}

# Os orçamentos contam o custo antes dos créditos (EXCLUDE_ALL_CREDITS): medem a fatura real, não o
# que o crédito de teste esconde. O e-mail vai para quem administra a conta de faturamento.
resource "google_billing_budget" "project" {
  for_each        = local.project_budgets
  billing_account = var.billing_account
  display_name    = "${each.key} mensal R$ ${each.value}"

  budget_filter {
    projects               = ["projects/${data.google_project.budgeted[each.key].number}"]
    credit_types_treatment = "EXCLUDE_ALL_CREDITS"
    calendar_period        = "MONTH"
  }

  amount {
    specified_amount {
      currency_code = "BRL"
      units         = tostring(each.value)
    }
  }

  threshold_rules { threshold_percent = 0.5 }
  threshold_rules { threshold_percent = 0.8 }
  threshold_rules { threshold_percent = 1.0 }
  threshold_rules {
    threshold_percent = 1.0
    spend_basis       = "FORECASTED_SPEND"
  }
}

# O orçamento global já existia (criado no console como "BEZ mensal R$ 100"); foi importado e
# passou a valer o teto do conjunto, com os mesmos limiares dos demais.
resource "google_billing_budget" "global" {
  billing_account = var.billing_account
  display_name    = "BEZ mensal R$ ${local.global_budget_brl}"

  budget_filter {
    credit_types_treatment = "EXCLUDE_ALL_CREDITS"
    calendar_period        = "MONTH"
  }

  amount {
    specified_amount {
      currency_code = "BRL"
      units         = tostring(local.global_budget_brl)
    }
  }

  threshold_rules { threshold_percent = 0.5 }
  threshold_rules { threshold_percent = 0.8 }
  threshold_rules { threshold_percent = 1.0 }
  threshold_rules {
    threshold_percent = 1.0
    spend_basis       = "FORECASTED_SPEND"
  }
}

resource "google_bigquery_dataset" "billing_export" {
  dataset_id    = "billing_export"
  friendly_name = "Exportação de faturamento"
  description   = "Custo de uso padrão e detalhado de toda a organização, por projeto, serviço e label (SPEC 013)."
  location      = "southamerica-east1"

  labels = {
    product = "platform"
    env     = "prod"
    tier    = "production"
  }

  # O histórico de custo é o que o painel por produto lê (E1.16): nunca apagar com o conteúdo.
  delete_contents_on_destroy = false
}

output "billing_export_dataset" {
  value = google_bigquery_dataset.billing_export.dataset_id
}
