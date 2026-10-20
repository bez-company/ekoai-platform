#!/usr/bin/env bash
# Abre a PR de release (staging -> main) com a lista do que vai para produção. A PR NÃO é mergeada
# aqui: quem decide é você, no GitHub, com "Create a merge commit" (nunca squash: o squash faria a
# staging divergir da main). Depois do merge, o deploy de produção espera a aprovação no
# environment `prod` (GitHub Actions).
#
#   scripts/release.sh            # abre a PR
#   RELEASE_CARD=BEZ-50 scripts/release.sh   # outro card no título
set -euo pipefail

card="${RELEASE_CARD:-BEZ-50}"
git fetch -q origin main staging
ahead=$(git rev-list --count origin/main..origin/staging)
[ "$ahead" -gt 0 ] || { echo "a staging não tem nada novo sobre a main" >&2; exit 1; }
if gh pr list --base main --head staging --state open --json number --jq '.[0].number' | grep -q .; then
  echo "já existe uma PR de release aberta: $(gh pr list --base main --head staging --state open --json url --jq '.[0].url')" >&2
  exit 1
fi

sha=$(git rev-parse --short origin/staging)
changes=$(git log --no-merges --format='- %s' origin/main..origin/staging)
body=$(cat <<BODY
## Why

Release de produção: leva o que já está no staging (\`$sha\`) para a main.

## What changes

$changes

## Verification

O staging já publicou este mesmo commit. Confira o ambiente antes de aprovar o deploy: \`/api/health\` e o fluxo que mudou.

## Risk and rollback

O deploy de produção espera a aprovação no environment \`prod\`. Merge com **Create a merge commit**. Rollback da plataforma: \`gcloud run services update-traffic ekoai-platform --to-revisions=<revisão anterior>=100\`; migrations são aditivas.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
BODY
)
gh pr create --base main --head staging --assignee @me --title "[$card] release: $(date +%F)" --body "$body"
