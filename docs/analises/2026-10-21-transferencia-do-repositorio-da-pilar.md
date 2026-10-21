# Transferir o repositório da Pilar da Trinity para a BEZ (21/10/2026)

> Análise de leitura, sem mudar nada no repositório, na Vercel nem no Supabase da Pilar. Serve à
> Etapa 4 da [SPEC 013](../specs/013-bez-cloud-platform.md) (BEZ-93). O que não foi verificado está marcado.

## Resposta curta

1. **Transferir, não clonar.** A transferência leva histórico, branches, PRs, issues, segredos, variáveis,
   environments, webhooks e deploy keys, e a URL antiga redireciona. O clone perderia tudo isso, e os
   valores dos segredos não podem ser lidos de volta no GitHub.
2. **A transferência em si não derruba a Pilar.** O app e o site de marketing são servidos pela Vercel
   (`server: Vercel` em `app.pilarsoft.com.br` e `www.pilarsoft.com.br`) a partir dos builds já feitos, e o
   banco, o login e as funções estão no Supabase. Nada disso depende do dono do repositório no GitHub.
3. **O caminho direto existe, e é o ponto frágil.** A Vercel liga cada projeto ao repositório pela instalação
   do app da Vercel na organização **Trinity** (instalado só lá, com acesso a todos os repositórios). Depois
   da transferência o repositório passa a estar numa organização onde o app não está instalado: **os pushes
   param de gerar deploy** até reconectar. O que está no ar continua no ar.
4. **O que realmente pode impedir a reconexão é o plano da Vercel.** Os projetos estão no escopo pessoal
   `mrezende0s-projects`, plano Hobby, que é só para uso não comercial e, segundo relatos da própria
   comunidade da Vercel, não aceita repositório de organização. Hoje funciona com o repositório da Trinity;
   não ficou provado que continuaria funcionando com o da BEZ.

## O que foi verificado

| Item | Resultado | Como |
| --- | --- | --- |
| Dono, visibilidade | `Trinity-Comp4ny/pilar`, **público**, ativo (push de hoje), 13 branches, 10 PRs abertos (9 do Dependabot), 3 issues | `gh` |
| Quem contribui | 100% dos commits recentes são do Matheus (mais o bot do Actions). Carlos Cesar tem papel de admin no repositório, sem commit nenhum | `gh api` |
| Minha permissão | admin no repositório e na organização Trinity | `gh api` |
| O que acompanha a transferência | segredos do repositório e do environment, variáveis, environments, webhook e deploy key: **todos preservados**; a URL antiga redireciona e o `git remote` antigo segue funcionando | teste real com um repositório descartável (usuário para organização) |
| Segredos de organização | **não existem** na Trinity (nada se perde por ficarem para trás) | `gh api` |
| Onde moram os segredos | repositório: `BACKUP_ENCRYPTION_KEY`, `RELEASE_PAT`, `SFTP_*`, `PILAR_MONITOR_*`, `VITE_SUPABASE_*`; environments `Staging`, `Production` e `production-automation`: tokens e URLs do Supabase | `gh api` (só nomes) |
| Referências ao nome da organização no código | só documentação: `README`, `SECURITY.md`, dois ADRs e `security.txt` (o redirecionamento cobre; atualizar depois) | `grep` |
| Workflows | 12 próprios (CI, CodeQL, backup noturno, drill de restore mensal, promoção `staging` para `main`, hotfix de migration, monitor de produção, carga, evals de IA, auditoria semanal; dois de banco Bradesco e Itaú estão desligados). Nenhum tem o caminho do repositório escrito | leitura |
| Domínios | `app.` e `www.pilarsoft.com.br` servidos pela Vercel | `dig` e cabeçalhos |
| Vercel ligada ao GitHub | deployments de `Production – pilar`, `Production – pilar-marketing` e previews criados por `vercel[bot]`, no escopo pessoal. Dois projetos, um monorepo, com `ignoreCommand` | API de deployments do GitHub |
| Hostinger | webhook de push ativo (responde 200 a cada push) e deploy key `Pilar - Hostinger` **sem uso desde 18/02/2026**. É resíduo | `gh api` |
| Proteções | `main`: 1 aprovação e checks `CI OK` e `CodeQL`; `staging`: checks; environment `Production` exige 1 aprovador (Matheus) | `gh api` |

## O que **não** foi verificado

- As configurações dos dois projetos na Vercel (repositório conectado, variáveis, domínios, plano exato). O CLI
  local não está logado e a conta da Vercel da BEZ é nova, sem times, e não enxerga o escopo pessoal.
- Se a Vercel Hobby aceita um repositório da organização `bez-company` (a comunidade diz que não).
- O tipo do `RELEASE_PAT` (fine-grained limitado à Trinity quebra; clássico não). O valor não é legível.
- Se o `BACKUP_ENCRYPTION_KEY` existe fora do GitHub. Sem ele os backups cifrados não abrem.
- O inventário vivo do Supabase (o estático abaixo vem das migrations acumuladas).

## O que muda e o que quebra, por peça

| Peça | Efeito da transferência | O que fazer |
| --- | --- | --- |
| App e site no ar | nenhum; servem o último build | nada |
| Deploys automáticos da Vercel | **param** até reconectar (app da Vercel não está na `bez-company`, e o Hobby pode recusar) | instalar o app na `bez-company`, reconectar os dois projetos; se o Hobby recusar, Vercel Pro (US$ 20 por assento) ou sair da Vercel (E4.8) |
| Actions (CI, backup, promoção) | continuam, com segredos e environments preservados | rodar o `CI` e o `promote` uma vez depois; recriar o `RELEASE_PAT` se for fine-grained |
| Acesso do Carlos Cesar | some se ele não for adicionado à `bez-company` | decisão de negócio, ver abaixo |
| Repositório público numa organização gratuita | segue com proteção de branch, CodeQL e aprovador de environment, que são gratuitos em repositório público | não tornar privado sem plano pago: em repositório privado esses recursos em geral exigem plano pago (conferir antes) |
| Webhook e deploy key da Hostinger | acompanham | remover os dois (não são usados) |
| `security.txt`, README, ADRs | links antigos continuam por redirecionamento | atualizar para a URL nova |

## Sequência recomendada, sem indisponibilidade

1. **Antes de mexer:** guardar o `BACKUP_ENCRYPTION_KEY` e os demais valores fora do GitHub (não dá para ler de volta);
   descobrir o tipo do `RELEASE_PAT`; avisar o Carlos Cesar.
2. **Congelar** merge e `promote` por algumas horas, fora de release.
3. **Transferir** `Trinity-Comp4ny/pilar` para `bez-company`, mantendo o nome `pilar`.
4. **Testar:** push de um commit trivial na `staging` e conferir o `CI`; rodar o `promote` em modo de teste.
5. **Vercel:** instalar o app na `bez-company` com acesso só ao `pilar`; reconectar os dois projetos; fazer um deploy de
   preview. Se não reconectar, decidir entre Vercel Pro e o Firebase Hosting (E4.8), que de qualquer jeito tira a
   Pilar do Hobby. Até lá, o último build segue no ar e dá para publicar à mão pelo CLI.
6. **Limpeza:** remover o webhook e a deploy key da Hostinger; atualizar `security.txt`, README e ADRs.

Alternativa: fazer o E4.8 (front no Firebase Hosting) **antes** da transferência. Tira a Vercel do caminho, mas
mexe no DNS do domínio da Pilar, cujo titular ainda não é a BEZ (pendência de domínios).

## Inventário estático (E4.1, parcial)

Das migrations (369 arquivos, acumulado, inclui o que foi substituído; o inventário vivo do banco é o que vale):
52 funções do Supabase, 691 comandos `create policy`, 126 triggers criados, 492 usos de `auth.uid()`,
6 de `auth.jwt()`, 14 de `auth.role()`, 760 `security definer`, 31 chamadas `net.http_post`, 23 `cron.schedule`,
27 usos do Vault, 9 buckets, extensões `pg_net`, `supabase_vault`, `pgsodium`, `pg_graphql`, `pgcrypto`, `pg_trgm`.
As funções leem `SUPABASE_SERVICE_ROLE_KEY` (36 pontos) e `CRON_SECRET`, e usam Resend, Asaas, Sentry,
Turnstile e o gateway de IA. O login tem **hook de e-mail do Supabase Auth** e TOTP no `config.toml`: o hook
não existe no Identity Platform e precisa de substituto na virada. Esses números confirmam que a migração
é grande e que o próximo passo é o inventário vivo, por leitura no Supabase da Trinity.
