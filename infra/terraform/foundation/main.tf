# Políticas de organização da BEZ (vale para todas as pastas e projetos, presentes e futuros):
# barram, por construção, o que o desenho já evita. Aplicar com a conta administradora da BEZ:
#
#   export TF_VAR_org_id=<id da organização>   # fora do repositório
#   terraform init && terraform apply
#
# Já estavam na organização, por padrão do Google, e por isso ficam de fora: subir chave de conta de
# serviço (`iam.disableServiceAccountKeyUpload`) e a versão gerenciada de criar chave.
#
# `run.requireInvokerIam` fica de fora de propósito: a plataforma é pública pela opção
# `invoker_iam_disabled` do Cloud Run (a organização já barra `allUsers`), e a política a proibiria.
#
# A restrição de região (`gcp.resourceLocations`) não foi aplicada: segredos com replicação
# automática, o endpoint global do Vertex e a configuração global do Identity Platform podem
# esbarrar nela. Só entra depois de testada no sandbox (SPEC 013, E1.6).

terraform {
  required_version = ">= 1.9"

  backend "gcs" {
    bucket = "bez-platform-tfstate"
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
  project               = "bez-platform"
  region                = "southamerica-east1"
  user_project_override = true
  billing_project       = "bez-platform"
}

variable "org_id" {
  description = "Id numérico da organização (TF_VAR_org_id; fora do repositório)."
  type        = string
}

locals {
  enforced = {
    # Nada de chave JSON de conta de serviço: a entrada é por Workload Identity Federation.
    "iam.disableServiceAccountKeyCreation" = "Sem criar chave de conta de serviço"
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
  name     = "organizations/${var.org_id}/policies/${each.key}"
  parent   = "organizations/${var.org_id}"

  spec {
    rules {
      enforce = "TRUE"
    }
  }
}
