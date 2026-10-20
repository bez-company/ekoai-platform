# ADR 0014: logo da empresa guardado no bucket privado e servido por rota autenticada

- **Status:** aceito
- **Data:** 2026-10-20
- **Specs que dependem:** [SPEC 011](../specs/011-plataforma-generica-fase-1.md) (R3)
- **Relacionado:** [ADR 0009](0009-midia-em-bucket-privado-servida-pela-plataforma.md) (mídia pública por chave)

## Contexto

O logo da empresa entra no perfil (fase 1) e só vira arte na fase 2. A mídia que a plataforma já
guarda (artes, PDFs, vídeos) é lida por redes sociais que buscam por URL ao publicar, então o ADR 0009
a serve por uma rota pública, protegida só por chave com UUID. O logo é outra coisa: é arquivo de uma
conta, enviado por um usuário, que ninguém de fora precisa buscar. Um SVG enviado por usuário também
pode carregar script.

## Decisão

1. **Bucket privado, caminho por conta:** `tenants/<conta>/logo/<uuid>.<png|svg>`, o mesmo bucket das
   artes. A rota pública `/api/media/<chave>` só aceita `images/` e `documents/`, então não serve o
   logo (testado). O banco repete a regra: `brand_assets.storage_path` precisa começar por
   `tenants/<conta>/` (migration 0017).
2. **Leitura só com sessão:** `GET /api/brand/logo` (`profile.view`, ou seja, administrador e criador;
   o leitor recebe 403). Envio e troca (`POST`) e remoção (`DELETE`) exigem `brand.manage`. O
   endereço leva o id do logo (`?v=`), então trocar o logo troca a URL e o cache privado é seguro.
3. **O tipo vem dos bytes, não do nome nem do Content-Type.** PNG: assinatura, chunks conferidos um a
   um, `IHDR` com lado de até 4096 px, cortado no `IEND` (nada escondido depois). SVG: lido como XML e
   **reescrito** só com elementos e atributos de uma lista permitida; sinal claro de arquivo hostil
   (script, `foreignObject`, imagem ou fonte externa, manipulador de evento, DOCTYPE, entidade
   própria, `url()` para fora) recusa o arquivo com a mensagem do que trocar. Até 2 MB.
4. **Cabeçalhos de defesa em profundidade:** a resposta leva `nosniff` e uma CSP com `sandbox` e
   `default-src 'none'`, de modo que abrir o endereço direto não executa nada. A CSP geral do
   `next.config.mjs` sobrescreve a que a rota define, por isso a regra específica do logo mora lá,
   depois da geral (há um teste que a protege).
5. **Troca e remoção respeitam a FK:** o perfil deixa de apontar para o logo antigo antes de a linha
   dele sair; o arquivo antigo é apagado por último (se falhar, sobra um objeto órfão e vai para o
   log). Cada troca e remoção vai para a auditoria, sem o conteúdo.

## Consequências

- Quem consome o logo (a fase 2, que compõe as artes) lê pelo servidor, com a sessão da conta, ou
  gera a arte no servidor; não há URL pública do logo.
- A exportação dos dados (LGPD) hoje leva só os metadados de `brand_assets`; incluir o arquivo no
  pacote fica junto da exclusão da conta (R8).
- **Excluir a conta (R8) precisa apagar o prefixo `tenants/<conta>/`** do bucket, além das linhas.
- Logo em formato raster além de PNG (JPG, WebP) não entra: a SPEC pede PNG ou SVG, e o PNG com fundo
  transparente cobre o caso.
- Desenvolvimento sem Cloud Storage: `LOCAL_BLOB_DIR` guarda os arquivos numa pasta (ignorada em
  produção).
