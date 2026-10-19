# ADR 0009: mídia em bucket privado, servida pela rota /api/media

- **Status:** aceito
- **Data:** 2026-10-19
- **Specs que dependem:** [SPEC 010](../specs/010-migracao-google-cloud.md) (fase 1)
- **Ajusta:** o item 5 do [ADR 0006](0006-google-cloud-como-plataforma.md) ("URL assinada")

## Contexto

As artes (PNG), os PDFs de carrossel e os vídeos iam para um bucket público do Supabase, e o banco
guarda a URL (`images`, `slideUrls`, `documentUrl`, `image_url`). O Instagram, o LinkedIn e o X
buscam a mídia por URL no momento de publicar, que pode ser dias depois de gerar. Uma URL assinada
do Cloud Storage vale no máximo 7 dias, então a URL guardada morreria antes de um agendamento
distante, e trocar a coluna por chave de objeto mexeria em todos os publicadores e telas. Além
disso, bucket com leitura pública costuma ser barrado pela política de organização do Google Cloud.

## Decisão

1. O bucket é **privado**. O job grava em `images/<uuid>.png` ou `documents/<uuid>.pdf`.
2. A URL guardada aponta para a **rota pública `/api/media/<chave>` da plataforma**, que lê do
   bucket e entrega com `Cache-Control` imutável e suporte a `Range` (vídeo). Quem consome a URL
   (as redes e as telas) não muda.
3. A proteção é a **chave com UUID** e o **formato fixo** (`images|documents`, UUID, extensão
   conhecida); qualquer outra coisa é 404 sem tocar no bucket.
4. `MEDIA_BASE_URL` define o prefixo gravado na URL.

## Consequências

- A URL de mídia depende da origem da plataforma: trocar o domínio depois de gerar mídia quebra as
  URLs já guardadas. Por isso o domínio próprio entra antes de haver mídia de cliente, ou as linhas
  antigas são reescritas.
- Rascunho de cliente não é privado de verdade: quem tem a URL lê, como em qualquer link
  não adivinhável. Para o conteúdo de clientes (SaaS), a evolução é guardar a chave e assinar na
  leitura, e é uma SPEC própria.
- A plataforma paga a banda de saída da mídia; a CDN (Cloud CDN, ADR 0006 item 6) resolve quando
  houver domínio.
- A leitura do bucket foi testada com arquivo simulado; contra o Cloud Storage real fica para o
  spike da fase 3.
