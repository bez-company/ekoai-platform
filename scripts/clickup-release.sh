#!/usr/bin/env bash
# Cards do ClickUp que vão junto numa release: os IDs dos commits entre a main e a staging.
# Um card novo aparece como `CU-<id>` (o ID do ClickUp, no título da PR); os 275 cards migrados do
# Linear em 23/10/2026 aparecem como `BEZ-NN` e são achados pelo prefixo `[BEZ-NN]` do título do card.
# O merge da PR na staging leva o card para Staging; a release leva de Staging para Done (Done = em
# produção).
#
#   scripts/clickup-release.sh <de> <até>          # lista os cards (ex.: origin/main origin/staging)
#   scripts/clickup-release.sh <de> <até> --done   # move de Staging para Done os que estão em Staging
#
# Consultar e mover pedem CLICKUP_API_TOKEN (token pessoal do ClickUp da BEZ: Configurações > Apps >
# API Token). Sem o token, o script só lista e o movimento é feito à mão.
# Card fora de Staging (já em Done, ainda em In Review) não é tocado: o script avisa.
set -euo pipefail

from="${1:?uso: scripts/clickup-release.sh <de> <até> [--done]}"
to="${2:?uso: scripts/clickup-release.sh <de> <até> [--done]}"
mode="${3:-}"
api=https://api.clickup.com/api/v2

log=$(git log --format='%s%n%b' "$from..$to")
cu=$(grep -oE '\bCU-[0-9a-z]+\b' <<<"$log" | sort -u || true)
bez=$(grep -oE '\bBEZ-[0-9]+\b' <<<"$log" | sort -t- -k2 -n -u || true)
if [ -z "$cu$bez" ]; then
  echo "nenhum card (CU-id ou BEZ-NN) nos commits de ${from} até ${to}"
  exit 0
fi
echo "Cards nesta release:"
for id in $cu $bez; do echo "  $id"; done

[ "$mode" = "--done" ] || exit 0
if [ -z "${CLICKUP_API_TOKEN:-}" ]; then
  echo "CLICKUP_API_TOKEN ausente: mova os cards acima de Staging para Done à mão." >&2
  exit 0
fi

cu_get() { curl -sS --fail-with-body -H "Authorization: $CLICKUP_API_TOKEN" "$api/$1"; }
cu_put() { curl -sS --fail-with-body -X PUT -H "Authorization: $CLICKUP_API_TOKEN" -H 'Content-Type: application/json' --data "$2" "$api/$1"; }

move() { # <rótulo> <id do ClickUp> <status atual>
  if [ "$3" != "staging" ]; then
    echo "  $1 está em \"$3\", não em staging: não mexi"
    return
  fi
  if cu_put "task/$2" '{"status":"done"}' >/dev/null; then echo "  $1: staging -> done"; else echo "  $1: falhou ao mover" >&2; fi
}

for id in $cu; do
  task=$(cu_get "task/${id#CU-}") || { echo "  $id: não achei o card" >&2; continue; }
  move "$id" "${id#CU-}" "$(jq -r '.status.status' <<<"$task")"
done

if [ -n "$bez" ]; then
  # Card migrado do Linear: acha pelo prefixo [BEZ-NN] no título, varrendo o workspace.
  team=$(cu_get team | jq -r '.teams[0].id')
  tasks='[]'
  for page in 0 1 2 3 4 5; do
    chunk=$(cu_get "team/$team/task?include_closed=true&subtasks=true&page=$page" | jq -c '.tasks')
    tasks=$(jq -c --argjson c "$chunk" '. + $c' <<<"$tasks")
    [ "$(jq 'length' <<<"$chunk")" -ge 100 ] || break
  done
  for id in $bez; do
    row=$(jq -r --arg p "[$id]" '[.[] | select(.name | startswith($p))][0] | select(. != null) | [.id, .status.status] | @tsv' <<<"$tasks")
    [ -n "$row" ] || { echo "  $id: não achei o card" >&2; continue; }
    move "$id" "${row%%$'\t'*}" "${row#*$'\t'}"
  done
fi
