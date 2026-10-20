# Pedido de revisão do app na Meta (publicação no Instagram)

> Preparação de 20/10/2026 (cartão BEZ-78). A publicação em contas de terceiros ([SPEC 011 R5](../specs/011-plataforma-generica-fase-1.md))
> só funciona sem restrição depois que a Meta aprova o app. Até lá, só contas com papel no app
> (tester) conectam. O prazo da revisão decide a data do primeiro cliente de fora.

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
| Permissões pedidas | `instagram_business_basic` e `instagram_business_content_publish`. Nada de insights, comentários ou mensagens nesta rodada: pedir a mais reprova |
| Plataforma | Web (a única que o Instagram Login aceita) |

## Lista do que a Meta pede

| # | Item | Quem | Depende de | Situação |
| --- | --- | --- | --- | --- |
| 1 | Conta de desenvolvedor Meta e portfólio empresarial da BEZ (Meta Business) | Matheus | e-mail da BEZ | a fazer |
| 2 | Business Verification do portfólio, com CNPJ, contrato social ou cartão CNPJ, site e domínio da BEZ | Matheus | domínio e e-mail (BEZ-28), site da BEZ no ar | a fazer, é o item mais lento e o que mais reprova por divergência de nome ou endereço |
| 3 | Criar o app (tipo empresa) com o produto "Instagram" e login Instagram | Matheus | 1 | a fazer |
| 4 | Política de privacidade e termos publicados em URL pública | Matheus e advogada | BEZ-32 | bloqueia o envio |
| 5 | Instruções de exclusão de dados: URL com o passo a passo e, melhor, o callback da Meta | Código (R5.4) | R5 | falta a rota pública do callback |
| 6 | Ícone 1024x1024 (gotas da Ekoai), categoria do app, e-mail comercial | Matheus | 3 | a fazer |
| 7 | Conta de teste: perfil profissional de Instagram da BEZ adicionado como tester no app | Matheus | 3 | a fazer |
| 8 | Fluxo R5 funcionando em staging: login, token cifrado, status da conexão, desconectar | Código | Cloud KMS em staging (SPEC 010, fase 3) | a construir |
| 9 | Publicar um post de verdade pelo fluxo (a chamada de API bem-sucedida que a Meta exige) | Código e Matheus | 7 e 8 | depende da fase 2 ou de um botão de teste |
| 10 | Vídeo por permissão: login completo, escolha da conta, e criação do post com legenda e hashtags até a publicação | Matheus | 8 e 9 | a gravar |
| 11 | Texto para o revisor: passo a passo, quando cada permissão é usada, credenciais de teste | Claude escreve, Matheus revisa | 8 | rascunho abaixo |
| 12 | Ambiente que o revisor consiga abrir sem VPN nem convite | Código | URL estável, ver risco 1 | a decidir |

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

Credenciais e segredo do TOTP do revisor **não entram neste arquivo** (repositório público): vão
só no formulário da Meta.
