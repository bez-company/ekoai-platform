#!/usr/bin/env bash
# Cards do Linear que vão junto numa release: os IDs [BEZ-NN] dos commits entre a main e a staging.
# No Linear, o merge da PR na staging leva o card para a coluna Staging; a release leva de Staging
# para Done (Done = em produção).
#
#   scripts/linear-release.sh <de> <até>          # lista os cards (ex.: origin/main origin/staging)
#   scripts/linear-release.sh <de> <até> --done   # move de Staging para Done os que estão em Staging
#
# Mover pede LINEAR_API_KEY (chave pessoal do Linear, Settings > Account > Security & access > API).
# Sem a chave, o script só lista e o movimento é feito à mão (ou pelo agente, pelo MCP do Linear).
# Card fora da coluna Staging (já em Done, ainda em In Review) não é tocado: o script avisa.
set -euo pipefail

from="${1:?uso: scripts/linear-release.sh <de> <até> [--done]}"
to="${2:?uso: scripts/linear-release.sh <de> <até> [--done]}"
mode="${3:-}"

ids=$(git log --format='%s%n%b' "$from..$to" | grep -oE '\bBEZ-[0-9]+\b' | sort -t- -k2 -n -u || true)
if [ -z "$ids" ]; then
  echo "nenhum card [BEZ-NN] nos commits de ${from} até ${to}"
  exit 0
fi
echo "Cards nesta release:"
for id in $ids; do echo "  $id"; done

[ "$mode" = "--done" ] || exit 0
if [ -z "${LINEAR_API_KEY:-}" ]; then
  echo "LINEAR_API_KEY ausente: mova os cards acima de Staging para Done à mão." >&2
  exit 0
fi

gql() {
  curl -sS https://api.linear.app/graphql -H "Authorization: $LINEAR_API_KEY" -H 'Content-Type: application/json' \
    --data "$(jq -n --arg q "$1" --argjson v "$2" '{query: $q, variables: $v}')"
}

numbers=$(printf '%s\n' $ids | sed 's/BEZ-//' | jq -R 'tonumber' | jq -s '.')
issues=$(gql 'query($n: [Float!]) { issues(first: 250, filter: { team: { key: { eq: "BEZ" } }, number: { in: $n } }) { nodes { id identifier state { name } team { states { nodes { id name } } } } } }' "{\"n\": $numbers}")
done_id=$(jq -r '[.data.issues.nodes[0].team.states.nodes[] | select(.name == "Done")][0].id // empty' <<<"$issues")
[ -n "$done_id" ] || { echo "não achei a coluna Done do time BEZ (resposta do Linear: $(jq -c '.errors // .' <<<"$issues" | head -c 300))" >&2; exit 1; }

jq -r '.data.issues.nodes[] | [.id, .identifier, .state.name] | @tsv' <<<"$issues" | while IFS=$'\t' read -r uuid identifier state; do
  if [ "$state" != "Staging" ]; then
    echo "  $identifier está em \"$state\", não em Staging: não mexi"
    continue
  fi
  ok=$(gql 'mutation($id: String!, $s: String!) { issueUpdate(id: $id, input: { stateId: $s }) { success } }' "{\"id\": \"$uuid\", \"s\": \"$done_id\"}" | jq -r '.data.issueUpdate.success // false')
  if [ "$ok" = "true" ]; then echo "  $identifier: Staging -> Done"; else echo "  $identifier: falhou ao mover" >&2; fi
done
