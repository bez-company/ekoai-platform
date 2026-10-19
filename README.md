# post-automation

Automação de postagens Instagram + LinkedIn pra SaaS B2B. Geração via Gemini, aprovação na plataforma web (`platform/`), publicação no horário agendado.

## O que faz

- Roda 3x/semana (seg/qua/sex 9h BRT)
- Lê próximo post da fila (`content/queue.yaml`) ou gera ideia automática baseada em pilar
- Pede 3 variações ao Claude (few-shot com seus high-performers)
- Renderiza um preview de imagem por variação via Puppeteer
- **Fase gerar** (`post.yml`): salva a pendência de cada rede e avisa na plataforma que há
  post para aprovar
- **Inbox da plataforma**: você aprova, rejeita ou pede nova versão; aprovar agenda o post
- **Fase resolver** (`resolve.yml`, cron a cada 10min na janela útil): gera as novas versões
  pedidas na plataforma
- Avisos (pronto para aprovar, agendado, publicado, falhou, relatório) ficam em
  `notifications` (SPEC 007)
- Publica em IG e LinkedIn e atualiza histórico (`content/published.yaml`)

## Setup rápido

1. `npm install`
2. Copiar `.env.example` → `.env` e preencher
3. `npm run dry-run` (testa pipeline sem APIs externas)
4. Detalhes completos em [SETUP.md](./SETUP.md)

## Scripts

| Comando | O que faz |
|---|---|
| `npm test` | Roda testes Vitest |
| `npm run dry-run` | Pipeline completo mockando APIs externas |
| `npm run publish:test` | Posta 1 item hardcoded em sandbox (precisa credencial) |
| `npm start` | Fase gerar: gera, salva a pendência e avisa (job `post`) |
| `npm run resolve` | Fase resolver: gera as novas versões pedidas na plataforma (job `resolve`) |
| `npm run metrics` | Coleta insights da semana (TODO) |
| `npm run refresh-tokens` | Renova tokens IG + LinkedIn |

## Estrutura

```
docs/        estratégia (ICP, dores, voice) — lida pelos prompts
content/     campanhas e exemplos curados (a fila e o histórico moram no Postgres)
prompts/     system + canais + pilares
templates/   HTML/CSS pra render via Puppeteer
src/         lógica
packages/db/ acesso ao Postgres (@ekoai/db)
docker/      imagens da plataforma e dos jobs (Cloud Run)
supabase/    migrations e testes de RLS (a pasta vira db/ no fim da SPEC 010)
.github/     CI (testes, migrations, imagens)
```

## Estado atual

- [x] Estrutura base + geração + aprovação na plataforma
- [x] Publicação Instagram + LinkedIn (single image + carrossel)
- [ ] Reels (fase 2)
- [ ] Métricas e ajuste automático do mix de pilares
- [x] Plataforma web (inbox, agenda, histórico)

## Custo mensal estimado

| Item | Custo |
|---|---|
| Claude API | R$ 5–15 |
| Google Cloud (Cloud Run, Cloud SQL, Scheduler) | a medir na fase 3 da SPEC 010 |
| **Total** | **< R$ 20** |
