# Pedido de revisão do app na Meta (publicação no Instagram)

> Preparação de 20/10/2026 (cartão BEZ-78). A publicação em contas de terceiros ([SPEC 011 R5](../specs/011-plataforma-generica-fase-1.md))
> só funciona sem restrição depois que a Meta aprova o app. Até lá, só contas com papel no app
> (tester) conectam. O prazo da revisão decide a data do primeiro cliente de fora.
>
> Atualização de 26/10/2026 (cartão BEZ-332): o app passou a pedir também `instagram_business_manage_insights`
> (BEZ-264), usada pelas telas Analytics, Aprendizado e Horários (SPEC 022). Ela está em acesso padrão,
> que já vale para contas com papel no app. O acesso avançado, para clientes de fora, entra neste mesmo
> pedido. O documento foi escrito antes e dizia "nada de insights"; as seções abaixo já refletem as três permissões.

## O que foi verificado e o que não foi

- **Verificado na página oficial** ([App Review for Instagram API](https://developers.facebook.com/docs/instagram-platform/app-review)):
  Advanced Access exige App Review; um vídeo por permissão; instruções e credenciais para o
  revisor; ao menos uma chamada de API bem-sucedida; URL da política de privacidade, ícone
  1024x1024, categoria e e-mail comercial; pedir só as permissões que o app usa; um tipo de login
  por app (Instagram Login ou Facebook Login, nunca os dois).
- **Não verificado (fontes de terceiros ou memória):** prazo da revisão (guias falam em 2 a 4
  semanas), exigência de Business Verification para estas permissões (a Meta exige para Advanced
  Access desde 2023, mas a página de revisão do Instagram não cita) e o texto exato do vídeo. Conferir
  no painel do app antes de enviar.

## Escolhas já feitas

| Tema | Decisão |
| --- | --- |
| Tipo de login | Instagram Login (a SPEC 011 R5 já diz). Não precisa de Página do Facebook |
| Tipo de conta | Profissional (empresa ou criador). Conta pessoal não publica |
| Permissões pedidas | `instagram_business_basic`, `instagram_business_content_publish` e `instagram_business_manage_insights`. Nada de comentários ou mensagens: pedir a mais reprova. Os insights entram porque três telas dependem deles e cada uma é demonstrada no vídeo |
| Plataforma | Web (a única que o Instagram Login aceita) |

## Lista do que a Meta pede

| # | Item | Quem | Depende de | Situação |
| --- | --- | --- | --- | --- |
| 1 | Conta de desenvolvedor Meta e portfólio empresarial da BEZ (Meta Business) | Matheus | e-mail da BEZ | a fazer |
| 2 | Business Verification do portfólio, com CNPJ, contrato social ou cartão CNPJ, site e domínio da BEZ | Matheus | domínio e e-mail (BEZ-28), site da BEZ no ar | a fazer, é o item mais lento e o que mais reprova por divergência de nome ou endereço |
| 3 | Criar o app (tipo empresa) com o produto "Instagram" e login Instagram | Matheus | 1 | a fazer |
| 4 | Política de privacidade e termos publicados em URL pública | Matheus e advogada | BEZ-32 | política publicada em 22/10/2026 (BEZ-222) e gravada nos apps; termos dependem da advogada |
| 5 | Instruções de exclusão de dados e callback de desautorização (a tela do app na Meta pede os dois URLs antes do envio) | Código (R5.4) | R5 | feito: rotas com `signed_request` verificado (BEZ-215) e URLs registradas no app em 23/10/2026 (BEZ-255) |
| 6 | Ícone 1024x1024 (gotas da Ekoai), categoria do app, e-mail comercial | Matheus | 3 | a fazer |
| 7 | Conta de teste: perfil profissional de Instagram da BEZ adicionado como tester no app | Matheus | 3 | a fazer |
| 8 | Fluxo R5 funcionando em staging: login, token cifrado, status da conexão, desconectar | Código | Cloud KMS em staging (SPEC 010, fase 3) | construído em 22/10/2026 (BEZ-212), falta exercitar no staging com um testador |
| 9 | Publicar um post de verdade pelo fluxo (a chamada de API bem-sucedida que a Meta exige) | Código e Matheus | 7 e 8 | depende da fase 2 ou de um botão de teste |
| 10 | Vídeo por permissão: login completo, escolha da conta, e criação do post com legenda e hashtags até a publicação | Matheus | 8 e 9 | a gravar |
| 11 | Texto para o revisor: passo a passo, quando cada permissão é usada, credenciais de teste | Claude escreve, Matheus revisa | 8 | rascunho abaixo |
| 12 | Ambiente que o revisor consiga abrir sem VPN nem convite | Código | URL estável, ver risco 1 | a decidir |
| 13 | Vídeo de `instagram_business_manage_insights`: Analytics, Aprendizado e Horários com dados da conta de teste (roteiro abaixo) | Matheus | 8 e 14 | a gravar |
| 14 | Conta de teste com posts publicados e alcance lido; para ver faixa etária e gênero, 100 seguidores ou mais (risco 7) | Matheus | 7 | `@ekoai.app` tem 2 seguidores (lido no staging em 26/10/2026) e 4 posts com alcance lido. Decisão: o vídeo vai sem demografia |
| 15 | Uma chamada de API bem-sucedida de insights | Código | 14 | feito para alcance e salvamentos por post (staging, 26/10/2026). `follower_demographics` e `online_followers` ficam no BEZ-326, adiado até haver conta com 100 seguidores |

## Riscos

1. **Revisor não consegue entrar.** O cadastro exige e-mail confirmado e app autenticador (TOTP).
   O revisor precisa de uma conta já criada, com o segredo do TOTP no texto das instruções (ou uma
   conta de revisão sem segundo fator, só neste ambiente). Falha de acesso derruba o envio inteiro.
2. **Ambiente.** Revisar no staging é aceitável se a URL for estável e o app ficar em modo ao vivo
   depois. Produção ainda está em modo senha (BEZ-30) e sem limite de tentativas (BEZ-29): resolver
   antes de abrir o cadastro ao público.
3. **Vídeo em português.** A plataforma é pt-BR. A Meta pede UI em inglês se possível e, senão,
   legendas e dicas. Gravar com legenda em inglês sobre cada passo.
4. **Nome e dados da BEZ divergentes** entre CNPJ, site, domínio e portfólio derrubam a Business
   Verification. Conferir letra por letra antes de enviar.
5. **Prazo.** Sem estimativa oficial. Planejar o primeiro cliente de fora para depois da aprovação,
   não para a semana do envio. Uma recusa volta com motivo e leva nova rodada.
6. **Projeto Fé e crianças:** conteúdo com menores entra na política de uso da Meta e na LGPD.
   Registrar na política de privacidade que a plataforma não publica rosto de criança sem
   autorização (a regra está na SPEC 012).

7. **Conta de teste pequena.** A Meta só devolve `follower_demographics` com 100 seguidores ou mais, e
   `online_followers` não consta na tabela de métricas da documentação atual (conferido em 23/10/2026).
   Com menos de 100 seguidores o revisor só vê alcance, salvamentos e compartilhamentos por post, que não
   têm mínimo. O app trata o caso (a tela diz "faltam N seguidores" e a coleta guarda o estado), mas o
   vídeo não pode prometer demografia sem uma conta que a mostre. O `@ekoai.app` tem 2 seguidores
   (26/10/2026), e a decisão foi gravar o vídeo só com as métricas por post e mostrar o estado "Faltam
   N seguidores" como comportamento esperado da Meta. A demografia é verificada depois, no BEZ-326,
   quando uma conta com 100 seguidores ou mais conectar.
8. **Insights sem uso visível.** O revisor reprova permissão que o vídeo não mostra sendo usada. Cada
   tela que lê insights precisa aparecer no vídeo, com a legenda dizendo qual dado vem da Meta.

## Ordem recomendada

1. Agora, em paralelo ao código: itens 1, 2 e 3 (Business Verification é o gargalo e não depende
   de nada do repositório). Item 4 com a advogada.
2. Código: callback de exclusão de dados e fluxo R5 em staging, com tester conectado (itens 5, 8).
3. Quando R5 funcionar: itens 7, 9, 10 e 11, depois enviar.
4. Depois da aprovação: modo ao vivo no app, trocar tester por contas reais, atualizar a SPEC 011.

## Rascunho do texto para o revisor (item 11)

> Ekoai is a web platform where small businesses prepare Instagram posts and publish them to their
> own professional account after a person approves them. Nothing is published without an explicit
> approval click.
>
> `instagram_business_basic`: after login, we read the account id and username to show which
> account is connected and to attach publishing to it (screen "Settings, Instagram").
>
> `instagram_business_content_publish`: when the person approves a post, we publish the image with
> its caption through the content publishing endpoints (screen "Approve").
>
> Test access: open the staging URL, sign in with the reviewer account below (the authenticator
> secret is included so you can generate the code), go to Settings, Instagram, click Connect, and
> log in with the tester Instagram account. Then create a post and approve it.
>
> Data deletion: Settings, Data and privacy, delete the account, or use the data deletion callback
> configured in the app. Disconnecting removes the stored token.

> `instagram_business_manage_insights`: we read, for the connected account only, the reach, saves,
> shares and views of each post we published (`/{media-id}/insights`) and, when the account has at
> least 100 followers, the age and gender breakdown of the followers (`follower_demographics`, in
> aggregate fractions). We never read or store data about individual followers. The numbers are shown in
> "Published, Analytics" (what worked, who the audience is, when it is active) and in "Learning, Audience".
> They also feed the suggestion of publishing hours in the "Schedule, Hours" dialog. The person decides
> whether an observation is used as a hint for new post ideas; nothing is published because of an
> insight, and nothing leaves the account.

Credenciais e segredo do TOTP do revisor **não entram neste arquivo** (repositório público): vão
só no formulário da Meta.

## Roteiro do vídeo de `instagram_business_manage_insights` (item 13)

Gravar em inglês ou com legenda em inglês sobre cada passo. Dado fictício ou da conta de teste, nunca de
cliente. Um vídeo só para esta permissão, uns 3 minutos.

1. Settings, Instagram: mostrar a conta conectada e, na tela de consentimento do Instagram, o item
   "Access and manage insights" sendo concedido (se a conta já concedeu, reconectar para mostrar).
2. Published, Analytics: abrir a aba. Legenda: "Reach and engagement come from `/{media-id}/insights`".
   Mostrar "O que funciona" (tipo, formato, objetivo) e dizer que compara os posts da própria conta.
3. Mesma tela, "Seu público": com a conta de teste atual (menos de 100 seguidores), mostrar a mensagem
   "Faltam N seguidores". Legenda: "Meta returns age and gender only from 100 followers; the app reads
   them with `follower_demographics`, aggregate only, as soon as the account reaches it". Se houver uma
   conta com 100+, mostrar faixa etária e gênero no lugar.
4. Mesma tela, "Quando seu público está ativo": mostrar o gráfico por hora e a faixa de recomendação.
5. Schedule, Hours: abrir o diálogo, mostrar a recomendação e clicar em "Usar estes horários". Legenda:
   "The person confirms; nothing changes until they save".
6. Learning, Audience: mostrar as observações e ligar uma. Legenda: "A turned-on observation is a hint for
   new ideas, never a rule and never a publication".
7. Encerrar mostrando Settings, Data and privacy (exclusão) e o botão de desconectar, que apaga o token.

Antes de gravar, rodar o BEZ-326 para confirmar no staging o que a Meta devolve de verdade (formato,
`timeframe` aceito, existência e fuso de `online_followers`) e ajustar as legendas ao que apareceu.
