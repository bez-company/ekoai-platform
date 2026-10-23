# ADR 0017: eventos de produto pelo servidor, por conta

## Contexto

A SPEC 010 (fase 5) prevê o PostHog ligado, e o BEZ-44 pede PostHog e Sentry no navegador com banner de
consentimento (LGPD) e CSP revista. O banner é tela nova e depende de protótipo. Enquanto isso, o
produto não mede nada: quantas ideias viram post, quantos posts são aprovados, publicados ou falham,
quem convida a equipe.

## Decisão

- Os eventos de produto saem **do servidor** (`posthog-node`, `platform/src/lib/analytics.ts`), nas rotas
  e no `publish.ts`, depois que a ação deu certo. Nada carrega no navegador: sem cookie, sem script,
  sem banner para esta parte.
- O evento é **da conta**, não da pessoa: `distinct_id = tenant:<id>`, propriedades só de produto
  (`channel`, `role`, `kind`, contagens e booleanos). Nenhum e-mail, nome, id de pessoa ou texto de post.
  Sem GeoIP. Sem o adicional pago de grupos: a "pessoa" do PostHog é a conta.
- Liga só com `POSTHOG_KEY` (segredo `posthog-key` no Secret Manager, como o `sentry-dsn`). O
  placeholder em branco do Terraform deixa tudo em no-op; o valor real só entra em produção. Cada
  evento leva `environment` (o mesmo `SENTRY_ENVIRONMENT`).
- O envio é aguardado dentro da requisição (no Cloud Run a CPU some quando a resposta sai), com
  2 s de limite e sem nova tentativa: perder um evento é aceitável, segurar a aprovação de um post não.
  Falha vira aviso no log e nunca derruba a rota.

Eventos: `signed_in`, `invitation_sent`, `invitation_accepted`, `onboarding_item_updated`,
`idea_approved`, `idea_rejected`, `idea_rework_requested`, `post_approved`, `post_rejected`,
`post_published`, `post_publish_failed`, `engagement_published`, `data_exported`, `account_deleted`.

Scorecard (BEZ-260): `account_created`, `post_requested`, `post_ready`, `post_generation_failed`, `cost_by_step`,
`rework`, `suggestion_viewed`, `suggestion_accepted`, `suggestion_replaced`, `suggestion_skipped`. Contrato por evento no
`docs/runbook.md` (Observabilidade). `published_success` e `published_failure` ficam reservados até o BEZ-258. Toda
propriedade passa por `sanitizeProps`: string que parece e-mail, token ou texto de post é removida antes do envio.

## Consequências

- O funil do produto (ideia → aprovação → publicação) fica visível por conta, sem tela nova.
- Navegação, tempo em tela e erros de tela continuam fora: isso é o BEZ-44 (banner, PostHog no
  navegador em `cookieless_mode: "on_reject"`, Sentry no navegador e CSP).
- Até 2 s a mais numa rota quando o PostHog está lento; no caminho normal, uma chamada curta.
- Base legal: legítimo interesse para métrica de uso do serviço, sem dado pessoal no evento. A
  política de privacidade, quando publicada, cita o PostHog como operador.
- Gasto: limites da organização no PostHog (US$ 1 em eventos, US$ 0 no resto).
