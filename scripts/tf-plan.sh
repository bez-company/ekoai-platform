#!/usr/bin/env bash
# Plano do Terraform de um ambiente da Ekoai com os valores que não moram no repositório (BEZ-216).
#
#   CLOUDSDK_ACTIVE_CONFIG_NAME=bez scripts/tf-plan.sh staging
#   cd infra/terraform/envs/staging && terraform apply tfplan     # depois de ler o plano
#
# Nenhum workflow aplica o Terraform: segredo, variável ou recurso novo só existe depois de um apply à
# mão. As variáveis deploy_workloads, platform_image, jobs_image, alert_email e tenant_id não têm valor
# no repositório (público), e com os padrões o plano propõe destruir o serviço e o canal de alerta.
# Este script lê cada uma do ambiente em execução:
#   - platform_image e jobs_image: a imagem que está no ar (o Terraform ignora a troca de imagem; o
#     deploy é quem troca), para o plano não propor voltar a uma imagem velha;
#   - tenant_id: a variável TENANT_ID do serviço;
#   - alert_email: o canal de e-mail que está no estado do Terraform.
# Gera o plano em infra/terraform/envs/<ambiente>/tfplan (fora do git). Leia o plano antes de
# aplicar: nada deve ser destruído sem motivo. Depois do apply, o próximo deploy volta o nome da
# revisão para sha-<commit>.
set -euo pipefail

usage() {
  echo "uso: scripts/tf-plan.sh <staging|prod>" >&2
  exit 2
}

env="${1:-}"
case "$env" in
  staging | prod) project="ekoai-$env" ;;
  *) usage ;;
esac
region="southamerica-east1"
dir="$(cd "$(dirname "$0")/.." && pwd)/infra/terraform/envs/$env"

platform_image=$(gcloud run services describe ekoai-platform --project "$project" --region "$region" --format='value(spec.template.spec.containers[0].image)')
jobs_image=$(gcloud run jobs describe ekoai-migrate --project "$project" --region "$region" --format='value(spec.template.spec.template.spec.containers[0].image)')
tenant_id=$(gcloud run services describe ekoai-platform --project "$project" --region "$region" --format=json |
  jq -r '.spec.template.spec.containers[0].env[] | select(.name == "TENANT_ID") | .value')

[ -n "$platform_image" ] || { echo "não achei a imagem da plataforma em $project" >&2; exit 1; }
[ -n "$jobs_image" ] || { echo "não achei a imagem dos jobs em $project" >&2; exit 1; }

echo "ambiente:        $env ($project)"
echo "platform_image:  $platform_image"
echo "jobs_image:      $jobs_image"
echo "tenant_id:       ${tenant_id:-(padrão do módulo)}"

cd "$dir"
# O estado mora no bucket do GCS e o Terraform usa a credencial padrão do aplicativo (ADC), não a do
# gcloud. "invalid_grant" ou "invalid_rapt" aqui: rode `gcloud auth application-default login`.
if ! terraform init -input=false >/dev/null; then
  echo "o terraform init falhou; se o erro fala de invalid_grant, rode: gcloud auth application-default login" >&2
  exit 1
fi
alert_email="${TF_VAR_alert_email:-}"
if [ -z "$alert_email" ]; then
  alert_email=$(terraform state pull | jq -r '
    [.resources[] | select(.type == "google_monitoring_notification_channel" and .name == "email")
      | .instances[].attributes.labels.email_address] | first // ""')
fi

if [ -n "$alert_email" ]; then echo "alert_email:     ${alert_email%%@*}@… (do estado)"; else echo "alert_email:     (vazio: o plano vai propor apagar o canal de alerta)"; fi
echo

args=(-input=false -out=tfplan
  -var deploy_workloads=true
  -var "platform_image=$platform_image"
  -var "jobs_image=$jobs_image")
[ -n "$tenant_id" ] && args+=(-var "tenant_id=$tenant_id")
[ -n "$alert_email" ] && args+=(-var "alert_email=$alert_email")

terraform plan "${args[@]}"
echo
echo "Plano em $dir/tfplan. Leia acima; para aplicar: (cd $dir && terraform apply tfplan)"
