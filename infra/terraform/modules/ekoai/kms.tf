# Chave que cifra os tokens das redes sociais gravados no banco (SPEC 011 R5, ADR 0012). O
# servidor cifra com ela e guarda só o texto cifrado e o nome da versão da chave; a chave nunca
# sai do Cloud KMS. Um keyring e uma chave simétrica por ambiente.
#
# Keyring e chave não podem ser apagados no Cloud KMS (o nome fica reservado), por isso o
# prevent_destroy: destruir pelo Terraform só agendaria a destruição das versões.

resource "google_kms_key_ring" "main" {
  project  = var.project_id
  name     = local.name
  location = var.region

  depends_on = [google_project_service.api]

  lifecycle {
    prevent_destroy = true
  }
}

resource "google_kms_crypto_key" "social_tokens" {
  name            = "social-tokens"
  key_ring        = google_kms_key_ring.main.id
  purpose         = "ENCRYPT_DECRYPT"
  rotation_period = "7776000s" # 90 dias; as versões antigas continuam decifrando o que cifraram
  labels          = { app = local.name, env = var.env }

  version_template {
    algorithm        = "GOOGLE_SYMMETRIC_ENCRYPTION"
    protection_level = "SOFTWARE"
  }

  lifecycle {
    prevent_destroy = true
  }
}

# A plataforma e os jobs rodam com a mesma conta de serviço: um papel cobre os dois (a plataforma
# cifra ao conectar e decifra ao publicar; o refresh-tokens decifra e grava o token novo).
resource "google_kms_crypto_key_iam_member" "app_uses_social_tokens" {
  crypto_key_id = google_kms_crypto_key.social_tokens.id
  role          = "roles/cloudkms.cryptoKeyEncrypterDecrypter"
  member        = "serviceAccount:${google_service_account.app.email}"
}
