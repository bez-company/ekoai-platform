#!/usr/bin/env bash
# Liga e desliga o Cloud SQL de um ambiente da Ekoai (SPEC 013, E1.11).
#
#   CLOUDSDK_ACTIVE_CONFIG_NAME=bez scripts/sql-power.sh staging status
#   CLOUDSDK_ACTIVE_CONFIG_NAME=bez scripts/sql-power.sh staging down
#   CLOUDSDK_ACTIVE_CONFIG_NAME=bez scripts/sql-power.sh staging up
#
# Parado, a máquina não cobra; disco e IP continuam. O Terraform ignora `activation_policy`
# (ignore_changes), então o próximo apply não religa o banco. Produção nunca desliga por aqui.
set -euo pipefail

usage() {
  echo "uso: scripts/sql-power.sh <staging|prod> <status|up|down>" >&2
  exit 2
}

env="${1:-}"
action="${2:-}"
case "$env" in
  staging | prod) project="ekoai-$env" ;;
  *) usage ;;
esac
instance="ekoai-pg"

state() {
  gcloud sql instances describe "$instance" --project="$project" \
    --format='value(state,settings.activationPolicy)'
}

# Operação do Cloud SQL ainda em andamento (ligar, desligar, atualizar). O `state` do `gcloud` volta a dizer
# RUNNABLE em segundos, com o banco ainda subindo (medido em 22/10/2026: 14,8 min até responder), então só o
# estado não basta para saber que terminou.
busy() {
  gcloud sql operations list --instance="$instance" --project="$project" --filter='status!=DONE' --format='value(name)' | wc -l | tr -d ' '
}

# Ligar pode passar de 10 minutos (o `gcloud` desiste de esperar antes disso), por isso o patch
# é assíncrono e a espera é nossa: até 30 minutos, olhando o estado a cada 15 segundos.
wait_for() {
  local want="$1" now
  for _ in $(seq 1 120); do
    now="$(state | tr '\t' ' ')"
    echo "  $(date +%H:%M:%S) $now"
    [ "$now" = "$want" ] && [ "$(busy)" = "0" ] && return 0
    sleep 15
  done
  echo "tempo esgotado esperando '$want' em $project" >&2
  return 1
}

case "$action" in
  status)
    state
    ;;
  up)
    gcloud sql instances patch "$instance" --project="$project" --activation-policy=ALWAYS --quiet --async
    wait_for "RUNNABLE ALWAYS"
    ;;
  down)
    if [ "$env" = "prod" ]; then
      echo "produção não desliga por este script" >&2
      exit 1
    fi
    gcloud sql instances patch "$instance" --project="$project" --activation-policy=NEVER --quiet --async
    wait_for "STOPPED NEVER"
    ;;
  *) usage ;;
esac
