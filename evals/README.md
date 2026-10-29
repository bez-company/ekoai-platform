# Eval da geração de post

Mede se o post que a plataforma gera cumpre o que a pessoa pediu e se está bem feito. Os testes da suíte
normal provam que o código faz o que o código diz; este eval prova (ou não) que o **modelo e os agentes**
entregam. Toda mudança na geração (prompt, agente, revisor, layout) é medida aqui antes e depois.

## O que roda

Para cada caso de `cases.js` (23 pedidos, 3 empresas fictícias de jeitos de falar diferentes):

1. `pipeline.js` leva o pedido ao PNG pelo mesmo caminho do `generatePost`: leitor de instruções do pedido
   (SPEC 020), prompt do redator, até 3 rodadas com o revisor por regra, visual por IA (só na atmosfera, e não
   no cartão de marca), composição das instruções e render por código.
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
   - **Leitor**: nos casos com `directives`, o que o leitor de instruções anotou contra o que uma pessoa esperava
     (nota própria; `npm run eval:directives` mede só ele, por frações de centavo).
   - **Envio** (SPEC 028, BEZ-417): o caso que declara `sendTarget` (quem receberia o post, escrito à mão olhando o pedido)
     ganha a exigência `envio`, o teste "alguém mandaria isso a essa pessoa?". Nota própria, "Envio".
   - **LinkedIn** (SPEC 028): o caso com `linkedin: true` também gera o texto do LinkedIn, a partir do núcleo da ideia, como o
     `generatePost`. Um juiz só do texto (`buildLinkedInJudgePrompt`, régua `LINKEDIN_CRAFT`) e as checagens por código
     (`linkedinChecks`) dão a nota "LinkedIn".
   - **Avaliador de sinais** (BEZ-425): o pipeline roda o mesmo avaliador e o mesmo conserto de uma volta da geração, então a
     legenda medida é a final. O relatório conta quantos posts caíram em cada faixa e em quantos o conserto valeu.
     `EVAL_CRITIC=off` mede sem ele (para comparar o ganho do avaliador).
4. `report.js` resume por caso, por exigência e por tag (`marca`, `texto-exato`, `lista`, `atmosfera`, `fato`,
   `vago`, `voz`), com rodadas do redator e custo por post.

Relatório em `.context/evals/<data>/`: `report.md`, `summary.json`, `results.json` e, por caso e rodada,
`post.png`, `visual.png`, `trace.json` (prompt e resposta de cada rodada) e `verdicts.json`.

## Como rodar

**Onde gasta (BEZ-458):** os evals rodam no projeto `ekoai-staging` por padrão, com o orçamento dele, e toda chamada leva
`origin=eval` e `step` (o painel de custo da BEZ, visão `cost_ai`, separa eval de produto por esses labels). O
`ekoai-prod` é recusado, a não ser que você mande `EVAL_ALLOW_PROD=1` de propósito: uma rodada completa já custou
centenas de reais no outubro de 2026 e entrou na conta de produção sem dono. `VERTEX_PROJECT_ID` troca o projeto.

```bash
npm run eval                                                               # 1 rodada de todos os casos
EVAL_RUNS=2 npm run eval           # 2 rodadas por caso (o modelo varia)
EVAL_TAGS=marca,fato npm run eval  # só casos com estas tags
EVAL_CASES=frase-exata npm run eval
EVAL_SAVE=nome ...                                              # grava o resumo em evals/baselines/nome.json
EVAL_REUSE=<pasta de .context/evals> ...                        # julga de novo posts já gravados, sem gerar
node evals/summarize.js <pasta> [nome]                          # resume (e grava baseline) de uma rodada, até interrompida
npm run eval:compare -- evals/baselines/a.json evals/baselines/b.json   # antes e depois, em pontos percentuais
```

Precisa de credencial do Google Cloud (`gcloud auth application-default login`). Chama o Vertex de verdade:
cerca de US$ 0,02 por post (US$ 0,40 por rodada de todos os casos). Por isso fica fora de `npm test`.
Variáveis: `VERTEX_TEXT_MODEL`, `VERTEX_IMAGE_MODEL` (padrão = os da produção), `EVAL_JUDGE_MODEL`.

## Eval da legenda e das hashtags

`npm run eval:caption` (BEZ-373) mede só o texto, sem imagem: 7 casos de `caption-cases.js` (conta local, nacional,
internacional, sem resposta sobre o alcance, chamada escolhida e conta sem chamada). O redator roda como na geração
(`pipeline.js`, `writeCopy`) e um juiz só de texto (`caption-judge.js`) confere cada exigência. O código confere
`captionChecks` (`metrics.js`): hashtag com a cidade em conta nacional, "link na bio" que ninguém escolheu, "link"
inventado, hashtag com ano e chamada final numa conta que a omitiu. Custa menos de US$ 0,01 por caso.
`baseline-7-legenda-antes` é o código de 27/10/2026 (pedido 78%, hashtag da cidade em 6 de 14 legendas, chamada final em
4 de 6 legendas de conta sem chamada); `baseline-8-legenda-depois` tem o alcance e a chamada no prompt e a regra
`hashtag_city` e `link_bio` no revisor.

## Orçamento (29/10/2026)

Todo eval soma o custo de cada chamada paga e, passando do orçamento (`EVAL_BUDGET_USD`, padrão US$ 1 por processo), a próxima chamada
falha antes de gastar (`guard.js`). Rodada maior que isso só com o valor dito de propósito. Os evals do estúdio já custaram centenas de
reais; a regra agora é **não rodar eval pago sem necessidade**, e a verificação do dia a dia usa dublês de modelo e renderer
(`tests/studio-pipeline.test.js`), que não custam nada.

## Baselines

`baseline-9-envio-e-rede-2026-10-28` é o primeiro com a nota de Envio, a de LinkedIn e o avaliador de sinais: compare com o
`baseline-6` para ver o que a SPEC 028 mudou no pedido e no ofício, e leia o Envio e o LinkedIn só nele (os anteriores não medem).

`evals/baselines/` guarda o resumo (sem imagem) de cada marco. A PR que muda a geração anexa o antes e o
depois do `eval:compare` no corpo. `baseline-0` é o código de 23/10/2026, antes de qualquer correção (pedido 66%); `baseline-1` tem o número do pedido e a volta do revisor (72%); `baseline-2` tem o leitor de instruções, o cartão de marca e a obediência (93%).

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
