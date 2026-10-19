# Runbook de operação

O que fazer quando algo precisa de mão humana. Cada item diz o que existe hoje; o que ainda
não existe está marcado como **pendente** e aponta para a [SPEC 006](specs/006-fundacao-saas.md).

## Pausar e retomar a publicação

`/settings` > Publicação. A pausa é **por tenant**: o scheduler (`/api/cron/publish-due`) pula o
tenant pausado e segue com os outros. Os agendados vencidos esperam e saem juntos no primeiro
ciclo depois de retomar. Todo tenant novo nasce pausado (migration 0013).

## Saber se está de pé

- `GET /api/health`: 200 se o app alcança o banco, 503 se não. Não expõe detalhe. Aponte um
  monitor externo (UptimeRobot, Better Stack) para ele. **Pendente:** monitor ainda não ligado.
- Logs: o Cloud Logging guarda uma linha JSON por evento (`severity`, `scope`, `message`); campos com
  token, senha, chave ou email saem como `[mascarado]`. Procure por `"level":"error"`.
- Falha de publicação: cada tentativa vira um aviso da conta (`notifications`), e o item vira
  `failed` depois de 3. `/calendar` tem o botão de tentar de novo.

## Criar um tenant (piloto ou cliente)

```bash
npm run tenant:create -- --id acme --name "Acme Engenharia"
```

Cria a linha em `tenants` e deixa a publicação pausada. Depois: perfil do tenant em
`src/tenant.js`, um deploy da plataforma com `TENANT_ID=acme`, slots em `/settings`, retomar, e
um job do Actions com o mesmo `TENANT_ID`. **Pendente:** perfil no banco e login por usuário
(F2 e F3), que tiram a necessidade de um deploy por tenant.

## Exportar os dados de um tenant (LGPD)

Logado no tenant, `/settings` > Seus dados > Baixar meus dados. Vem um JSON com todas as
tabelas do tenant. Credenciais de rede não ficam no banco, então não saem no arquivo.
**Pendente:** apagar os dados de um tenant (precisa de fluxo com confirmação e prazo).

## Migrations

Entram só pelo CI: o job `migrate` do Cloud Run roda `scripts/migrate.js` antes de cada deploy (fase 4 da SPEC 010; até lá, `npm run migrate`). Antes
disso, a PR aplica todas duas vezes num Postgres limpo e roda `supabase/ci/rls_test.sql`.
Migration é aditiva; apagar coluna ou tabela exige `-- allow-destructive` no arquivo.
Nunca aplicar à mão em produção.

## Segredos

| Segredo | Onde | Como girar |
|---|---|---|
| `AUTH_SECRET`, `PLATFORM_PASSWORD` | Secret Manager (Cloud Run) | trocar o valor e redeploy; as sessões caem |
| `CRON_SECRET` | Secret Manager e Cloud Scheduler | trocar nos dois; sem ele o endpoint do cron recusa tudo |
| `DATABASE_URL` (senha do banco) | Secret Manager | trocar a senha do usuário no Cloud SQL e a versão do segredo |
| tokens do Instagram e do LinkedIn | secrets do repo | `refresh-tokens.yml` renova sozinho; vence em ~60 dias |

Segredo colado em chat ou log: girar sempre. **Pendente:** inventário com data da última rotação.

## Banco e backup

**Pendente.** O banco de produção precisa ser recriado (ver `infra-producao-estado` na memória
do projeto). Antes do primeiro cliente de fora: plano com backup diário e um restore
**executado** num banco de teste, não só documentado (gate 8 da esteira).

## Ambientes

Dois projetos do Google Cloud, `ekoai-staging` e `ekoai-prod`, com o mesmo Terraform
([SPEC 010](specs/010-migracao-google-cloud.md), D1). **Pendente:** os projetos ainda não foram
criados (fase 0); não há ambiente publicado.
