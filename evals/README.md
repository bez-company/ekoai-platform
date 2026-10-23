# Eval da geração de post

Mede se o post que a plataforma gera cumpre o que a pessoa pediu. Os testes da suíte normal provam que o
código faz o que o código diz; este eval prova (ou não) que o **modelo e os agentes** entregam o pedido.

## O que roda

Para cada caso de `cases.js`:

1. `pipeline.js` leva o pedido ao PNG pelo mesmo caminho do `generatePost`: prompt do redator, até 3 rodadas
   com o revisor por regra, visual por IA (só na atmosfera), grade e render por código.
2. `judge.js` manda o PNG final, a legenda e as exigências do caso a um modelo com visão, que responde
   passou ou reprovou por exigência, com o motivo. Exigência com `contains` também é conferida por código
   (o texto está na imagem desenhada); o código derruba um juiz otimista, nunca aprova no lugar dele.
3. O relatório sai em `.context/evals/<data>/`: `report.md`, `results.json` e, por caso, `post.png`,
   `visual.png` e `trace.json` (prompt e resposta de cada rodada, achados do revisor).

## Como rodar

```bash
VERTEX_PROJECT_ID=ekoai-prod npm run eval                    # todos os casos
VERTEX_PROJECT_ID=ekoai-prod EVAL_CASES=frase-exata npm run eval   # só um
```

Precisa de credencial do Google Cloud (`gcloud auth application-default login`). Chama o Vertex de verdade:
um conjunto completo custa cerca de US$ 0,10 a 0,15 (imagem 3.1 Flash, texto 3 Flash). Por isso fica fora de
`npm test`. Variáveis: `VERTEX_TEXT_MODEL`, `VERTEX_IMAGE_MODEL` (padrão = o da produção) e
`EVAL_JUDGE_MODEL` (padrão = o modelo de texto; use outro para evitar o juiz gostar do próprio texto).

## Como escrever um caso

- O pedido é o que a pessoa digita em "Criar post", palavra por palavra. Caso novo vem de um post real que
  saiu errado (guarde o pedido em `briefs.idea`; o rastro completo da chamada fica em `generation_runs`).
- As exigências são escritas por uma pessoa, olhando o pedido, e dizem algo que se confere na imagem ou na
  legenda ("o logo está no centro", não "a imagem está bonita"). Nunca peça ao modelo medido para listá-las.
- Empresa fictícia: este repositório é público. Nada de cliente real em `cases.js`.

## Limites

- O juiz é um modelo: erra. O resultado muda de uma rodada para outra (o caso principal foi 3 de 6 nas duas
  primeiras, com layouts diferentes). Olhe a tendência e o `post.png`, não um número isolado.
- `pipeline.js` espelha o `generatePost` à mão. Se o orquestrador mudar a ordem ou a escolha de layout, mude
  o espelho junto (ou extraia a parte pura do `generatePost` para os dois usarem).
- Julga a imagem final e a legenda. Não mede custo, tempo nem publicação.
