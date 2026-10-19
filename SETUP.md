# SETUP — do zero ao primeiro post

Tempo estimado: 1h30 a 2h. Pode fazer em paralelo durante o dia.

---

## 1. Instagram Business + Página Facebook

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

## 5. Anthropic API Key

**Tempo:** 5min

1. [console.anthropic.com](https://console.anthropic.com) → API Keys → Create
2. Adicione billing (crédito mínimo $5 — dura meses pro volume desse projeto)
3. Copie a key → `ANTHROPIC_API_KEY`

---

## 6. Segredos

**Tempo:** 10min

Localmente, preencha o `.env` a partir do `.env.example`. Em produção os segredos ficam no
Secret Manager do Google Cloud e entram nos Cloud Run Jobs e na plataforma pelo Terraform
([SPEC 010](docs/specs/010-migracao-google-cloud.md), fase 3). Os GitHub Actions secrets não são
mais usados: o repositório só roda o CI.

Variáveis que os jobs leem:

- `GEMINI_API_KEY`
- `IG_ACCESS_TOKEN`, `IG_BUSINESS_ACCOUNT_ID`, `META_APP_ID`, `META_APP_SECRET`
- `LINKEDIN_ACCESS_TOKEN`, `LINKEDIN_REFRESH_TOKEN`, `LINKEDIN_AUTHOR_URN`, `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`
- `DATABASE_URL`, `STATE_BACKEND=postgres`, `STORAGE_BUCKET`, `MEDIA_BASE_URL`

---

## 7. Teste local (sem APIs)

```bash
npm install
npm test
npm run dry-run
```

Esperado: testes passam, dry-run gera 3 variações mock + 2 imagens (uma IG, uma LinkedIn) na pasta `tmp/`.

---

## 8. Primeiro post de verdade

1. `.env` preenchido, com `DATABASE_URL` de um Postgres com as migrations (`npm run migrate`)
2. Enfileire 1 ideia em `queue_items` (`node src/atomize.js <arquivo> 1 --queue`, ou um `insert`):
   `pillar = 'dor'`, `angle = 'tempo'`, `context = 'Primeiro post de validação'`
3. Rode o job `post` com `SKIP_APPROVAL=true` (primeiro teste sem esperar aprovação): localmente
   `npm start`; no Google Cloud, `gcloud run jobs execute post` depois da fase 3
4. Veja a publicação em IG + LinkedIn
5. Próximo post: deixar o fluxo normal, com aprovação na plataforma

---

## Troubleshooting

| Erro | Causa provável | Fix |
|---|---|---|
| `IG API 400: image_url must be public` | URL não acessível externamente | Subir imagem pra S3/R2 |
| `LinkedIn API 401` | Token expirado | `npm run refresh-tokens` |
| Job rodou mas nenhum aviso apareceu | `STATE_BACKEND` não é `postgres` no job | Confere a variável do job e o `DATABASE_URL` |
