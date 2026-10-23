# ADR 0022: a instrução do pedido é lida em contrato fechado e obedecida por código

- **Status:** proposto (SPEC 020, 23/10/2026)
- **Data:** 2026-10-23
- **Specs que dependem:** [SPEC 020](../specs/020-instrucoes-explicitas-do-pedido.md),
  [SPEC 012](../specs/012-agentes-instagram-fase-2.md) (decisões 1 e 4)

## Contexto

O motor híbrido ([ADR 0017](0017-motor-de-design-hibrido-com-biblioteca-de-layouts.md)) desenha texto, logo e
grade por código; o modelo de imagem só faz o visual e é proibido de escrever letras. O pedido da pessoa, porém,
chega como texto livre e hoje vira só um tema para o redator. O eval de 23/10/2026 mediu o resultado: pedido com
fundo, posição do logo, frase exata ou quantidade cumpre 3 de 6 exigências, 1 de 2 e 3 de 4. Pedir no prompt
"respeite o pedido" não segura (o mesmo aconteceu com "Corrija SÓ" na volta do revisor). A mesma necessidade
aparece no ajuste em texto livre depois do post pronto (BEZ-193).

## Decisão

1. **Um leitor de instruções separado do redator.** Uma chamada curta de texto devolve JSON; ela não escreve o post.
2. **O contrato é fechado e tem dono no código.** O JSON passa por um parser puro que aceita só as chaves da
   SPEC 020, descarta o resto e corta tamanhos. O texto do pedido é dado: nada do que a pessoa escreve cria chave,
   muda regra do revisor nem altera o prompt do sistema.
3. **Quem obedece é o código.** Posição, fundo, texto literal, quantidade e "o que não colocar" entram no design
   e no revisor por regra; o modelo escreve só o que a pessoa não ditou. Instrução não cumprida aparece como
   "Não aplicado" com o motivo, nunca some em silêncio.
4. **Uma instrução vale para um post.** Virar regra da marca continua sendo repetição com aceite (SPEC 019).
5. **O mesmo contrato serve ao pedido e ao ajuste depois do post pronto.**

## Consequências

- Uma chamada de texto a mais por pedido (frações de centavo), idempotente por hash em `generation_runs`.
- A família `marca` e as posições em grade entram no motor de layout; o revisor ganha três regras `directive_*`.
- Se o leitor errar, o erro é visível (selo "Aplicado" ou "Não aplicado" em Aprovar) e medido pelo eval, em vez de
  escondido num prompt longo.
- Instrução nova exige mudar o contrato, o parser e o revisor juntos: é mais trabalho que acrescentar uma linha
  de prompt, de propósito.
