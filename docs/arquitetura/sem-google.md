# O que decidir e construir antes do Google Cloud (16/10/2026)

> Tudo aqui roda num Postgres local (Docker) e no emulador do Firebase Auth, sem conta, cartão
> nem projeto no Google. Tamanho: P (até 1 dia), M (2 a 4 dias), G (1 semana ou mais).
> Estimativas minhas.

## Decisões

| # | Decisão | Recomendação | Por que agora |
| --- | --- | --- | --- |
| 1 | Login: Identity Platform direto ou Supabase Auth agora e trocar depois | **Identity Platform direto**, desenvolvido contra o emulador local | a F2 feita no Supabase Auth seria refeita na migração |
| 2 | Quem guarda a pessoa: `auth.users` do Supabase ou tabela própria | **tabela `users` própria** (id, e-mail, id do provedor) | tira a última amarra do banco ao Supabase |
| 3 | Planos: nomes, limites e preço | medir antes o custo por campanha (Gemini, imagem, X), com a chave que já existe | preço sem custo medido é chute (ADR 0004) |
| 4 | Teste grátis: duração, o que libera, o que acontece no fim | usar a retenção pós-teste da Pilar como ponto de partida | define o ledger de uso e os avisos de cobrança |
| 5 | Parecer do leitor obrigatório antes de aprovar? | **opcional por conta** (padrão: não) | muda o fluxo da inbox |
| 6 | E-mail do ultra admin | e-mail pessoal, fora da Labrynth | entra na migration de `platform_admins` |
| 7 | Provedor de e-mail transacional | **Gmail API no Workspace da BEZ** ([ADR 0027](../adr/0027-email-transacional-pelo-gmail-api-no-workspace-da-bez.md), 28/10/2026) | o Google Cloud não tem e-mail transacional próprio; o Workspace já tem os domínios, SPF, DKIM e DMARC |

Dependem da reunião com a advogada: nome, domínio, CNPJ da BEZ, termos de uso PF e PJ.

## Construção, em ordem

| # | Entrega | Tamanho | Verificação |
| --- | --- | --- | --- |
| 1 | Spike do banco local: migrations em Postgres puro, `auth.uid()` vira `app.user_id` por transação | M | `rls_test.sql` passa e reprova as mutações |
| 2 | Papéis em três níveis: `admin`, `creator`, `viewer`; `role_permissions`; `app.can`; regra do último administrador | M | teste de RLS cobre a matriz do desenho 04 |
| 3 | Tabela `users` própria e login por pessoa no emulador do Identity Platform, com sessão por cookie e MFA | G | login, troca de conta e logout testados; tela só depois do protótipo |
| 4 | Audit log só de inserção | P | teste reprova `update` e `delete` |
| 5 | Ultra admin: `platform_admins` de uma linha, portões, rota do console vazia | M | testes de exclusividade do [ultra-admin.md](ultra-admin.md) |
| 6 | Convites (token com hash, 7 dias, uso único) e pareceres (`reviews`) | M | teste de convite expirado, reusado e de outro tenant |
| 7 | Avisos por papel: `audience` e leitura por pessoa | P | cada papel lê só os seus |
| 8 | Camada de dados sem `supabase-js` (cliente SQL) nas 19 arquivos | G | os testes atuais passam contra o Postgres local |
| 9 | Ledger de uso e custo por conta, e limites do plano checados no servidor | M | limite estourado bloqueia no servidor |
| 10 | Dockerfiles da plataforma e dos jobs, Terraform escrito (`validate`, sem `apply`) | M | `docker run` local; `terraform validate` |
| 11 | Evals de geração no CI (10 a 15 briefs fixos) | M | nota mínima do judge por caso |

Itens 1 e 2 destravam quase todo o resto e não têm tela.

## Em paralelo, com você

- Protótipos no Claude Design com o briefing de [usuario.md](usuario.md): login, equipe, convite,
  onboarding, avisos, parecer do leitor e console do ultra admin.
- Reunião com a advogada: nome, domínio, CNPJ, termos e o direito de arrependimento na PF.

## O que espera o Google Cloud ou o CNPJ

- **Google Cloud:** projeto, Cloud SQL, Identity Platform real, Cloud Run, Scheduler e Tasks, KMS,
  IAP, deploy.
- **CNPJ e domínio:** Asaas em produção, app review da Meta e do LinkedIn, e-mail com domínio
  próprio, URLs de callback do OAuth das redes.
