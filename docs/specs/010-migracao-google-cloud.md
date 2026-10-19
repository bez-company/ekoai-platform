# SPEC 010: migração para o Google Cloud da BEZ

- **Status:** aprovada em 2026-10-19 (2 projetos, Cloud Run no lugar da Vercel). Fases 1 e 2 implementadas (ver o registro no fim); fase 0 e seguintes esperam o Google Cloud
- **Data:** 2026-10-19
- **Depende de:** [ADR 0006](../adr/0006-google-cloud-como-plataforma.md) (Google Cloud),
  [ADR 0007](../adr/0007-tres-papeis-de-conta.md) (papéis), [SPEC 008](008-banco-portavel-e-papeis.md),
  [SPEC 009](009-login-por-pessoa.md), [arquitetura SaaS](../arquitetura/README.md)
- **Escopo:** levar o que existe hoje para o Google Cloud com paridade de comportamento. Feature
  nova do produto (convites, ledger, console do ultra admin, billing) fica fora e segue as SPECs
  próprias, depois do cutover.

## Problema

O produto roda, no papel, em três lugares que não vão ficar: Supabase (banco, auth, storage),
Vercel (plataforma e cron) e GitHub Actions (8 workflows de job). Nada disso está no ar hoje: o
banco antigo sumiu, os workflows estão desligados e a Vercel trava por limite de build.

A BEZ agora tem organização no Google Cloud (`bezcompany.com.br`), conta de
faturamento em modo de teste e orçamento com alerta. O que falta é o produto caber nela.

## Estado de partida (medido no repo em 19/10/2026)

| Peça | Estado | Leitura |
| --- | --- | --- |
| Schema | 16 migrations, rodam em Postgres 17 puro, RLS testado no CI | pronto para o Cloud SQL |
| Identidade e papéis | `users`, `app.current_user_id()`, `role_permissions`, login por Identity Platform contra o emulador | pronto, falta o projeto real |
| Acesso a dados | 101 chamadas `.from()` do `supabase-js` em 19 arquivos, na raiz e na plataforma | **maior trabalho da migração** |
| Storage | 1 uso (`src/utils/storage.js`, bucket `post-images`), `next.config` aceita `*.supabase.co` | troca pequena |
| Jobs | 8 workflows do GitHub Actions; `post` e `resolve` ainda commitam `content/*.yaml` de volta no repo | o commit não existe em container: o estado tem que viver só no banco |
| Segredos | GitHub Secrets; `refresh-tokens` regrava o segredo por `GH_ADMIN_TOKEN` | vira Secret Manager com nova versão |
| Plataforma | Next 15, sem `output: standalone`, sem Dockerfile | falta containerizar |
| Infra como código | não existe | tudo escrito do zero |
| GCP | org criada, só o `My First Project` padrão, 28 APIs ligadas, sem Cloud SQL, Identity Platform, Scheduler, KMS ou Secret Manager | fundação por fazer |

Permissões conferidas: o usuário da BEZ é `organizationAdmin` e o domínio tem `projectCreator`,
então criar projeto e pasta não depende de ninguém.

## Decisões (recomendação minha; vira ADR quando aprovada)

| # | Decisão | Recomendação | Por quê |
| --- | --- | --- | --- |
| D1 | Projetos | pasta `ekoai` com `ekoai-staging` e `ekoai-prod`; o bucket do estado do Terraform e o Artifact Registry ficam no `ekoai-prod` (versionado, com proteção contra exclusão) | IAM, Identity Platform e faturamento separados; erro em staging não toca dado de cliente (ADR 0006 item 1). Sem projeto de admin: complexidade a mais para uma pessoa. `My First Project` vira sandbox e é apagado no fim |
| D2 | Cliente SQL | `pg` + pacote próprio `@ekoai/db` com a forma do supabase-js ([ADR 0008](../adr/0008-acesso-ao-postgres-sem-supabase-js.md)); era Kysely | o uso real é pequeno e uniforme (tabela única, sem join); manter a forma troca só o import e preserva o comportamento. Kysely entra depois, se houver join |
| D3 | Conexão do Cloud Run com o Cloud SQL | IP privado (VPC direta do Cloud Run) com login IAM de banco, sem senha em segredo | some a senha do banco do cofre de segredos e o IP público |
| D4 | Migrations | Cloud Run Job `migrate`, disparado pelo CI após o deploy do staging e antes do prod | substitui `supabase db push` (ADR 0003); mantém o guard de comando destrutivo |
| D5 | Deploy | GitHub Actions com Workload Identity Federation, sem chave JSON | política de organização barra chave de service account |
| D6 | Segredos das redes | Secret Manager (uma versão nova por refresh) enquanto o produto é de um tenant | Cloud KMS por conta no banco é da fundação SaaS (SPEC 006 F3), não da migração |
| D7 | Estado dos jobs | só no banco (`STATE_BACKEND=postgres`); no Cloud Run o job recusa subir sem ele (`assertStateBackend`); o caminho YAML sai na fase 7, junto dos workflows | container é efêmero e não tem credencial para commitar. Remover o YAML agora mexeria em 10 arquivos sem ganho: em produção ele nunca roda |
| D8 | Staging | Cloud SQL ligado só quando há teste (parado paga só disco) | dois bancos 24 horas podem passar do orçamento de R$ 100 por mês (que só alerta) |
| D9 | Hospedagem | Cloud Run no lugar da Vercel (confirmado); sem preview por PR no início, tags de revisão depois | ADR 0006 |
| D10 | Domínio | `*.run.app` até o `ekoai.com.br` migrar para a BEZ; borda (Load Balancer + Cloud Armor) só com domínio | domínio ainda é pendência da BEZ |

## Fases

Cada fase termina verificada e mergeável sozinha. As fases 1 e 2 são só código e não cobram nada,
então podem andar em paralelo com a 0.

### Fase 0: fundação da conta (cobra centavos)

- Pasta e 2 projetos sob a organização, faturamento ligado, orçamento por projeto, alerta no e-mail
  da BEZ.
- Política de organização: sem chave de service account, sem IP público em Cloud SQL, região
  restrita a `southamerica-east1`.
- Bucket do estado do Terraform (versionado) e Artifact Registry no `ekoai-prod`.
- APIs necessárias ligadas por Terraform, não à mão.
- Service accounts por função (plataforma, jobs, migrate, deploy), cada uma com o mínimo.
- **Verificação:** `terraform plan` limpo; `gcloud` mostra a estrutura; nenhum recurso fora do Terraform.

### Fase 1: camada de dados sem Supabase (código, sem custo)

- `src/db/` com pool `pg` e Kysely; `withUser(userId, tenantId, fn)` abre transação e faz
  `set_config('app.user_id', ...)`. Mesmo cliente na raiz e na plataforma (pacote compartilhado
  ou módulo importado, a decidir na implementação).
- `tenantDb` reescrito sobre o Kysely mantendo a assinatura; os 19 arquivos migram um a um.
- Storage: `@google-cloud/storage`, bucket privado, URL assinada para a Meta e para a tela;
  `next.config` troca o `remotePatterns`.
- `STATE_BACKEND=postgres`; remover o caminho YAML e os passos de commit dos workflows.
- **Verificação:** a suíte atual passa contra o Postgres do CI; `tenant-scope.test.js` continua
  barrando `db()` cru; `rls_test.sql` passa e reprova as mutações já provadas.

### Fase 2: containers (código, sem custo)

- `platform/Dockerfile`: Next `output: standalone`, usuário sem root, `HEALTHCHECK` no
  `/api/health`.
- `Dockerfile` dos jobs: Node 22 com Chromium para o `puppeteer` (render de imagem e carrossel);
  um entrypoint por job (`post`, `resolve`, `reflect`, `metrics`, `refresh-tokens`, `funnel`,
  `token-health`, `migrate`).
- **Verificação:** `docker run` local de cada imagem contra o Postgres local, `DRY_RUN=true`;
  imagem passa em scan de vulnerabilidade no CI.

### Fase 3: staging no Google Cloud

- Terraform (`infra/terraform`, módulos e `envs/staging`, `envs/prod`): VPC e acesso privado,
  Cloud SQL Postgres 17 (backup diário, PITR, proteção contra exclusão), Cloud Run service e
  jobs, Cloud Scheduler (8 agendas, mesmos horários dos workflows), GCS, Secret Manager,
  Identity Platform, alertas.
- Mapa de substituição: `post` → job + Scheduler `0 20 * * 2,4`; `publish-due` → Scheduler `*/10`
  chamando `/api/cron/publish-due` com OIDC no lugar de `CRON_SECRET`; `resolve`, `reflect`,
  `refresh-tokens`, `token-health-check`, `weekly-report`, `funnel` → job + Scheduler.
- **Verificação:** migrations aplicadas no Cloud SQL; `rls_test.sql` rodado contra ele; login real
  (Identity Platform) e um post `DRY_RUN` de ponta a ponta; restore de backup **executado**, não
  só configurado.

### Fase 4: CI/CD

- Workload Identity Federation limitado ao repositório e à branch; build da imagem, push no
  Artifact Registry, deploy do staging na `main`, prod por aprovação no environment `Production`.
- Job `migrate` entra antes do deploy; `CI ok` continua agregando tudo; `supabase db push` e o
  segredo `SUPABASE_DB_URL` saem.
- **Verificação:** merge de uma mudança trivial chega ao staging sem passo manual; rollback para a
  revisão anterior do Cloud Run testado.

### Fase 5: observabilidade e segurança

- Sentry (`ekoai`, já criado) e PostHog (projeto 674036) ligados; logs estruturados no Cloud
  Logging; alertas de erro 5xx, job falho, latência e Cloud SQL sem espaço; uptime check.
- Cloud Armor e Load Balancer só quando o domínio existir (D10).
- **Verificação:** erro forçado aparece no Sentry; job falho dispara e-mail; alerta testado.

### Fase 6: produção e cutover

Não há dado a migrar (o banco antigo não existe). O cutover é criar, não mover:

1. Aplicar o Terraform do prod, criar o tenant Pilar (`tenant:create`) e o primeiro admin
   (`access:grant`).
2. Gravar os tokens das redes no Secret Manager e rodar `token-health` uma vez à mão.
3. Ligar o Scheduler um job por vez, começando por `publish-due`; um `DRY_RUN` do `post` antes do
   real.
4. Só então desligar de vez os workflows do GitHub e pausar o projeto da Vercel.

**Rollback:** pausar os jobs do Scheduler (um comando); a plataforma sem job não publica nada.

### Fase 7: desligar o legado

Remover `@supabase/supabase-js`, `supabase/ci/bootstrap.sql` (papéis falsos do Supabase) se nenhum
teste ainda os usar, os 8 workflows, o projeto da Vercel e o Supabase da Trinity; atualizar
README, SETUP, runbook e o cofre. Apagar o `My First Project`.

## Fora do escopo

- Telas (login, equipe, convite): protótipo no Claude Design primeiro.
- Billing (Asaas), ledger de uso, KMS por conta, console do ultra admin, convites.
- Borda com Cloud Armor e CDN antes de ter domínio.
- Mover dado de produção anterior (não existe).

## Riscos

| Risco | Impacto | Mitigação |
| --- | --- | --- |
| **O teste de 90 dias do GCP vence por volta de 17/01/2027, dois dias antes do T0 (19/01/2027)** | recursos suspensos no lançamento | ativar a conta paga (upgrade do faturamento) até o fim de dezembro e reavaliar o orçamento |
| Cloud SQL ligado 24 horas pode passar de R$ 100 por mês (o orçamento só alerta, não corta) | e-mails de alerta e fatura acima do previsto | staging sob demanda (D8); ajustar o teto do prod com o custo real medido na fase 3 |
| 101 chamadas reescritas à mão | regressão silenciosa em consulta | migrar arquivo por arquivo com o teste existente e o `rls_test.sql` como rede; sem big bang |
| Chromium do `puppeteer` em Cloud Run | estouro de memória ou fonte faltando | job com 2 GiB, teste de render na fase 2 contra os `tests/render.test.js` |
| Repositório ainda em `MRezende0` e público | confiança do WIF presa a um nome que vai mudar | transferir para `bez-company` antes da fase 4; nunca commitar ID de projeto sensível ou e-mail (repo público) |
| Preço de São Paulo e latência do Vertex não verificados | custo e modelo diferentes do previsto | conferir na calculadora oficial antes de criar o prod; manter a chave Gemini atual até medir |

## Critérios de aceite

- [ ] Nenhuma chamada a `supabase-js`, nenhuma referência a `SUPABASE_*` e nenhum `.from()` no código.
- [ ] Toda a infra criada por Terraform; `plan` sem diferença; nenhuma chave JSON de service account.
- [ ] Merge na `main` publica no staging e roda as migrations sem passo manual.
- [ ] Os 8 agendamentos rodam pelo Cloud Scheduler com os horários dos workflows antigos.
- [ ] Restore de backup do Cloud SQL executado e documentado no runbook.
- [ ] Login real, um post de ponta a ponta no staging e um no prod, e um alerta de falha recebido.
- [ ] Custo mensal medido por 30 dias e comparado ao orçamento.
- [ ] Workflows do GitHub e Vercel desligados; runbook e README atualizados.

## O que depende do Matheus

| Quando | O quê |
| --- | --- |
| Antes da fase 0 | D1 a D10 aprovadas em 19/10/2026 |
| Fase 0 | confirmar a criação dos projetos e o vínculo ao faturamento (cobram do crédito) |
| Fase 3 | habilitar o Identity Platform (provável aceite de termos no console; confirmo se dá por API) |
| Fase 4 | transferir o repo para `bez-company` |
| Fase 6 | tokens das redes (Instagram, LinkedIn, X) e confirmação antes de ligar o primeiro job real |
| Até dez/2026 | upgrade do faturamento para conta paga |

## Registro de implementação (2026-10-19)

### Fase 1: camada de dados (feita)

- `packages/db` (`@ekoai/db`, [ADR 0008](../adr/0008-acesso-ao-postgres-sem-supabase-js.md)):
  construtor de consulta, schema cache, `withUser`, formato de timestamp e bigint do PostgREST,
  caminho em jsonb (`funnel->ativados`, `utm->>content`).
- Os 101 pontos migrados: `src/utils/db.js` (`getDb`, `usingDb`, `closeDb`, `assertStateBackend`),
  `platform/src/lib/db.ts`, `tenantDb`, scripts `create-tenant`, `grant-access`, `backfill-db`.
  `STATE_BACKEND=postgres` e `DATABASE_URL` no lugar de `SUPABASE_*`. `@supabase/supabase-js` saiu
  dos dois `package.json`.
- Mídia ([ADR 0009](../adr/0009-midia-em-bucket-privado-servida-pela-plataforma.md)):
  `src/utils/storage.js` grava no Cloud Storage; `/api/media/<chave>` serve (pública, só chave com
  UUID, `Range`).
- Few-shot: os exemplos que a coleta de métricas gravava em `content/examples/auto-*` e o workflow
  commitava passam a ser calculados dos posts no banco (`src/utils/examples.js`). Sem isso o ciclo
  de aprendizado quebraria no container.
- `src/jobs.js`: um ponto de entrada para os 7 jobs dos workflows (`post`, `resolve`, `reflect`,
  `refresh-tokens`, `token-health`, `weekly-report`, `funnel`) mais `engage`, `repurpose`, `reel` e
  `migrate`.
- `scripts/migrate.js`: executor de migrations com `schema_migrations` (checksum), uma transação por
  arquivo, advisory lock, `--dry-run`, bootstrap em banco vazio. Substitui o `supabase db push`.
- `log.ts` emite `severity` para o Cloud Logging; `/api/health` faz `select 1`.

### Fase 2: containers (feita)

- `docker/platform.Dockerfile` (Next standalone, usuário `node`, `HEALTHCHECK`) e
  `docker/jobs.Dockerfile` (Node 22, Chromium e fonte Inter, `tini`), mais `.dockerignore`.
- CI: jobs `data-layer` (Postgres 17, `npm run migrate` e `npm run test:db`) e `containers` (build
  das duas imagens). O job de migrations em produção com o CLI do Supabase foi removido; o
  equivalente vem na fase 4.

### Verificado

- 341 testes da suíte, 37 contra Postgres real (`npm run test:db`), typecheck e build da plataforma,
  `npm audit --omit=dev` com 0 na raiz (a plataforma mantém só o PostCSS do Next 15, já conhecido).
- Em container, contra Postgres 17: `migrate` aplicou as 16 migrations num banco vazio, `reflect`
  rodou, `/api/health` respondeu 200, o job recusou subir no Cloud Run sem `STATE_BACKEND=postgres`,
  e o Chromium da imagem renderizou um PNG que subiu para o bucket.

### Não verificado (fica para a fase 3, com o Google Cloud de verdade)

- Leitura da mídia contra o Cloud Storage real: o emulador (fake-gcs-server) não responde ao
  `getMetadata` do cliente v8 (pede `/b/...` sem `/storage/v1`), então a rota foi testada com
  arquivo simulado e só o upload foi exercitado de ponta a ponta.
- Papel do banco no Cloud SQL: o bootstrap tem um ramo sem `bypassrls` que não foi exercitado. A
  aplicação ignora o RLS por ser dona das tabelas, o que exige que o `migrate` e a plataforma usem
  o mesmo usuário de banco. Confirmar no spike.
- `refresh-tokens` ainda grava o token novo no GitHub Secrets (`utils/github-secrets.js`); vira
  Secret Manager (D6) na fase 3.
- O cron `publish-due` segue com `CRON_SECRET`; a troca por token OIDC do Scheduler é da fase 3.
