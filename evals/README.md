# Eval da geração de post

Mede se o post que a plataforma gera cumpre o que a pessoa pediu e se está bem feito. Os testes da suíte
normal provam que o código faz o que o código diz; este eval prova (ou não) que o **modelo e os agentes**
entregam. Toda mudança na geração (prompt, agente, revisor, layout) é medida aqui antes e depois.

## O que roda

Para cada caso de `cases.js` (20 pedidos, 3 empresas fictícias de jeitos de falar diferentes):

1. `pipeline.js` leva o pedido ao PNG pelo mesmo caminho do `generatePost`: prompt do redator, até 3 rodadas
   com o revisor por regra, visual por IA (só na atmosfera), grade e render por código.
2. `judge.js` manda o PNG final, a legenda, a base de fatos da empresa e as exigências a um modelo com
   visão (padrão `gemini-3.1-pro-preview`, mais forte que o redator), que responde passou ou reprovou por
   exigência, com o motivo. Se o juiz falha (formato, corte), repete uma vez; falhando de novo, a rodada
   sai da nota e aparece como "sem nota".
3. Três grupos de exigência:
   - **Pedido**: o que a pessoa pediu, escrito à mão por caso (`requirements`). Exigência com `contains`
     também é conferida por código (o texto está na imagem desenhada); o código derruba um juiz otimista,
     nunca aprova no lugar dele.
   - **Ofício**: a régua `CRAFT` que vale para todo post (português, clichê, voz, gancho, recheio, coerência,
     legibilidade, composição, "postaria sem editar").
   - **Código**: `metrics.js` (travessão, emoji na imagem, hashtags, revisor ainda reprovando o resultado).
4. `report.js` resume por caso, por exigência e por tag (`marca`, `texto-exato`, `lista`, `atmosfera`, `fato`,
   `vago`, `voz`), com rodadas do redator e custo por post.

Relatório em `.context/evals/<data>/`: `report.md`, `summary.json`, `results.json` e, por caso e rodada,
`post.png`, `visual.png`, `trace.json` (prompt e resposta de cada rodada) e `verdicts.json`.

## Como rodar

```bash
VERTEX_PROJECT_ID=ekoai-prod npm run eval                       # 1 rodada de todos os casos
VERTEX_PROJECT_ID=ekoai-prod EVAL_RUNS=2 npm run eval           # 2 rodadas por caso (o modelo varia)
VERTEX_PROJECT_ID=ekoai-prod EVAL_TAGS=marca,fato npm run eval  # só casos com estas tags
VERTEX_PROJECT_ID=ekoai-prod EVAL_CASES=frase-exata npm run eval
EVAL_SAVE=nome ...                                              # grava o resumo em evals/baselines/nome.json
EVAL_REUSE=<pasta de .context/evals> ...                        # julga de novo posts já gravados, sem gerar
npm run eval:compare -- evals/baselines/a.json evals/baselines/b.json   # antes e depois, em pontos percentuais
```

Precisa de credencial do Google Cloud (`gcloud auth application-default login`). Chama o Vertex de verdade:
cerca de US$ 0,02 por post (US$ 0,40 por rodada de todos os casos). Por isso fica fora de `npm test`.
Variáveis: `VERTEX_TEXT_MODEL`, `VERTEX_IMAGE_MODEL` (padrão = os da produção), `EVAL_JUDGE_MODEL`.

## Baselines

`evals/baselines/` guarda o resumo (sem imagem) de cada marco. A PR que muda a geração anexa o antes e o
depois do `eval:compare` no corpo. `baseline-0` é o código de 23/10/2026, antes de qualquer correção.

## Como escrever um caso

- O pedido é o que a pessoa digita em "Criar post", palavra por palavra. Caso novo vem de um post real que
  saiu errado (guarde o pedido em `briefs.idea`; o rastro completo da chamada fica em `generation_runs`).
- As exigências são escritas por uma pessoa, olhando o pedido, e dizem algo que se confere na imagem ou na
  legenda ("o logo está no centro", não "a imagem está bonita"). Nunca peça ao modelo medido para listá-las.
- Empresa fictícia: este repositório é público. Nada de cliente real em `cases.js`.

## Limites

- O juiz é um modelo: erra. Foi calibrado olhando imagens à mão (acerta o pedido; a régua de ofício foi
  apertada depois de ele aprovar post genérico). O resultado muda de uma rodada para outra: use
  `EVAL_RUNS=2` ou mais e olhe a tendência e o `post.png`, não um número isolado.
- `pipeline.js` espelha o `generatePost` à mão. Se o orquestrador mudar a ordem ou a escolha de layout, mude
  o espelho junto.
- Julga a imagem final e a legenda. Não mede publicação.
