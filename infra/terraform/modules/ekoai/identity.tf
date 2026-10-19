# Identity Platform: só prova quem é a pessoa; a sessão e o papel são nossos (SPEC 009).
resource "google_identity_platform_config" "auth" {
  project                    = var.project_id
  autodelete_anonymous_users = true

  sign_in {
    allow_duplicate_emails = false

    email {
      enabled           = true
      password_required = true
    }

    phone_number {
      enabled = false
    }
  }

  mfa {
    state = "ENABLED"
    provider_configs {
      state = "ENABLED"
      totp_provider_config {
        adjacent_intervals = 1
      }
    }
  }

  # Onde o login pode acontecer: os domínios do projeto e o da plataforma.
  authorized_domains = [
    local.firebase_auth_domain,
    "${var.project_id}.web.app",
    local.platform_host,
  ]

  # Textos dos e-mails de confirmação e de nova senha: a API recusa a edição
  # (EMAIL_TEMPLATE_UPDATE_NOT_ALLOWED) e o provider não expõe o bloco. Edita-se no console
  # (Authentication > Templates), junto com o remetente do domínio próprio.

  depends_on = [google_project_service.api]
}

# Chave de API do navegador para o SDK do Firebase. Não é segredo (vai no JavaScript do cliente),
# por isso a restrição: só as APIs do login e só a partir da plataforma.
resource "google_apikeys_key" "web" {
  project      = var.project_id
  name         = "${local.name}-web-login"
  display_name = "Login web (${var.env})"

  restrictions {
    browser_key_restrictions {
      allowed_referrers = [
        "https://${local.platform_host}/*",
        "https://${local.firebase_auth_domain}/*",
      ]
    }
    api_targets {
      service = "identitytoolkit.googleapis.com"
    }
    api_targets {
      service = "securetoken.googleapis.com"
    }
  }

  depends_on = [google_project_service.api]
}
