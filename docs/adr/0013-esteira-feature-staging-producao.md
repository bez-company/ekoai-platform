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
2. **Feature entra em `staging` por PR, com merge por rebase (padrão) ou squash** (merge commit fica
   desligado no repositório e na regra da `staging`). O CI roda na PR e de novo no push;
   passando, o deploy do ambiente `staging` roda sozinho. A `staging` só recebe PR com `CI ok`.
3. **Release é o fast-forward da `main` até o commit atual da `staging`** (`scripts/release.sh`), sem
   PR e sem commit novo: a `main` fica no mesmo SHA da `staging`. Uma PR `staging` → `main` com
   rebase ou squash não serve: ambos reescrevem os SHAs, a `main` passa a divergir da `staging` e a próxima
   release volta com conflito (testado: a segunda PR ficou `CONFLICTING`). Fast-forward não reescreve
   nada. O script exige que o staging tenha publicado esse commit com sucesso.
4. **Produção só com aprovação.** O push na `main` roda o CI, confere que o commit está na história
   da `staging` (job `Veio da staging`) e então o deploy de `prod`, que fica parado no environment
   `prod` (Required reviewers) até a aprovação no GitHub Actions. Escrita direta na `main` que não
   venha da `staging` é barrada nesse job.
5. **Cada environment só aceita a própria branch** (deployment branch policy): `staging` só publica
   a partir da `staging`, `prod` só a partir da `main`. Para a policy valer, o deploy roda no mesmo
   run do `push` (o CI entra como workflow reutilizável, `workflow_call`), e não em `workflow_run`:
   em `workflow_run` o ref é sempre o da branch padrão, e o environment `staging` recusaria tudo
   ("Branch main is not allowed to deploy to staging"). O provedor de Workload Identity de cada
   projeto do Google Cloud também aceita só a branch do ambiente (`deploy_branch` no Terraform).
6. **Branches protegidas por rulesets do GitHub.** `staging` e `main` não podem ser apagadas nem
   receber force push. "Apagar a branch ao mergear" fica ligado para as branches de feature; a
   regra de não apagar protege `staging` e `main` (verificado com uma branch de teste: a branch
   protegida sobreviveu ao merge da PR que partiu dela).
7. **Correção urgente segue o mesmo fluxo**, só que sem esperar: branch de feature, PR na `staging`,
   release logo em seguida. Não há atalho para a `main`, e a `main` não recebe PR (o CI reprova).

## Consequências

- O staging pode ficar à frente da produção por dias. Quem faz a release leva tudo o que está na
  `staging`: não dá para liberar uma feature sozinha sem tirar as outras antes (reverter na
  `staging` ou esperar).
- A produção não reconstrói a imagem: o deploy de produção copia, do registry da `staging` para o de
  produção, a imagem desse mesmo commit (digest conferido) e os dois ambientes publicam por digest, não
  por tag. O artefato que passou na `staging` é o que roda em produção (SPEC 013, E1.12). A conta de
  deploy de produção só lê o registry da `staging`.
- Migrations rodam primeiro no staging, contra um banco com a forma de produção, antes de chegarem à
  produção. Como são aditivas, a ordem entre migration e código continua segura.
- A história é linear: a `main` é sempre um prefixo da `staging`, sem commit de merge. O registro de
  cada liberação são os runs de Deploy aprovados.
- O CI roda também no push da `staging`, dentro do run de Deploy; o `ci.yml` só dispara sozinho em PR.
