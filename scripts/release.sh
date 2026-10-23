#!/usr/bin/env bash
# Release: leva a main até o commit atual da staging por fast-forward (mesmo SHA, sem commit novo e
# sem PR). Daí o push na main roda o CI e o deploy de produção, que espera a aprovação no
# environment `prod` (GitHub Actions). Não há outro caminho para a main (ADR 0013).
#
# Por que não uma PR staging -> main: com merge por rebase cada release reescreve os SHAs e a PR
# seguinte volta com conflito; o fast-forward não reescreve nada.
#
# No Linear, o card vai para a coluna Staging no merge da PR; a release passa os cards que sobem de
# Staging para Done (scripts/linear-release.sh, com LINEAR_API_KEY; sem a chave, só lista).
#
#   scripts/release.sh          # mostra o que sai e pede confirmação
#   scripts/release.sh --yes    # sem perguntar
set -euo pipefail

repo=$(git remote get-url origin | sed -E 's#^(git@github.com:|https://github.com/)##; s#\.git$##')
git fetch -q origin main staging
main=$(git rev-parse origin/main)
staging=$(git rev-parse origin/staging)

[ "$main" != "$staging" ] || { echo "a staging não tem nada novo sobre a main" >&2; exit 1; }
git merge-base --is-ancestor "$main" "$staging" || {
  echo "a main tem commit que a staging não tem; fast-forward impossível. Investigue antes de seguir (ninguém deveria escrever na main)." >&2
  exit 1
}

# O staging precisa ter publicado exatamente este commit com sucesso.
ok=$(gh run list --repo "$repo" --workflow Deploy --branch staging --json headSha,conclusion --limit 30 \
  --jq "[.[] | select(.headSha == \"$staging\" and .conclusion == \"success\")] | length")
[ "$ok" -gt 0 ] || { echo "o deploy de staging do commit ${staging:0:7} não terminou com sucesso. Espere ou refaça (Actions > Deploy > Run workflow, branch staging)." >&2; exit 1; }

echo "Vai para produção (${main:0:7}..${staging:0:7}):"
git log --no-merges --format='  %h %s' "$main..$staging"
scripts/linear-release.sh "$main" "$staging"
if [ "${1:-}" != "--yes" ]; then
  read -r -p "Digite 'release' para confirmar: " answer
  [ "$answer" = "release" ] || { echo "cancelado" >&2; exit 1; }
fi

git push origin "$staging:refs/heads/main"
echo "main agora em ${staging:0:7}. Aprove o deploy de produção em: https://github.com/$repo/actions/workflows/deploy.yml"
scripts/linear-release.sh "$main" "$staging" --done
