# ADR 0003: migrations aplicadas automaticamente no merge na main

- **Status:** aceito
- **Data:** 2026-10-16
- **Mesmo desenho de:** o desenho de migrations automáticas que já existia em outros produtos da BEZ

## Contexto

As migrations eram aplicadas à mão (SQL Editor ou `platform/scripts/apply-migration.mjs`,
que só sabia aplicar a 0002). Cada PR com migration terminava com "aplique a 0007 antes do
deploy", o que depende de lembrar a ordem e não deixa registro do que foi aplicado. O repo
também não tinha CI de PR: testes e typecheck só rodavam na máquina de quem abriu a PR.

## Decisão

Um workflow, `.github/workflows/ci.yml`:

- **Em toda PR:** `npm test`, typecheck da plataforma e todas as migrations aplicadas duas
  vezes num Postgres 17 limpo (a segunda passada prova que reaplicar é seguro). Antes, cria
  os papéis `anon`, `authenticated` e `service_role`, que as migrations usam e um Postgres puro
  não tem. Depois, checa que o schema aceita o que o código grava hoje. Recusa migration com
  `drop table|schema|column`, `truncate` ou `delete from` sem `-- allow-destructive` no arquivo.
- **No push na main:** `supabase db push` no environment `Production`, depois de `test` e
  `migrations-check`. Um `--dry-run` antes lista as pendentes no log. `concurrency` sem cancelar.
- Segredo `SUPABASE_DB_URL` (Session Pooler, IPv4) só no environment `Production`. Permissões
  do workflow: `contents: read`. Ações fixadas por SHA, CLI com versão fixa.

O banco de produção nunca teve histórico de migrations. A primeira execução reaplica 0001 a
0009, o que é seguro porque todas são idempotentes. Nenhum baseline manual é necessário.

## Consequências

- Migration nova vai na pasta com número sequencial (`0010_...`), não timestamp: um timestamp
  ficaria sempre acima de `0009` e bagunçaria a ordem.
- A Vercel e o job de migrations disparam juntos no merge, sem ordem garantida. Migration tem
  que ser aditiva e o código tolerar a coluna ainda ausente (como o fallback do `brief_id` em
  `src/utils/queue.js`).
- Não há staging de banco: o primeiro lugar onde a migration roda contra dados reais é a
  produção. A rede de proteção é o teste em banco limpo, o `--dry-run` no log e, se quiser, um
  "Required reviewers" no environment `Production` para exigir um clique antes de aplicar.
- `platform/scripts/apply-migration.mjs` saiu: não há mais caminho manual.

## Verificação feita

Com Postgres 17 em Docker: as 9 migrations aplicam duas vezes sem erro e a checagem de schema
passa. Num banco igual ao de produção (tudo aplicado à mão, sem histórico, com TLS ligado como
no Supabase), `supabase db push --dry-run` lista as 9, o `push` registra as 9 e a segunda
execução diz "Remote database is up to date".
