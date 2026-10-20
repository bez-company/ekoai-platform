# Políticas de organização da pasta `ekoai` (vale para os dois projetos e para os futuros):
# barram, por construção, o que o desenho já evita. Aplicar com a conta administradora da BEZ:
#
#   export TF_VAR_folder_id=<id da pasta ekoai>
#   terraform init && terraform apply
#
# `run.requireInvokerIam` fica de fora de propósito: a plataforma é pública pela opção
# `invoker_iam_disabled` do Cloud Run (a organização já barra `allUsers`), e a política a proibiria.

terraform {
  required_version = ">= 1.9"

  backend "gcs" {
    bucket = "ekoai-prod-tfstate"
    prefix = "foundation"
  }

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 6.40, < 8.0"
    }
  }
}

provider "google" {
  project               = "ekoai-prod"
  region                = "southamerica-east1"
  user_project_override = true
  billing_project       = "ekoai-prod"
}

variable "folder_id" {
  description = "Id numérico da pasta ekoai (TF_VAR_folder_id; fora do repositório)."
  type        = string
}

locals {
  enforced = {
    # Nada de chave JSON de conta de serviço: a entrada é por Workload Identity Federation.
    "iam.disableServiceAccountKeyCreation" = "Sem criar chave de conta de serviço"
    "iam.disableServiceAccountKeyUpload"   = "Sem subir chave de conta de serviço"
    # Banco só por IP interno (já é assim; isto impede alguém de ligar o IP público).
    "sql.restrictPublicIp" = "Cloud SQL sem IP público"
    # Bucket nunca público.
    "storage.publicAccessPrevention" = "Bucket sem acesso público"
    # Sem a rede `default` aberta em projeto novo: a rede é a do Terraform.
    "compute.skipDefaultNetworkCreation" = "Sem rede default"
  }
}

resource "google_org_policy_policy" "enforced" {
  for_each = local.enforced
  name     = "folders/${var.folder_id}/policies/${each.key}"
  parent   = "folders/${var.folder_id}"

  spec {
    rules {
      enforce = "TRUE"
    }
  }
}
