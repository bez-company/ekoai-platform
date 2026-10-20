# ADR 0013: esteira feature → staging → produção, um ambiente por branch

- **Status:** aceito
- **Data:** 2026-10-20
- **Specs que dependem:** [SPEC 010](../specs/010-migracao-google-cloud.md) (deploy no Cloud Run)

## Contexto

Até aqui havia uma branch só, a `main`: cada merge publicava no staging e, com a aprovação do
`prod`, na produção. O staging nunca tinha código diferente da produção por mais que alguns minutos,
então não servia para testar uma mudança com calma antes de liberar. O deploy já era um workflow
reutilizável por ambiente (`deploy-env.yml`), mas ligado a uma branch só.

## Decisão

1. **Duas branches de longa vida.** `staging` é o ambiente de integração; `main` é o que está em
   produção.
2. **Feature entra em `staging`.** Toda mudança nasce numa branch de feature e entra por PR na
   `staging` (squash). O CI roda na PR e de novo no push; passando, o deploy do ambiente `staging`
   roda sozinho.
3. **Release é uma PR `staging` → `main`**, aberta com `scripts/release.sh` e mergeada com **merge
   commit** (nunca squash: o squash gera um commit novo na `main` e a `staging` passa a divergir
   dela). Nada entra na `main` por outro caminho.
4. **Produção só com aprovação.** O push na `main` roda o CI e o deploy de `prod`, que fica parado no
   environment `prod` (Required reviewers) até a aprovação no GitHub Actions.
5. **Cada environment só aceita a própria branch** (deployment branch policy): `staging` só publica
   a partir da `staging`, `prod` só a partir da `main`. Para a policy valer, o deploy roda no mesmo
   run do `push` (o CI entra como workflow reutilizável, `workflow_call`), e não em `workflow_run`:
   em `workflow_run` o ref é sempre o da branch padrão, e o environment `staging` recusaria tudo
   ("Branch main is not allowed to deploy to staging"). A PR de release não publica nada (o deploy
   só reage a `push`).
6. **Correção urgente segue o mesmo fluxo**, só que sem esperar: branch de feature, PR na `staging`,
   release logo em seguida. Não há atalho para a `main`.

## Consequências

- O staging pode ficar à frente da produção por dias. Quem faz a release leva tudo o que está na
  `staging`: não dá para liberar uma feature sozinha sem tirar as outras antes (reverter na
  `staging` ou esperar).
- A produção reconstrói a imagem a partir do commit de merge da release. O código é o mesmo da
  `staging` (árvore idêntica), mas não é o mesmo artefato: promover o digest da imagem entre os dois
  projetos do Google Cloud fica como melhoria.
- Migrations rodam primeiro no staging, contra um banco com a forma de produção, antes de chegarem à
  produção. Como são aditivas, a ordem entre migration e código continua segura.
- A `main` ganha um commit de merge por release. É o registro de cada liberação.
- O CI roda também no push da `staging`, dentro do run de Deploy; o `ci.yml` só dispara sozinho em PR.
