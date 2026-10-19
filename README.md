# Ekoai

Plataforma onde empresas cuidam do Instagram: criam a conta, contam sobre a empresa, chamam a
equipe, conectam a rede, aprovam e agendam posts. Plataforma web em `platform/` (Next.js),
jobs de apoio em `src/` (Cloud Run Jobs), Postgres com RLS por conta.

O produto é genérico: nenhuma marca de cliente mora no código
([ADR 0010](docs/adr/0010-plataforma-generica-sem-pilar-no-codigo.md)). A fase atual estrutura a
plataforma ([SPEC 011](docs/specs/011-plataforma-generica-fase-1.md)); a criação de posts com IA
volta na fase 2, como agentes de imagem para o Instagram. O pipeline antigo, feito para um cliente
só, está na tag `pilar-v1`.

## O que existe hoje

- Login por pessoa (Identity Platform) e três papéis por conta: administrador, criador e leitor
- Inbox de aprovação, agenda por horários fixos e publicação no horário (`/api/cron/publish-due`)
- Histórico com métricas coletadas da rede e relatório semanal como aviso no app
- Pausa por conta, exportação dos dados da conta
- Publicação no Instagram (o código de LinkedIn e X existe, fora do menu até a vez deles)

## Setup rápido

1. `npm install` na raiz e em `platform/`
2. Copiar `.env.example` para `.env` e preencher
3. `npm test`
4. Detalhes em [SETUP.md](./SETUP.md) e operação em [docs/runbook.md](docs/runbook.md)

## Scripts

| Comando | O que faz |
|---|---|
| `npm test` | Testes (Vitest) |
| `npm run test:db` | Testes contra um Postgres com as migrations (`TEST_DATABASE_URL`) |
| `npm run migrate` | Aplica as migrations pendentes |
| `npm run metrics` | Coleta métricas e grava o relatório semanal (job `weekly-report`) |
| `npm run refresh-tokens` | Renova os tokens das redes (job `refresh-tokens`) |
| `npm run tenant:create` | Cria uma conta (nasce pausada) |
| `npm run access:grant` | Dá acesso a uma pessoa numa conta, sem tela |

## Estrutura

```
platform/    plataforma web (Next.js)
src/         jobs: métricas, renovação de token, migrations (src/jobs.js)
packages/db/ acesso ao Postgres (@ekoai/db)
docker/      imagens da plataforma e dos jobs (Cloud Run)
supabase/    migrations e testes de RLS (a pasta vira db/ no fim da SPEC 010)
docs/        specs, ADRs, arquitetura e análises
.github/     CI (testes, migrations, RLS, imagens)
```
