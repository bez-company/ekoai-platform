# SPEC 034: leitura da marca em tempo real no onboarding, site inteiro e Instagram conectado

- **Status:** rascunho com as decisões do Matheus de 03/11/2026; protótipo v30 publicado no Claude Design, aguardando aprovação (sem ela não há código de tela)
- **Data:** 2026-11-03
- **Cards:** BEZ-532 (medir), BEZ-533 (tela por etapas), BEZ-534 (site inteiro), BEZ-535 (progresso por evento), BEZ-536 (Instagram no onboarding); origem BEZ-531
- **Origem:** análise do concorrente Native (`docs/analises/2026-11-03-native-no-engenharia-reversa.md`)
- **Depende de:** SPEC 033 (leitura do site), ADR 0030 (leitura de site público com proteção contra SSRF), `lib/site-read/*`, conexão do Instagram (`api/instagram/*`)
- **Gera:** ADR 0031 (transporte do progresso: SSE ou Realtime)

## Problema

A leitura da marca (SPEC 033) já preenche o cadastro, mas:

1. Mostra só "Lendo o seu site" até terminar. Quem espera não sabe se algo acontece, e o resultado só aparece inteiro no fim.
2. Lê a página inicial e até 3 páginas internas escolhidas pelos links da própria home, com limite de 25s. Blog, catálogo e
   páginas de preço ficam de fora.
3. O @ do Instagram só é guardado. Conectar a conta exige sair do cadastro e ir em Configurações, depois da primeira impressão.

## Decisões (Matheus, 03/11/2026)

### A. Streaming real do que está sendo lido

1. A tela mostra o que o servidor está fazendo **de verdade**, em frases curtas: "Lendo a página de produtos", "Coletando as
   cores", "Pegando o logo", "Lendo o blog", "Entendendo o seu jeito de falar". Nada de animação que finge progresso: cada frase
   nasce de um evento emitido pelo servidor.
2. **Resultado por etapa, na ordem em que fica pronto:** logo e cores primeiro (saem do HTML e do CSS, sem modelo), depois nome e
   descrição, e por fim tipo de marca, jeito de falar, diferenciais e fatos (modelo de texto). Cada resultado aparece na tela assim
   que existe.
3. **Nada é gravado sozinho.** Continua valendo a SPEC 033: a pessoa revisa e confirma; fato lido entra como rascunho.
4. **Falha por etapa, não geral.** Uma página que não abre, um logo que falha ou um robots.txt que bloqueia aparece como aviso na
   etapa e a leitura segue. Só a falha total (endereço inválido, site fora do ar) para tudo, com o próximo passo.
5. **Meta de tempo:** primeiro resultado visível (logo e cores) em até 30s; primeiro evento na tela em até 2s. O valor real sai da
   medição do BEZ-532.

### B. Progresso por evento

1. **Contrato de evento** (JSON, validado por parser puro em `platform/src/lib/site-read`): `read.started`, `step.started`
   (`kind`: site, css, page, sitemap, logo, colors, text, model, instagram; `label`; `url` quando for página), `step.result`
   (carga parcial por `kind`), `step.failed` (`kind`, motivo em português e próximo passo), `read.done` (resultado completo),
   `read.failed`. Cada evento tem `seq` crescente.
2. **Transporte:** SSE sobre uma rota nova, com retomada por `Last-Event-ID`. Decisão final no ADR 0031, que compara SSE com
   Realtime (Firestore ou Postgres). Risco a medir antes: limite de tempo e buffer do Firebase Hosting na frente do Cloud Run
   (a leitura passa de 25s quando lê o site inteiro). Se o Hosting cortar o fluxo, reconectar com `Last-Event-ID` ou publicar
   os eventos em outro canal.
3. **Mesma permissão da leitura atual** (`brand.manage`) e o mesmo limite por hora por conta. A rota declara a permissão
   (`tests/route-permissions.test.js`).
4. Quem não consegue abrir o fluxo cai no comportamento de hoje (uma requisição, resultado no fim). Nenhum passo do cadastro
   depende do streaming para funcionar.

### C. Site inteiro

1. **Descoberta de páginas:** `sitemap.xml` (e índice de sitemaps) citado no `robots.txt` ou em `/sitemap.xml`; sem sitemap, os
   links da home como hoje.
2. **Escolha por tipo e orçamento:** classificar a URL (produto, serviço, blog, sobre, preços, FAQ, contato) e ler primeiro o que
   diz mais da empresa; blog entra com as páginas mais recentes. Limite de páginas, de tempo total e de texto enviado ao
   modelo, **definidos depois da medição do BEZ-532**.
3. **Mesmas proteções do ADR 0030:** só `https`, SSRF, `robots.txt` por página, 2 MB por página, sem cookie. Leituras em
   paralelo com teto de concorrência.
4. **Fato só entra citando página lida**, com os números presentes no texto, como hoje. O custo da leitura entra no consumo da
   conta como uma geração.
5. A SPEC 033 deixou "mais páginas além da inicial e das 3 primeiras do menu" fora do escopo: esta SPEC substitui esse corte.

### D. Instagram dentro do onboarding

1. **Passo no cadastro:** "Conecte seu Instagram para a Ekoai ler suas legendas, hashtags e o estilo das suas fotos", com o botão de
   conectar e "Agora não". Pular nunca bloqueia o cadastro.
2. **Mesma conexão de hoje** (`api/instagram/connect` e `callback`), com a volta para o onboarding. O `state` assinado passa a
   levar um destino de uma **lista fixa** (`onboarding` ou `canais`), nunca uma URL livre (sem redirecionamento aberto). Hoje o
   callback sempre volta para `/configuracoes/canais`.
3. **Termos da Meta:** a tela diz o que será lido e para quê, linka a política de privacidade e o caminho de remoção
   (`deauthorize`), antes do botão. O texto sai do que foi declarado no App Review.
4. **Depois de conectar**, a leitura das legendas roda no mesmo fluxo de eventos ("Lendo as suas legendas do Instagram") e melhora
   o resultado (BEZ-528).
5. **Restrição de lançamento:** o App Review do Instagram foi enviado em 02/11/2026 (análise de até cerca de 20 dias). Até a
   aprovação só contas com papel no app conectam; quem não tem papel recebe o erro da Meta. Por isso o passo fica atrás de uma
   variável de ambiente (`INSTAGRAM_ONBOARDING_CONNECT`), ligada para contas de teste e desligada para o público até a aprovação.
   Com o passo desligado, vale o @ opcional de hoje.
6. **Fora:** raspagem de perfil público de terceiros sem conexão (continua não sendo feita, SPEC 033).

## Protótipo (obrigatório antes de codar)

No Claude Design, desktop e celular, com os estados: lendo (com as frases e o resultado chegando por etapa), resultado parcial,
aviso de etapa que falhou, falha total, passo do Instagram (conectar, pular, falhou, conectado) e cheio. Publicado na v30 do artifact único da Ekoai, grupo "Fase 13" (https://claude.ai/artifact/55avs7vhgtwKFn9HMAR9Fz), telas
"Cadastro rápido: conectar o Instagram", "Lendo a marca em tempo real" e "Confirmar: site inteiro e Instagram". Aprovação: _pendente_.

## Como verificar

- **Parser do evento:** formato, `seq` crescente, motivo de falha presente, rejeição de evento mal formado.
- **Descoberta de páginas:** sitemap simples, índice de sitemaps, sitemap grande, sitemap fora do domínio (recusado), sem sitemap.
- **Classificação e orçamento:** URL de produto, blog e preço recebem tipo e prioridade; respeita limites de página, tempo e texto.
- **Rota de stream:** ordem dos eventos com transporte falso, falha de uma página sem derrubar a leitura, retomada por
  `Last-Event-ID`, permissão e limite por hora.
- **Instagram:** `state` com destino fora da lista é recusado; volta para o onboarding; passo some com a variável desligada.
- **E2E do cadastro** no navegador real, com site que tem blog e produtos, medindo o tempo do primeiro evento e do primeiro
  resultado. Verificação honesta: o Hosting real na frente do Cloud Run só se testa em staging; a conexão do Instagram de
  cliente externo só depois da aprovação da Meta.

## Divisão em PRs

1. **BEZ-535:** ADR 0031, contrato de evento e rota de stream em volta da leitura atual (sem mudar o que se lê).
2. **BEZ-532:** instrumentação do tempo por etapa (pode entrar junto da 1).
3. **BEZ-534:** site inteiro (sitemap, classificação, orçamento).
4. **BEZ-533:** tela por etapas, depois do protótipo aprovado.
5. **BEZ-536:** passo do Instagram no onboarding, com `state` de destino e a variável de ambiente.
