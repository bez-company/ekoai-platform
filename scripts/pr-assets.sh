#!/usr/bin/env bash
# Sobe imagens para a branch `pr-assets` e imprime o markdown para colar no corpo da PR.
# A branch nunca é mergeada: os prints não entram na main nem no histórico dela.
#
#   scripts/pr-assets.sh 43-entry-screens .context/shots/login.png .context/shots/mobile.png
#
# Repo público: só imagem com dado fictício (nada de e-mail real, token, cliente ou pessoa).
set -euo pipefail

name="${1:?uso: scripts/pr-assets.sh <pasta> <arquivo.png>...}"
shift
[ "$#" -gt 0 ] || { echo "informe pelo menos uma imagem" >&2; exit 1; }
for f in "$@"; do [ -f "$f" ] || { echo "não achei $f" >&2; exit 1; }; done
case "$name" in *[!A-Za-z0-9._-]*|'') echo "a pasta só pode ter letras, números, ponto, hífen e sublinhado" >&2; exit 1 ;; esac

slug=$(git remote get-url origin | sed -E 's#^(git@github.com:|https://github.com/)##; s#\.git$##')
tmp=$(mktemp -d)
cleanup() { git worktree remove --force "$tmp" 2>/dev/null || rm -rf "$tmp"; }
trap cleanup EXIT

if git ls-remote --exit-code --heads origin pr-assets >/dev/null 2>&1; then
  git fetch -q origin pr-assets
  git worktree add -q --detach "$tmp" origin/pr-assets
else
  git worktree add -q --detach "$tmp" HEAD
  git -C "$tmp" checkout -q --orphan pr-assets
  git -C "$tmp" rm -rqf .
fi

mkdir -p "$tmp/$name"
cp "$@" "$tmp/$name/"
git -C "$tmp" add "$name"
git -C "$tmp" commit -q -m "chore: screenshots for $name"
sha=$(git -C "$tmp" rev-parse HEAD)
git -C "$tmp" push -q origin HEAD:pr-assets

# Endereço fixado no commit: o print não muda se alguém mexer na pasta depois.
for f in "$@"; do
  base=$(basename "$f")
  echo "![${base%.*}](https://github.com/$slug/blob/$sha/$name/$base?raw=true)"
done
