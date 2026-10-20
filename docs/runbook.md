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

## Login por pessoa falhando

Toda entrada voltando `401` com `invalid_token`: procure no log o escopo `api/auth/session`,
`api/account` ou `api/invitations/accept`. Aviso `ID token recusado` é rotina (token vencido ou
revogado). Um **erro** com o motivo é problema nosso: o mais provável é a conta de serviço da
plataforma sem `roles/firebaseauth.viewer` (o servidor consulta o usuário no Identity Toolkit para
saber se o token foi revogado), ou o `IDENTITY_PROJECT_ID` errado. Já aconteceu no staging.

## Criar um tenant (piloto ou cliente)

```bash
npm run tenant:create -- --id acme --name "Acme"            # empresa (plano inicial, 5 pessoas)
npm run tenant:create -- --id marina --name "Marina" --kind pessoa   # pessoa (1 pessoa)
npm run access:grant -- --email pessoa@acme.com.br --tenant acme --role admin
```

Cria a linha em `tenants` (publicação pausada) e dá acesso ao primeiro administrador. Depois:
slots em `/settings` e retomar. Os jobs rodam com `TENANT_ID=acme`; sem ele, recusam subir
(ADR 0010). **Pendente:** cadastro, perfil da empresa e convites pela tela (SPEC 011).

## Exportar os dados de um tenant (LGPD)

Logado no tenant, `/settings` > Seus dados > Baixar meus dados. Vem um JSON com todas as
tabelas do conteúdo da conta (perfil, equipe convidada, redes conectadas, auditoria). O token das
redes fica cifrado em tabela à parte e o hash do convite é cortado: nenhum dos dois sai no arquivo.
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
| tokens do Instagram e do LinkedIn | Secret Manager (até o R5 da SPEC 011 levar para o banco, cifrados) | o job `refresh-tokens` renova; vence em ~60 dias |

Segredo colado em chat ou log: girar sempre. **Pendente:** inventário com data da última rotação.

## Banco e backup

**Pendente.** O banco de produção precisa ser recriado (ver `infra-producao-estado` na memória
do projeto). Antes do primeiro cliente de fora: plano com backup diário e um restore
**executado** num banco de teste, não só documentado (gate 8 da esteira).

## Ambientes

Dois projetos do Google Cloud, `ekoai-staging` e `ekoai-prod`, com o mesmo Terraform
([SPEC 010](specs/010-migracao-google-cloud.md), D1). **Pendente:** os projetos ainda não foram
criados (fase 0); não há ambiente publicado.

## Release para produção

Fluxo completo e motivos em [ADR 0013](adr/0013-esteira-feature-staging-producao.md). Resumo:

1. **Staging** recebe tudo por PR de feature (base `staging`). Depois do merge, o deploy de staging é
   automático. Teste lá o que vai sair.
2. **Abrir a release:** `scripts/release.sh` (PR `staging` → `main`, com a lista do que sai).
3. **Mergear com "Create a merge commit"**, nunca squash.
4. **Aprovar o deploy:** o push na `main` roda, no run de Deploy, o CI e depois o job de `prod`, que
   espera no GitHub (Actions > o run de Deploy > Review deployments > `prod`). Sem aprovação, nada muda em produção.
5. **Conferir:** `/api/health` de produção mostra a revisão (`sha-<7 primeiros>`).

**Desfazer:** `gcloud run services update-traffic ekoai-platform --to-revisions=<revisão anterior>=100
--region southamerica-east1` (migrations são aditivas, então o código antigo continua funcionando).
Para tirar a mudança de vez, reverta o commit na `staging` e faça uma nova release.

**Refazer o deploy de um ambiente:** Actions > Deploy > Run workflow, escolhendo a branch do ambiente
(`staging` ou `main`); o environment recusa outra branch.
