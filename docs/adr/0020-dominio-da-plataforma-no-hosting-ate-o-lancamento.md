# ADR 0020: `app.ekoai.com.br` no Firebase Hosting até o lançamento, Load Balancer antes de vender

- **Status:** aceito
- **Data:** 2026-10-23
- **Specs que dependem:** [SPEC 015](../specs/015-site-da-ekoai-em-ekoai-com-br.md) (os botões do site apontam para `app.ekoai.com.br`)
- **Revisa:** o último item das consequências do [ADR 0016](0016-site-da-ekoai-estatico-no-hosting-do-ekoai-prod.md), que descartava o Hosting como porta do app

## Contexto

A plataforma de produção responde só em `*.run.app`. O site da Ekoai já aponta os botões para
`app.ekoai.com.br`, que não tem DNS. Três caminhos para o domínio:

- **Domain mapping do Cloud Run:** grátis, mas a API recusa em `southamerica-east1`
  (`Creating domain mappings is not allowed in southamerica-east1`, testado em 23/10/2026).
- **Load Balancer global com Cloud Armor** (BEZ-42): cerca de US$ 18,25 por mês só pela regra de
  encaminhamento (US$ 0,025 por hora), mais US$ 0,008 por GB e o Cloud Armor. Um por produto e por
  ambiente, porque cada um vive no seu projeto (ADR 0015 da plataforma BEZ).
- **Firebase Hosting com rewrite para o Cloud Run:** dentro da franquia grátis. O Hosting só repassa
  ao Cloud Run o cookie chamado `__session`, e a sessão se chamava `pa_session`.

Não há cliente nem lançamento (alvo de 19/01/2027). Pagar o Load Balancer agora compra WAF e limite
por IP para um endereço que ninguém usa.

## Decisão

1. **Até o lançamento, `app.ekoai.com.br` é um site do Firebase Hosting** (`ekoai-prod-app`, no
   projeto `ekoai-prod`) com rewrite `**` para o serviço `ekoai-platform`. Tudo no Terraform do
   módulo `ekoai` (`hosting.tf`), ligado pela variável `app_domain`. Vazia, nada é criado.
2. **O cookie de sessão passa a se chamar `__session`** (`SESSION_COOKIE` em `platform/src/lib/auth.ts`).
   É o único cookie da plataforma. Os testes cobrem o nome.
3. **`APP_BASE_URL` e `MEDIA_BASE_URL` usam o domínio** (`local.public_url`). O Scheduler, o uptime
   check e a audiência OIDC seguem no endereço do Cloud Run (`platform_url`): o Scheduler não passa
   pelo Hosting. O domínio também entra nos domínios autorizados do Identity Platform e nos referers da chave web.
4. **O DNS fica na GoDaddy.** Os registros saem em `terraform output app_dns_records`.
5. **Antes de lançar ou de ter o primeiro cliente, o BEZ-42 troca o Hosting por Load Balancer com
   Cloud Armor**, e `run.app` deixa de aceitar tráfego direto (`ingress` interno e do Load Balancer).
   A troca é só DNS: o nome do cookie e o domínio da mídia não mudam.

## Consequências

- Custo perto de zero até o lançamento.
- **Sem WAF e sem limite de requisições por IP** na borda até o BEZ-42. O `run.app` continua
  público (`ingress = INGRESS_TRAFFIC_ALL`, como já era). Dívida aceita, registrada no BEZ-42.
- O Hosting remove qualquer cookie que não seja `__session`. Cookie novo exige outro desenho.
  O `state` do OAuth do Instagram já seguiu esse caminho: é assinado (HMAC com o segredo do app) e
  amarrado à empresa, sem cookie (o `ig_oauth_state` antigo nunca chegava ao callback).
- O rewrite do Hosting corta em 60 s. As rotas longas (`/api/cron/*`) são chamadas pelo Scheduler
  direto no Cloud Run e não passam por ele; as de usuário respondem em segundos (a geração é
  assíncrona, ADR 0018).
- O cache do Hosting usa `__session` na chave, então resposta de uma pessoa não vai para outra.
- Trocar o nome do cookie encerra as sessões abertas. Sem cliente, o custo é entrar de novo.
- A URL de mídia gravada no banco já nasce com `app.ekoai.com.br` em produção, então o BEZ-42 não
  precisa reescrever linhas (ADR 0009).

## Alternativas descartadas

- **Domain mapping:** indisponível na região do serviço.
- **Load Balancer agora:** custo fixo sem tráfego para proteger.
- **Vercel na frente:** o plano grátis é só para uso não comercial, o Pro custa o mesmo que o
  Load Balancer e o app é um Next.js com servidor falando com o Cloud SQL, então seria só um proxy.
- **Mover o serviço para uma região com domain mapping:** afasta o app do banco e dos usuários.
