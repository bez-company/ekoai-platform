# ADR 0016: site da Ekoai estático no Firebase Hosting do ekoai-prod, em repositório próprio

- **Status:** aceito
- **Data:** 2026-10-21
- **Specs que dependem:** [SPEC 015](../specs/015-site-da-ekoai-em-ekoai-com-br.md)
- **Estende:** ADR 0015 da plataforma BEZ, repositório `bez-platform` (um projeto por produto e ambiente)

## Contexto

O domínio `ekoai.com.br` foi registrado (DNS na GoDaddy) e a Ekoai não tem landing page. A página
apresenta o produto e leva a pessoa a criar a conta pagante (decisão do Matheus, 21/10/2026). Ela não
tem login, banco nem formulário: todo CTA é um link para o app. A conta de faturamento de teste só
aceita 5 projetos vinculados e já está no limite (SPEC 013, Etapa 2).

O site da BEZ roda em Cloud Run com o Hosting na frente porque o código é um Next.js com servidor. O
código dele ficou fora do git e só a imagem sobreviveu (BEZ-122): o repositório novo nasce com o
código e o CI desde o primeiro commit.

## Decisão

1. **Site estático.** Next.js com `output: 'export'`, servido pelo Firebase Hosting. Sem Cloud Run.
2. **No projeto `ekoai-prod`**, num site próprio do Hosting (`ekoai`, `ekoai.web.app`). É o mesmo
   produto e o mesmo ambiente, então cabe no D2 da SPEC 013 sem projeto novo, e o Firebase do
   projeto já existe (Identity Platform). O site padrão (`ekoai-prod`) fica livre.
3. **Repositório próprio, privado:** `bez-company/ekoai-website`. A infra fica neste repositório,
   em `infra/terraform/envs/ekoai-site`, com estado separado do `envs/prod`: um apply do site não
   toca no módulo da Ekoai nem espera a release da plataforma.
4. **Publicação pelo Workload Identity**, com um provider próprio (`github-site`) no pool `github` e
   uma conta (`ekoai-site-deploy`) que só tem `roles/firebasehosting.admin`. O PR publica num canal
   de preview de 7 dias; a `main` publica no ar com a variável `DEPLOY_LIVE=true`. Sem staging: o
   preview é o ambiente de conferência.
5. **Mapa de domínios:** `ekoai.com.br` serve o site, `www` redireciona para o apex, e
   `app.ekoai.com.br` é da plataforma ([BEZ-42](https://linear.app/bez-company/issue/BEZ-42)). O
   domínio só liga quando a página estiver pronta (`connect_domain`, desligado por padrão).

## Consequências

- Custo perto de zero: o Hosting tem franquia de 10 GB armazenados e 360 MB por dia de tráfego, e
  passa disso a centavos por GB. Nenhuma instância parada.
- A página não pode ter rota de API, cookie nem formulário que grava dado. Lista de espera, contato
  ou analytics com consentimento precisam de outro desenho (rewrite do Hosting para o Cloud Run do
  mesmo projeto, ou o app).
- Tokens do design system 06 ficam duplicados entre a plataforma e o site. Mudança de token passa
  pelos dois; um pacote compartilhado só vale quando houver um terceiro consumidor.
- `roles/firebasehosting.admin` é de projeto: a conta de deploy também alcança o site padrão. Aceito,
  porque o site padrão não serve nada hoje.
- O Firebase Hosting entrega cookies só com o nome `__session` para o Cloud Run. Isso não afeta o
  site, mas descarta o Hosting como porta do app em `app.ekoai.com.br` (o login usa outro cookie):
  o BEZ-42 segue com Load Balancer. Revisado pelo [ADR 0020](0020-dominio-da-plataforma-no-hosting-ate-o-lancamento.md):
  até o lançamento o app usa o Hosting com o cookie `__session`.

## Alternativas descartadas

- **Cloud Run com o Hosting na frente**, como o site da BEZ: paga cold start e imagem para servir
  HTML que não muda.
- **Projeto `ekoai-site-prod`:** não cabe na cota de 5 projetos e separa o que é o mesmo produto.
- **Pasta `site/` neste repositório:** reaproveitaria tokens e CI, mas o Matheus escolheu repositório
  próprio, como o site da BEZ.
- **Vercel:** sai do padrão da BEZ (ADR 0015) e o plano Hobby não aceita repositório privado de
  organização.
