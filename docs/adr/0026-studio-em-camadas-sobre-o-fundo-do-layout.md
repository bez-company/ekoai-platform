# ADR 0026: o Studio edita camadas (cena) sobre o fundo do layout

- **Status:** aceito (SPEC 027, 28/10/2026)
- **Data:** 2026-10-28
- **Specs que dependem:** [SPEC 027](../specs/027-studio-editor-livre.md), [SPEC 019](../specs/019-estudio-incremental-e-aprendizado-com-a-edicao.md) (versões)
- **Decisões que toca:** [ADR 0017](0017-motor-de-design-hibrido-com-biblioteca-de-layouts.md) (o motor de layouts), [ADR 0021](0021-revisao-imutavel-com-diff-por-campo.md) (a revisão), [ADR 0025](0025-carrossel-como-lista-de-laminas-dentro-do-design.md) (o carrossel)

## Contexto

O design de um post é um layout, um texto e o canto do logo. A pessoa escolhe entre alguns layouts e não pode mover nem redimensionar nada. O pedido
é editar a imagem inteira dentro da Ekoai, como no Canva. Cada família de layout (ADR 0017) devolve um SVG pronto; não há lista de elementos com posição.

## Decisão

1. O design ganha um campo opcional `scene`: lista ordenada de camadas (`text`, `shape`, `logo`), cada uma com posição, largura, giro e opacidade.
   Post sem `scene` segue como era. No carrossel cada lâmina tem a sua (`slides[n].scene`).
2. **O fundo do layout não vira camada.** Foto, véu, círculos e barras continuam desenhados pelo motor a cada render, a partir do design. A conversão
   (`scene-convert.ts`) lê o SVG que o próprio motor escreveu: cada `<text>` vira uma camada de texto (com as linhas como o motor quebrou) e a `<image>` da logo vira
   a camada de logo. Abrir o layout numa cena e desenhá-la sem mexer dá o mesmo post, pixel a pixel (`tests/scene.test.js`, todas as famílias).
3. **Um desenho só.** `scene.ts` é puro e sem `node:*`: o servidor desenha o PNG com ele (resvg) e o navegador mostra o mesmo SVG, com a mesma conta de quebra de
   linha (`font-metrics.ts`, a tabela de larguras, separada do que lê disco). O PNG do servidor é a verdade; o revisor de layout confere as caixas das camadas.
4. **A logo entra como foi enviada:** sem placa, moldura nem filtro. A versão (principal, fundo escuro, fundo claro, símbolo) é escolha da pessoa.
5. Gravar é `PUT /design/scene` (valida o formato na entrada, `parseScene`), que passa pelo mesmo `commit` do ajuste rápido: versão nova, conflito 409 por versão, revisor,
   PNG novo. Um ajuste pelos campos (texto, cor, layout) tira a cena e volta ao layout automático.
6. Baixar: `GET /design/export?format=png|svg`. O SVG tem cada texto e a logo como elementos; a fonte precisa estar instalada onde for aberto.

## Consequências

- O aprendizado com a edição (SPEC 019) lê o diff por campo; uma edição de camadas só aparece como "imagem editada no Studio" e ainda não vira regra de marca.
- O revisor de texto contra os fatos lê o texto das camadas (o número do círculo da lista numerada fica de fora).
- Imagem do banco como camada e PDF com camadas ficam para as próximas fases. Texto muito diferente do original pode precisar de espaço: o revisor avisa
  sobreposição e margem.
- `render.ts` passa a escolher o caminho pelo `scene`; todo render de post (geração, edição, exportação) continua passando por `renderPng`.
