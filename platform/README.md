# Cockpit — plataforma do post-automation

UI web (Next.js App Router) de aprovação.
Você aprova, escolhe legenda + arte, **edita o texto** e **agenda** — a publicação sai
no horário marcado (não na hora da aprovação). Os avisos vão para `notifications` (SPEC 007).

## Arquitetura

```
Inbox (pending_approvals)  →  aprovar + agendar  →  scheduled_posts (status=scheduled)
                                                          │ Cloud Scheduler */10min
                                                          ▼
                                              /api/cron/publish-due
                                                  publica IG/LinkedIn
                                                  grava em `posts` (reusa observabilidade)
                                                  → status=published | failed
                                                  → grava um aviso em `notifications`
```

- **Acesso ao DB**: service_role só no server (Server Components / Route Handlers / cron).
  O browser nunca toca o banco. RLS continua fechado, sem policy nova.
- **Auth**: gate single-user por senha (`PLATFORM_PASSWORD`) + cookie assinado (HMAC).
- **Agendamento**: slots editoriais fixos (`publish_slots`). Aprovar cai no próximo slot
  livre do canal; dá pra sobrescrever com horário manual e remarcar na Agenda.
- **Por que `scheduled_posts` e não status em `posts`**: `posts` alimenta o bandit;
  um post não-publicado contaminaria o aprendizado. A fila vive em tabela separada e
  só vira `posts` no momento da publicação.

## Setup

### 1. Migrations

As migrations ficam em `../supabase/migrations/` (o nome da pasta é herança; ela vira `db/` no
fim da [SPEC 010](../docs/specs/010-migracao-google-cloud.md)). Toda PR testa todas num Postgres
limpo (`.github/workflows/ci.yml`, ADR 0003). Quem aplica é o executor `scripts/migrate.js`, que
guarda o que já rodou em `schema_migrations`:

```bash
DATABASE_URL=postgres://... npm run migrate -- --dry-run   # na raiz: lista o que falta
DATABASE_URL=postgres://... npm run migrate                # aplica
```

Em produção o executor roda como o job `migrate` do Cloud Run, antes de cada deploy (fases 3 e 4
da SPEC 010). Migration nova: próximo número da sequência, aditiva e idempotente
(`if not exists`, `drop ... if exists` antes de `create trigger`). Comando que apaga dado exige
`-- allow-destructive` no arquivo. Migration já aplicada não se edita: o executor recusa.

Confira: `npm run check:db` deve listar as tabelas com a contagem de linhas.

### 2. Variáveis

Copie `.env.local.example` para `.env.local`. O essencial é `DATABASE_URL` (Postgres com as
migrations aplicadas) e, para mídia, `STORAGE_BUCKET` (bucket privado do Cloud Storage; a rota
`/api/media` lê dele). Em produção as variáveis vêm do Cloud Run.

### 3. Rodar

```bash
npm install
npm run dev        # http://localhost:3000 (login: PLATFORM_PASSWORD)
npm run build      # build de produção (saída standalone)
npm run check:db   # valida conexão + presença das tabelas
```

Imagem de produção (contexto: a raiz do repo, porque a plataforma usa `../packages/db`):

```bash
docker build -f docker/platform.Dockerfile -t ekoai-platform .
docker run --rm -p 8080:8080 -e DATABASE_URL=... ekoai-platform   # /api/health
```

## Deploy (Cloud Run)

A plataforma roda no Cloud Run em São Paulo ([ADR 0006](../docs/adr/0006-google-cloud-como-plataforma.md)).
A infra (Terraform) e o deploy por CI entram nas fases 3 e 4 da SPEC 010; até lá não há ambiente
publicado.

### Scheduler (cron)

O Cloud Scheduler chama `POST /api/cron/publish-due` a cada 10 minutos com
`Authorization: Bearer $CRON_SECRET` (a verificação por token OIDC do Scheduler entra na fase 3).
O workflow `publish-due.yml` do GitHub Actions é o desenho antigo e sai no cutover (fase 6).

## Telas

| Rota | O quê |
|------|-------|
| `/inbox` | pendências aguardando decisão (lê `pending_approvals`) |
| `/inbox/[id]` | aprovar: escolher legenda (editável) + arte + horário |
| `/calendar` | agenda dos `scheduled_posts`: reagendar / cancelar / re-tentar |
| `/history` | posts publicados + engajamento (lê `posts`) |
| `/settings` | gerir a grade de slots editoriais |

## O que mudou no backend Node

O backend Node não publica nem pede aprovação: gera as pendências, atende os pedidos de nova
versão (`resolve.js`) e grava avisos em `notifications`. O Telegram saiu inteiro (SPEC 007).
