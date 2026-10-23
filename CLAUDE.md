# Regras do repositório (Ekoai)

Repo público da BEZ (`bez-company/ekoai-platform`): nunca commitar e-mail, token, ID de projeto
sensível ou dado de cliente. Plano e decisões: `docs/specs/` e `docs/adr/`. Operação: `docs/runbook.md`.

## Só a Ekoai neste repositório

Código, infra, spec, ADR, runbook e análise **da Ekoai**. Nada do Saint-Jardin, do site da BEZ, da Pilar nem da
organização (políticas, orçamentos, estado do Terraform, SPEC 013): cada um mora no repositório do próprio
produto, e o da organização é `bez-company/bez-platform`. `tests/product-boundaries.test.js` reprova menção
a outro produto. Este repositório é público.

## Esteira: feature → staging → produção

Duas branches de longa vida ([ADR 0013](docs/adr/0013-esteira-feature-staging-producao.md)):
`staging` (ambiente de integração) e `main` (produção). Não há outro caminho.

1. Branch de feature a partir da `staging`; PR com **base `staging`** (`gh pr create --base staging`).
   Merge por **rebase (padrão) ou squash** (merge commit não). Ao mergear: `gh pr merge --rebase`. O CI roda e o deploy do ambiente
   `staging` é automático depois do merge. A branch de feature é apagada no merge.
2. Release: `scripts/release.sh` leva a `main` até o commit da `staging` por **fast-forward** (sem PR
   e sem commit novo). O push na `main` roda o CI e o deploy de `prod`, que espera a aprovação no
   environment `prod` (GitHub Actions).
3. Correção urgente é uma feature como as outras e vai à produção por uma release logo em seguida.
   A `main` não recebe PR (o CI reprova) e `staging` e `main` nunca se apagam.

## Pull request

- Título e corpo em inglês; commit em Conventional Commits, em inglês. `gh pr create --assignee @me`.
  O título leva o número do card do ClickUp como prefixo: `[BEZ-<n>] feat(scope): ...`, e cada commit
  leva o mesmo número depois do escopo: `feat(scope): [BEZ-<n>] ...`. O `BEZ-<n>` é o prefixo do nome
  do card (`[BEZ-296] Rotas das telas em português`), sequencial no workspace inteiro; o `/task` numera
  o card novo (maior número + 1). Não usamos o `CU-<id>` do ClickUp. O card fica no Space Bez Company,
  na pasta Ekoai (lista Platform, ou Website se for o site); sem card, crie antes. Quem liga a PR ao
  card é `.github/workflows/clickup-sync.yml` (`scripts/clickup-pr-sync.js`, secret
  `CLICKUP_API_TOKEN`): comenta o link da PR no card, leva para **In Review** ao abrir e para
  **Staging** ao mergear. A release (`scripts/release.sh`) leva de Staging para **Done**. Sem o
  secret, a Action só avisa e o card se move à mão.
- **Épico do card (lista Platform):** todo card leva exatamente uma tag `epic:<nome>`, entre
  `epic:geracao-ia` (agentes, revisor, eval, estúdio, aprendizado, layouts), `epic:publicacao` (Instagram,
  Meta, agenda, tokens, publicar foto), `epic:campanhas-fatos`, `epic:telas-ui` (só trabalho de tela,
  navegação, onboarding, design system), `epic:conta-acesso` (login, convite, papéis, perfil),
  `epic:infra-gcp`, `epic:esteira` (CI, E2E, release, ClickUp), `epic:cobranca-planos` e
  `epic:observabilidade`. A tag `eval` vem a mais quando o card nasce do eval da geração ou mexe nele. As
  tags ficam escondidas na lista; as views `Épico: <nome>` e `Evals` da lista Platform filtram por elas.
  Sem a tag, o card some dessas views.
- O corpo segue `.github/pull_request_template.md`. Apague a seção que não se aplica; não deixe
  seção vazia nem comentário do modelo.
- **Mudança visual: prints no corpo da PR, sempre.** Antes e depois quando muda uma tela que já
  existe; só depois quando a tela é nova. Desktop e mobile. Claro e escuro quando mexe no tema. Os
  estados que importam: vazio, carregando, erro e cheio. Dado fictício: este repo é público.
  Para subir: `scripts/pr-assets.sh <pasta> <png>...` e colar o markdown que ele imprime.
- **Mudança sem tela:** esqueleto do modelo e, quando o fluxo, os dados ou a arquitetura mudam, um
  diagrama pequeno (até uns 10 nós). O GitHub renderiza Mermaid no corpo:
  - passos entre sistemas ou pessoas (login, convite, webhook, job): `sequenceDiagram`
  - regra de decisão: `flowchart TD`; estados de um registro: `stateDiagram-v2`
  - tabela nova ou alterada: `erDiagram` só das tabelas tocadas, mais a lista das restrições novas
  - rota: tabela Rota, Permissão, Corpo, Respostas; variável de ambiente: Variável, Onde se define, Padrão
  - sem diagrama que esclareça, não force um: uma tabela antes e depois resolve.
- **Verificação honesta:** diga o que foi exercitado de verdade (teste, navegador real, banco real) e o
  que NÃO foi. Aprovação de UI com dublê não vale como teste do serviço real.
- PR com conflito não roda o CI. A `staging` anda sozinha (deploy e infra): rebasear antes de abrir.
  Depois do merge, apagar a branch e o worktree.

## Código

- Cor, fonte, raio e sombra só por token do design system (`platform/src/app/globals.css` e
  `tailwind.config.ts`). Cor crua do Tailwind ou hex em `className` reprova (`tests/design-tokens.test.js`).
- Migration é aditiva e reaplicável (o CI aplica duas vezes). Apagar coluna ou tabela exige
  `-- allow-destructive` com o motivo. Toda tabela com `tenant_id` tem RLS e entra em `TENANT_TABLES`.
- Acesso ao banco: `tenantDb` por conta; `db()` cru só nos arquivos da lista de `tests/tenant-scope.test.js`.
- Rota de API declara a permissão que exige (`tests/route-permissions.test.js`). Rota pública só pelo
  caminho exato no middleware, e só quando a prova é outra (ID token, segredo do cron).
- Validar dado externo na entrada (parser puro em `platform/src/lib`), antes de qualquer I/O.
- Nada da Pilar nem de outro cliente no código (`tests/no-client-brand.test.js`).
- Variável pública do navegador não usa `NEXT_PUBLIC_`: a imagem é construída no CI sem a chave; o
  servidor lê em runtime e passa por props.

## Marcas

A Ekoai usa o design system 06 (ameixa e pêssego, Sora, gotas em formação). A asa, o coral e a Geist
são da BEZ (outro repo). Não misturar.
