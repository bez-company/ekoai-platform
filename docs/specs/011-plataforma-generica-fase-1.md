# SPEC 011: plataforma genérica, fase 1 (contas, empresa, equipe e Instagram)

- **Status:** aprovada em 2026-10-19. R1 implementado; protótipo aprovado (design system 06)
- **Protótipo:** https://claude.ai/artifact/55avs7vhgtwKFn9HMAR9Fz (artifact HTML navegável, no lugar do handoff do Claude Design)
- **Decisões:** [ADR 0010](../adr/0010-plataforma-generica-sem-pilar-no-codigo.md) (Pilar fora do
  código, geração até a fase 2, cadastro atrás de flag) e
  [ADR 0011](../adr/0011-design-system-neutro-ate-a-marca.md) (design system neutro)
- **Depende de:** [ADR 0007](../adr/0007-tres-papeis-de-conta.md) (papéis), [SPEC 009](009-login-por-pessoa.md)
  (login por pessoa), [SPEC 010](010-migracao-google-cloud.md) (Cloud SQL, Identity Platform, KMS)
- **Base de produto:** [arquitetura SaaS](../arquitetura/README.md) e
  [arquitetura de usuário](../arquitetura/usuario.md)

## Problema

A plataforma foi construída só para a Pilar. Não existe como uma empresa criar conta, contar quem
ela é, chamar a equipe e conectar o Instagram sem o Matheus mexer no banco ou no código.

## Objetivo

Uma empresa, sem ajuda, cria a conta, confirma o e-mail, cadastra a empresa, convida a equipe com
papel e conecta o Instagram. Nenhuma linha de código conhece um cliente.

## Escopo

| Entra | Fica para depois |
| --- | --- |
| Código sem a Pilar (R1) | Geração de post e de imagem (fase 2: agentes de imagem do Instagram) |
| Cadastro, entrada e conta da empresa (R2) | X e LinkedIn (o código de publicação fica, fora do menu) |
| Perfil da empresa e preferências (R3) | Vídeo, notícias, resposta automática |
| Equipe e convites (R4) | Cobrança, Asaas, nota fiscal |
| Conectar o Instagram (R5) | Abrir o cadastro ao público (decisão separada, ADR 0010) |
| Estrutura: menu por papel, Início, avisos, configurações (R6) | Marca da Ekoai (ADR 0011) |
| Planos com limites, sem cobrança (R7) | |
| Exportar e excluir a conta (R8) | |
| Console do ultra admin, mínimo (R9) | |

## Requisitos

### R1. Código sem a Pilar (feito nesta PR)

1. Sai o pipeline de geração e todo o conteúdo da Pilar: prompts, templates, croquis, logo,
   exemplos, docs de ICP, voz, dores e pilares, funil (SPEC 004) e os jobs `post`, `resolve`,
   `reflect`, `funnel`, `engage`, `repurpose` e `reel`. O estado anterior fica na tag `pilar-v1`.
2. Job sem `TENANT_ID` falha na largada. A instalação de senha única também.
3. UTM só com `SITE_URL` da conta; sem ele, o post sai sem link rastreado. Nada aponta para domínio
   de cliente.
4. Engajamento (LinkedIn) sai do menu.
5. Teste de CI reprova referência à Pilar no código (fora das migrations já aplicadas e dos docs de
   decisão).

### R2. Cadastro, entrada e conta

1. Criar acesso com e-mail e senha (Identity Platform), confirmar o e-mail, entrar, esqueci a senha,
   MFA obrigatório para administrador (SPEC 009).
2. `SIGNUP_MODE`: `invite` (padrão; só entra quem tem convite ou conta criada pelo ultra admin) ou
   `open` (qualquer pessoa cria conta). Com `invite`, a rota de cadastro responde 404.
3. Criar a conta: tipo (`pessoa` ou `empresa`), nome e identificador. Quem cria vira administrador.
   Conta nova nasce pausada (já é assim, 0013) e no plano inicial.
4. Uma pessoa pode estar em várias contas; o seletor aparece só quando há mais de uma.

### R3. Perfil da empresa e preferências

Guardado agora, usado pelos agentes da fase 2. Validado na entrada (tamanho, formato, lista
fechada onde houver).

| Grupo | Campos | Obrigatório |
| --- | --- | --- |
| Sobre | nicho (lista + livre), o que vende, para quem vende, cidade ou região, site, @ do Instagram | nicho, o que vende, para quem |
| Diferencial | diferenciais, dores do cliente (listas curtas) | não |
| Voz | 3 escalas de 1 a 5 (formal ↔ descontraído, técnico ↔ simples, sério ↔ bem-humorado), palavras proibidas | não |
| Visual | logo (PNG ou SVG sanitizado, até 2 MB, bucket privado), cores (principal e destaque, hex), fontes (lista curada) | não |
| Preferências | posts por semana, CTA padrão (link na bio, WhatsApp, DM) | não |

Só administrador edita (`brand.manage`); criador vê; leitor não vê.

### R4. Equipe e convites

1. Convidar por e-mail com papel (`admin`, `creator`, `viewer`). Convite de uso único, válido por
   7 dias, guardado só como hash.
2. Reenviar, cancelar, mudar papel, remover. A regra do último administrador já está no banco.
3. Aceitar convite: válido, expirado, já usado, de outra conta. Quem não tem acesso cria no aceite.
4. Mudança na equipe vai para o audit log e avisa os administradores.

### R5. Conectar o Instagram

1. Instagram Login (não Facebook Login), só conta profissional, com `state` contra CSRF.
2. Token cifrado em repouso (Cloud KMS, SPEC 010), nunca enviado ao navegador; status
   `active`, `reauth_required` ou `revoked`.
3. Renovação antes de vencer (o job `refresh-tokens` passa a ler as contas conectadas); falhou,
   vira `reauth_required` e avisa os administradores.
4. Desconectar revoga e apaga. Callback de exclusão de dados da Meta.
5. Até o App Review, só contas adicionadas como tester no app funcionam. O fluxo fica pronto.

### R6. Estrutura

1. Menu e rotas lidos de uma lista única de telas com a permissão de cada uma; tela proibida some
   do menu e responde 404 (regra de [usuario.md](../arquitetura/usuario.md)).
2. Início com o checklist de onboarding derivado do dado: completar o perfil, conectar o
   Instagram, convidar a equipe (opcional). Dá para pular e voltar.
3. Avisos no app, com `audience` por papel.
4. Configurações: Empresa, Equipe, Redes, Horários e pausa (já existe), Dados e privacidade.
5. Inbox e Aprendizado ficam com estado vazio honesto até a fase 2.

### R7. Planos e limites

Tabela de planos com limites (assentos, contas de Instagram), checados no servidor. Sem preço nem
cobrança. Conta nova entra no plano inicial.

### R8. Dados e privacidade

Exportar os dados da conta (já existe `/api/export`) e excluir a conta: pede MFA e o nome da conta,
avisa os administradores, apaga em cascata e revoga os tokens das redes.

### R9. Console do ultra admin, mínimo

Listar contas, ver uso e status, suspender e reativar, criar conta com convite para o primeiro
administrador (o caminho enquanto `SIGNUP_MODE=invite`). Regras em
[ultra-admin.md](../arquitetura/ultra-admin.md).

## Dados novos (R2 a R9)

Migrations 0017 a 0019 (decisões em [ADR 0012](../adr/0012-limites-e-segredos-no-banco.md)).

| Tabela ou coluna | Para quê |
| --- | --- |
| `plans` | R7: limites por plano (`pessoa`: 1 pessoa e 1 Instagram; `inicial`: 5 pessoas e 1 Instagram) |
| `tenants.kind`, `tenants.plan_id` | R2: pessoa ou empresa e o plano; um gatilho exige plano do mesmo tipo |
| `company_profiles` | R3: uma linha por conta; admin edita (`brand.manage`), admin e criador veem (`profile.view`) |
| `brand_assets` | R3: o logo (binário no bucket privado, ADR 0009); o perfil só aponta para logo da própria conta |
| `invitations` | R4: só o hash do token, 7 dias, uso único; `app.accept_invitation()` aceita de forma atômica |
| `social_accounts` | R5: metadados da conta de rede (status, vencimento); admin e criador veem (`channels.view`) |
| `social_account_secrets` | R5: token cifrado, sem `tenant_id`, sem acesso da API, fora da exportação |
| `audit_events` | R4 e R8: só inserção (nem o dono altera), sem FK para a conta |
| `platform_admins` | R9: uma linha, sem policy; o e-mail não entra no repositório |

Toda tabela com `tenant_id` tem RLS por `app.can` e está em `TENANT_TABLES` (exportação). Limites
do plano são gatilhos no banco. Migrations aditivas.

## Telas (protótipo no Claude Design antes do código)

Cada tela em desktop e mobile, com vazio, carregando, erro e cheio.

1. Entrar, criar acesso, confirmar e-mail, esqueci a senha, MFA.
2. Criar a conta (tipo, nome) e o perfil da empresa em passos curtos, com "pular" no que não é
   obrigatório.
3. Início com o checklist de onboarding e o estado "a criação de posts chega na próxima fase".
4. Configurações › Empresa (o mesmo perfil, editável).
5. Configurações › Equipe e a tela de aceitar convite.
6. Configurações › Redes: conectar, conectado, reconectar, desconectar.
7. Configurações › Dados e privacidade: exportar e excluir.
8. Menu por papel (administrador, criador, leitor) e conta pessoa.
9. Console do ultra admin (só desktop).

### Briefing para o Claude Design

Produto: Ekoai, plataforma onde empresas pequenas e profissionais autônomos cuidam do Instagram com
IA. Nesta fase a pessoa cria a conta, conta sobre a empresa, chama a equipe e conecta o Instagram;
a criação de posts chega depois. Desktop no dia a dia, celular para conferir.

Visual: não há marca ainda. Proponha um design system neutro (cinzas, um acento, estados de
sucesso, aviso e erro, foco visível) com tokens semânticos (`surface`, `text`, `text-muted`,
`border`, `accent`, `danger`...) e contraste AA. "Ekoai" escrito em texto no lugar do logo.

Dados de exemplo: conta empresa "Doce Ponto Confeitaria" (Marília-SP, @doceponto) com Ana
(administradora), Bruno (criador) e Carla (leitora, convite pendente); conta pessoa "Marina Lopes,
nutricionista"; Instagram da Doce Ponto conectado e o da Marina com token vencendo em 5 dias.

Restrições: microcopy em português, voz ativa, sentence case, botão com verbo de ação; erro diz o
que houve e o próximo passo, sem culpar a pessoa; estado vazio orienta a primeira ação; sem emoji
decorativo.

## Ordem de entrega

| # | Entrega | Tela | Verificação |
| --- | --- | --- | --- |
| 1 | R1: código sem a Pilar | não | testes e typecheck; teste de CI contra referência à Pilar |
| 2 | Banco de R2 a R9 (tabelas, RLS, permissões novas) | não | `rls_test.sql` cobre cada tabela; convite expirado, reusado e de outra conta |
| 3 | Protótipo aprovado (feito em 19/10/2026, link no topo) e design system 06 na plataforma | | `tests/design-tokens.test.js` |
| 4 | R2 e R4: entrada, cadastro, conta, equipe, convite | sim | emulador do Identity Platform no CI |
| 5 | R3: perfil da empresa | sim | validação na entrada testada; SVG malicioso recusado |
| 6 | R5: Instagram | sim | fluxo com conta tester; token nunca aparece na resposta da API |
| 7 | R6 a R9: estrutura, avisos, privacidade, console | sim | teste de rota por papel (404 para quem não vê) |

## Critérios de aceite

1. Uma pessoa sem ajuda cria a conta, confirma o e-mail, cadastra a empresa, convida alguém com
   papel e conecta um Instagram tester.
2. Leitor não vê nem chama rota de administrador (404).
3. Nenhum teste nem arquivo de código cita a Pilar (teste de CI).
4. Limite do plano estourado é barrado no servidor.
5. Excluir a conta apaga os dados dela e revoga os tokens.

## Depende de fora

| O quê | Para | Quem |
| --- | --- | --- |
| Identity Platform real e Cloud SQL | R2 em staging (o desenvolvimento usa o emulador e Postgres local) | SPEC 010, fase 3 |
| Cloud KMS | R5 em staging | SPEC 010, fase 3 |
| Provedor de e-mail transacional com domínio | convites e avisos por e-mail | Matheus (decisão 7 de [sem-google.md](../arquitetura/sem-google.md)) |
| Business Verification (CNPJ da BEZ) e App Review da Meta | Instagram de terceiros sem ser tester | Matheus |
| Protótipo no Claude Design | itens 4 a 7 | Matheus |

## Registro de implementação

### R1 (2026-10-19)

- Tag `pilar-v1` no commit `98010e2` (main antes do corte): todo o pipeline antigo está lá.
- Saíram 12 scripts de `src/` (geração, resolve, reflect, funil, engajamento, repurpose, reel,
  índice RAG, render), 13 utilitários, `prompts/`, `templates/`, `assets/`, `content/`, os docs
  de estratégia da Pilar e os testes deles. Dependências fora: `puppeteer`, `js-yaml`,
  `@google/genai`; a imagem dos jobs não instala mais o Chromium.
- `src/tenant.js` virou `currentTenantId()`: sem `TENANT_ID` válido, o dispatcher (`src/jobs.js`)
  recusa os jobs de conta. `installTenantId()` da senha única faz o mesmo.
- UTM sem URL padrão: sem `SITE_URL`, o post sai sem link rastreado e a tela de horários avisa.
- Engajamento saiu do menu; o prompt dele ficou sem marca.
- Testes de banco, `rls_test.sql` e o smoke de schema do CI usam contas de exemplo.
- `tests/no-client-brand.test.js` reprova marca de cliente no código.
- Verificado: 168 testes, typecheck da plataforma, migrations duas vezes + smoke + `rls_test.sql`
  e `npm run test:db` (43) num Postgres local, as duas imagens construídas, dispatcher recusando
  job sem conta.
- Para a SPEC 010: os jobs `post`, `resolve`, `reflect`, `funnel`, `engage`, `repurpose` e `reel`
  não existem mais; o Terraform só agenda `refresh-tokens`, `token-health`, `weekly-report` e
  `migrate`, todos com `TENANT_ID` (menos `migrate`).

### Item 2: banco (2026-10-19)

- Migrations 0017 (planos, perfil da empresa, logo), 0018 (convites, contas de rede, tokens
  cifrados, limites do plano) e 0019 (auditoria, administrador da plataforma). `tenant:create`
  ganhou `--kind empresa|pessoa`.
- `supabase/ci/rls_test.sql` cobre, por papel: perfil (admin edita, criador só vê, leitor não vê),
  convites e auditoria (só o admin lê), redes (admin e criador veem, ninguém lê token), logo de
  outra conta recusado por FK, limites de pessoas e de Instagram, convite aceito, reusado, vencido,
  cancelado, de outro e-mail e já membro, token apagado ao revogar, auditoria imutável e um
  administrador da plataforma só. Guardas de catálogo: tabela `*_secrets` e `platform_admins`
  fora do alcance da API.
- Verificado por mutação: abrir o token à API, tirar cada gatilho de limite, tornar a auditoria
  reescrevível, deixar o leitor ler o perfil e o criador editar o perfil reprovam o teste.
- A exportação inclui as tabelas novas, corta o hash do convite e nunca o token (teste de
  integração em `tests/db/data-layer.integration.test.js`).
- Falta para R2 a R9: parsers e rotas (cadastro, convite, perfil, conexão do Instagram com KMS),
  telas e o console.
