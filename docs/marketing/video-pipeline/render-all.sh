#!/bin/zsh
cd "$(dirname "$0")"
mkdir -p out
for v in v1-ekoai-em-45s v2-problemas v3-estudio v4-funcionalidades; do
  (cd projects/$v && npx --yes hyperframes render -q delivery -o ../../out/$v.mp4 > ../../out/$v.log 2>&1)
  echo "$v done: $(ls -la out/$v.mp4 2>&1 | tail -1)" >> out/status.txt
done
echo ALL_DONE >> out/status.txt
