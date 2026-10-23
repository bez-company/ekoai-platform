# SETUP: conectar as redes e rodar local

Tempo estimado: 1h30 a 2h. Pode fazer em paralelo durante o dia.

---

## 1. Instagram Business + Página Facebook

> **Legado.** Este caminho (token manual de uma conta, com Página do Facebook) só serve ao job de métricas,
> que ainda lê o token do ambiente. A plataforma conecta o Instagram de cada conta pela tela de Redes, com
> Instagram Login e sem Página: veja a seção 7.

**Tempo:** 20min

### Por quê
Instagram Graph API só funciona com conta **Business** (ou Creator) vinculada a uma **Página** do Facebook.

### Passos

1. Abra o app do Instagram → Perfil → ☰ → Configurações → Conta → **Mudar para conta profissional** → Escolha "Empresa"
2. No mesmo fluxo, vincule a uma Página do Facebook. Se não tem Página, crie em [facebook.com/pages/create](https://facebook.com/pages/create) (sua marca pessoal ou empresa, tanto faz)
3. Salve o nome da Página — vai precisar no próximo passo

---

## 2. Meta for Developers App + Tokens

**Tempo:** 1h (a parte mais burocrática)

### Passos

1. Acesse [developers.facebook.com](https://developers.facebook.com) → My Apps → **Create App**
2. Tipo: **Business** → preencha nome e e-mail
3. Add Product: **Instagram Graph API**
4. App settings → Basic → anote **App ID** e **App Secret** (vai pro `META_APP_ID` e `META_APP_SECRET`)
5. Acesse [Graph API Explorer](https://developers.facebook.com/tools/explorer)
6. Selecione seu app no topo
7. Permissions necessárias: `instagram_basic`, `instagram_content_publish`, `pages_show_list`, `pages_read_engagement`, `business_management`
8. Generate Access Token → autorize com sua conta Facebook
9. Você terá um **short-lived token (1h)** — precisa converter pra long-lived (60d):

   ```bash
   curl -X GET "https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=APP_ID&client_secret=APP_SECRET&fb_exchange_token=SHORT_TOKEN"
   ```

10. O token retornado é o **`IG_ACCESS_TOKEN`** (60 dias).
11. Descubra seu **Instagram Business Account ID**:

    ```bash
    curl -X GET "https://graph.facebook.com/v21.0/me/accounts?access_token=LONG_TOKEN"
    # Pega o ID da Página
    curl -X GET "https://graph.facebook.com/v21.0/PAGE_ID?fields=instagram_business_account&access_token=LONG_TOKEN"
    # O `instagram_business_account.id` é o IG_BUSINESS_ACCOUNT_ID
    ```

### Limitação importante

A Graph API exige **URL pública** pra publicar imagem. Em ambiente local você precisa subir imagem pra storage (S3, R2, GitHub Pages, imgur). TODO no `src/channels/instagram.js`.

Sugestão pra MVP: criar bucket gratuito Cloudflare R2 ou subir pra GitHub Pages do próprio repo via branch `assets`.

---

## 3. LinkedIn Developer App + Tokens

**Tempo:** 1h

### Passos

1. Acesse [linkedin.com/developers](https://linkedin.com/developers) → **Create app**
2. Vincule a uma Company Page (se não tem, cria uma rapidinho)
3. App settings → **Auth** → anote **Client ID** e **Client Secret** (`LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`)
4. Products → Request access pra:
   - **Sign In with LinkedIn using OpenID Connect**
   - **Share on LinkedIn**
   - **Community Management API** (importante pra `posts` endpoint)
5. Auth → OAuth 2.0 settings → adicione redirect URL (pode ser `http://localhost:3000/callback` pro fluxo manual)
6. Faça o fluxo OAuth manual:

   - Abra no navegador (substitua CLIENT_ID):
     ```
     https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=CLIENT_ID&redirect_uri=http://localhost:3000/callback&scope=openid%20profile%20w_member_social
     ```
   - Autorize. Vai dar erro 404 no localhost — copie o `code` da URL.
   - Troque o code por token:
     ```bash
     curl -X POST https://www.linkedin.com/oauth/v2/accessToken \
       -d "grant_type=authorization_code" \
       -d "code=CODE" \
       -d "client_id=CLIENT_ID" \
       -d "client_secret=CLIENT_SECRET" \
       -d "redirect_uri=http://localhost:3000/callback"
     ```
   - Resposta tem `access_token` (60d) e `refresh_token` (1 ano) → `LINKEDIN_ACCESS_TOKEN`, `LINKEDIN_REFRESH_TOKEN`

7. Descubra seu URN:
   ```bash
   curl -H "Authorization: Bearer ACCESS_TOKEN" https://api.linkedin.com/v2/userinfo
   ```
   O `sub` é seu ID → `LINKEDIN_AUTHOR_URN=urn:li:person:SUB_ID`

   Pra publicar como Company Page, use `urn:li:organization:ORG_ID`.

---

## 4. Avisos da conta

Não há bot para configurar. Os avisos (post pronto para aprovar, agendado, publicado, falhou,
relatório semanal) ficam na tabela `notifications` do tenant e aparecem na plataforma
(SPEC 007). Sem `STATE_BACKEND=postgres`, saem só no log do job.

---

## 5. Segredos

**Tempo:** 10min

Localmente, preencha o `.env` a partir do `.env.example`. Em produção os segredos ficam no
Secret Manager do Google Cloud e entram nos Cloud Run Jobs e na plataforma pelo Terraform
([SPEC 010](docs/specs/010-migracao-google-cloud.md), fase 3). Os GitHub Actions secrets não são
mais usados: o repositório só roda o CI.

Variáveis que os jobs leem:

- `TENANT_ID` (a conta do job; sem ele o job não sobe)
- `IG_ACCESS_TOKEN`, `IG_BUSINESS_ACCOUNT_ID` (legado, só o job de métricas; a plataforma não os lê)
- `LINKEDIN_ACCESS_TOKEN`, `LINKEDIN_REFRESH_TOKEN`, `LINKEDIN_AUTHOR_URN`, `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`
- `DATABASE_URL`, `STATE_BACKEND=postgres`, `STORAGE_BUCKET`, `MEDIA_BASE_URL`

---

## 6. Teste local (sem APIs)

```bash
npm install
(cd platform && npm install)
npm test
```

Esperado: testes passam. A criação de posts com IA volta na fase 2
([SPEC 011](docs/specs/011-plataforma-generica-fase-1.md)).

---

## 7. Conectar o Instagram por conta

Cada conta da Ekoai conecta o próprio Instagram em **Configurações › Redes › Conectar Instagram**
(SPEC 011 R5). A pessoa entra no Instagram, toca em Permitir e volta com a conta conectada. O token
fica cifrado no banco (Cloud KMS) e a plataforma publica com ele; o `.env` não vale mais para isso.

Uma vez por ambiente, no painel de desenvolvedor da Meta (app com **Instagram Login**, não Facebook Login):

1. Caso de uso "Gerenciar mensagens e conteúdo no Instagram" com as permissões
   `instagram_business_basic` e `instagram_business_content_publish`.
2. Em "Configurar o login da empresa no Instagram", registre a URL de redirecionamento:
   `<endereço público da plataforma>/api/instagram/callback`. Cada ambiente tem a sua; dá para
   registrar várias.
3. Enquanto o app está em modo desenvolvimento, só conta adicionada como **Testador do Instagram**
   (Funções do app) conecta; o convite é aceito dentro do Instagram, em Configurações, Apps e sites.
4. Grave o **ID do app do Instagram** e a **Chave secreta do app do Instagram** (mesma tela do
   passo 2) nos segredos `instagram-app-id` e `instagram-app-secret` do projeto do ambiente:

```bash
printf '%s' "$VALOR" | gcloud secrets versions add instagram-app-id --data-file=- --project=<projeto>
printf '%s' "$VALOR" | gcloud secrets versions add instagram-app-secret --data-file=- --project=<projeto>
```

   O Cloud Run lê `latest` ao subir uma revisão: depois de gravar, refaça o deploy do ambiente
   (Actions > Deploy > Run workflow, na branch dele). Refazer o mesmo commit cria a revisão
   `sha-<commit>-r<run>-<tentativa>` e a plataforma passa a enxergar o valor (BEZ-216).
   Sem os dois segredos a tela de Redes diz que a conexão ainda não está ativa.

O token dura 60 dias. A plataforma renova sozinha, todo dia às 09:00 UTC (Cloud Scheduler
`ekoai-refresh-instagram`, rota `/api/cron/refresh-instagram`): renova quem vence em até 15 dias e tem
mais de 24 horas. Token recusado pela Meta ou vencido muda a conta para "precisa reconectar" e avisa os
administradores uma vez. No staging os agendamentos ficam pausados; para rodar na hora:
`gcloud scheduler jobs run ekoai-refresh-instagram --location=southamerica-east1 --project=ekoai-staging`.

As métricas dos posts publicados (curtidas e comentários; alcance, salvos, compartilhamentos,
visualizações e interações só quando a conta concedeu `instagram_business_manage_insights`) são coletadas
a cada 6 horas (Cloud Scheduler `ekoai-collect-metrics`, rota `/api/cron/collect-metrics`) e gravadas em
`metrics_snapshots`. Para rodar na hora no staging:
`gcloud scheduler jobs run ekoai-collect-metrics --location=southamerica-east1 --project=ekoai-staging`.

No app da Meta (Instagram, Business Login settings), registre também os dois callbacks da SPEC 011 R5.4:
desautorização em `<APP_BASE_URL>/api/instagram/deauthorize` e exclusão de dados em
`<APP_BASE_URL>/api/instagram/data-deletion`. A Meta assina o pedido com o segredo do app
(`INSTAGRAM_APP_SECRET`); a plataforma revoga a conexão, avisa os administradores e, na exclusão, responde
com o código de confirmação e a página pública `/instagram/exclusao/<código>`.

Para trocar de app da Meta (por exemplo, para o da empresa dona do produto), grave os dois segredos
do app novo e registre a URL no app novo. Quem já conectou reconecta uma vez: o token é do app.

## Troubleshooting

| Erro | Causa provável | Fix |
|---|---|---|
| `IG API 400: image_url must be public` | URL não acessível externamente | Subir imagem pra S3/R2 |
| `LinkedIn API 401` | Token expirado | `npm run refresh-tokens` |
| Job rodou mas nenhum aviso apareceu | `STATE_BACKEND` não é `postgres` no job | Confere a variável do job e o `DATABASE_URL` |
