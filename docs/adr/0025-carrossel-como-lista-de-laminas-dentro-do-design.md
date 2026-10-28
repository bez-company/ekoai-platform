# ADR 0025: o carrossel é um post com uma lista de lâminas dentro do design

- **Status:** proposto (SPEC 023, 23/10/2026)
- **Data:** 2026-10-23
- **Specs que dependem:** [SPEC 023](../specs/023-carrossel-e-previa-na-grade.md),
  [SPEC 019](../specs/019-estudio-incremental-e-aprendizado-com-a-edicao.md) (revisão e ajuste rápido)

## Contexto

Um post vira uma linha em `post_designs` (um layout, um texto, um PNG) e uma `pending_approvals` com uma imagem.
A revisão imutável ([ADR 0021](0021-revisao-imutavel-com-diff-por-campo.md)) guarda o design inteiro de cada
versão e compara campo a campo; o conflito de edição se resolve pela versão. O envio do carrossel à Meta já
existe (`scheduled_posts.slide_urls`, `publishCarousel`), vindo do fluxo antigo, mas nada gera nem edita lâminas.
O carrossel precisa de 2 a 10 PNGs (era 2 a 6; 10 é o teto do Instagram, BEZ-373) que mudam juntos, com um visual só em cache e o custo de imagem de um post comum.

## Decisão

1. **Uma lâmina é parte do design, não um post nem uma linha de tabela.** `StoredDesign` ganha `slides?: Slide[]`,
   onde cada `Slide` tem `role` (`cover`, `content`, `cta`), `layout`, `texts` e as chaves de cor e logo que já
   existem por post. Sem `slides`, o post é imagem única, como hoje: nenhum dado antigo muda.
2. **A capa espelha o post.** `post_designs.layout`, `design.texts` e `png_key` continuam sendo os da primeira
   lâmina, para agenda, publicados, métricas e miniaturas não saberem que existe carrossel. Os PNGs das demais ficam
   em `design.slides[n].pngKey`, e `pending_approvals.images` leva um item por lâmina.
3. **A revisão e o diff não mudam de mecanismo.** O campo do diff ganha o prefixo `slides.<n>.` e o resto
   (versão, conflito, desfazer, restaurar) segue igual. O limite de 64 KB do `design` cabe em seis lâminas; com dez, confira o tamanho do `design` (BEZ-373).
4. **Um visual por post.** `post_designs.visual_key` é o da capa; as outras lâminas usam a cor da marca. Visual
   novo por lâmina é do Studio completo e conta no limite do plano como qualquer visual.
5. **Sem migration.** Tudo vive no `jsonb` que já existe. A única exceção possível é um `check` para o número de
   lâminas, que não é necessário porque o parser recusa fora de 2 a 10 antes de gravar.

## Consequências

- Nenhuma tabela nova, nenhuma RLS nova: o isolamento entre contas é o de `post_designs`.
- Consulta por lâmina ("quantos carrosséis a conta tem") fica em `jsonb`; se virar relatório frequente, uma
  coluna `format` indexada entra numa migration aditiva, sem mexer neste desenho.
- Editar duas lâminas ao mesmo tempo é conflito de versão do post inteiro (a segunda pessoa recebe 409), igual a
  editar dois campos hoje. Aceito: a edição é rara e o conflito é visível.
- A capa espelhada é uma duplicação deliberada; o teste de design confere que as duas coincidem.
- Reordenar, apagar e acrescentar lâmina são operações sobre a lista e entram depois, sem mudar este formato.
- A troca entre imagem única e carrossel (SPEC 023, decisão 9) é uma revisão nova do mesmo design: `slides`
  aparece ou some, e o desfazer volta ao formato anterior.
