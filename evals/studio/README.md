# Estúdio de posts (experimento)

Experimento de qualidade de design da geração de post: vários agentes, cada um com um papel, em vez do caminho
atual (redator, revisor por regra, foto de fundo e render em famílias fixas de SVG). Mora no eval, **não** está
ligado ao `generatePost`. Serve para medir quanto o resultado melhora antes de decidir o que entra no produto.

## Por que existe

O post de hoje sai sempre com a mesma cara: etiqueta, título, subtítulo, logo, @ e imagem de fundo. Na rodada do
`poc-design` (21 a 26/10/2026) cada peça era uma composição HTML sob medida, com ideia, escala e acabamento, e as
notas ficaram em 4,5 a 5. O estúdio automatiza esse jeito: um pedido simples vira uma peça diferente a cada vez.

## Os agentes (`agents.js`)

| Agente | Faz | Modelo |
|---|---|---|
| Marketing (`strategist`) | lê o pedido, acha a tensão humana e propõe uma rota por território criativo | 3.1 Pro |
| Diretor criativo (`director`) | o crítico das ideias: escolhe a rota mais corajosa que serve à marca e a afia | 3.1 Pro |
| Redator (`copywriter`) | só o texto: título (5 opções), apoio, textos da peça, legenda, hashtags; passa pelo revisor por regra da plataforma | 3.1 Pro |
| Direção de arte (`artDirector`) | conceito, composição, paleta, tipografia e o briefing das imagens por IA | 3.1 Pro |
| Ilustrador | gera até 2 imagens (surreal, objeto herói, cena) | 3 Pro Image |
| Designer (`designer`) | escreve o HTML/CSS da peça; 2 rascunhos em paralelo | 3.1 Pro |
| Crítico (`critic`) | nota dura por dimensão olhando o PNG, com as correções em ordem | 3.1 Pro |
| Embelezador (`polisher`) | aplica as correções de forma cirúrgica; descarta a volta se piorar | 3.1 Pro |
| Revisor (`reviewer`) | portão final: texto da imagem igual ao aprovado, sem defeito de IA, logo certo, sem fato inventado | 3.1 Pro |

Entre os agentes há medição por código (`render.js`): margem de 64 px, corpo mínimo de 24 px, texto cortado ou
fora do quadro, fonte fora da lista, tamanho do logo e contraste do logo contra o fundo.

`territories.js` tem 16 territórios criativos (cartaz tipográfico, cena surreal, mockup anotado, colagem...). O
código sorteia 4 por pedido, com semente: é o que garante que pedidos parecidos não saiam iguais.

## Como rodar

```bash
# um post só, para olhar o resultado e o rastro (.context/studio/smoke/)
EVAL_LIVE=1 STUDIO_BRAND=aurora STUDIO_REQUEST="post sobre o pão de fermentação natural" \
  npx vitest run --config vitest.eval.config.js evals/studio/smoke.eval.js

# o eval completo: baseline (pipeline de hoje) x estúdio, em pares, mais a variação
EVAL_LIVE=1 STUDIO_BRANDS=aurora,vertice,sorriso STUDIO_REQS=4 STUDIO_VARIATIONS=4 \
  npx vitest run --config vitest.eval.config.js evals/studio/studio.eval.js
```

Variáveis: `STUDIO_BRANDS`, `STUDIO_ARMS` (`baseline,studio`), `STUDIO_REQS` (pedidos por marca),
`STUDIO_VARIATIONS` (tentativas do mesmo pedido), `STUDIO_CONCURRENCY`, `STUDIO_DRAFTS` (rascunhos do designer),
`STUDIO_SAVE` (grava o resumo em `evals/studio/baselines/`), `STUDIO_TERRITORY` (força territórios no smoke),
`STUDIO_SMART_MODEL`, `STUDIO_FAST_MODEL`, `STUDIO_IMAGE_MODEL`, `STUDIO_JUDGE_MODEL`, `VERTEX_PROJECT_ID`, `EVAL_RUN_ID` (rótulo da rodada no painel de custo).

Projeto: `ekoai-staging` por padrão; `ekoai-prod` só com `EVAL_ALLOW_PROD=1` (BEZ-458). Toda chamada leva os labels
`origin=eval`, `step=studio-<agente>` e `run`, para o custo do estúdio aparecer separado do produto.

Usa o token do `gcloud auth print-access-token` (o ADC da máquina expira). Precisa do Chrome instalado
(`CHROME_PATH` se estiver fora do lugar padrão). Resultado em `.context/studio/runs/<data>/`:
`report.md`, `summary.json`, `results.json` e, por pedido, `baseline.png`, `studio.png`, `compare.png`, as
versões intermediárias, o HTML final e o rastro de cada agente. `node evals/studio/summarize.js <pasta>` refaz o
relatório de uma rodada interrompida.

## O que o eval mede (`design-judge.js`, `report.js`)

- **Nota de design** de 0 a 10 por dimensão (conceito, hierarquia, tipografia, composição, acabamento,
  originalidade, marca, legibilidade, texto), mais pedido e legenda. Um juiz independente do crítico do pipeline:
  outra chamada, sem ver o histórico da peça.
- **Confronto em pares**: o juiz vê as duas peças do mesmo pedido, em ordem sorteada, e escolhe a melhor.
- **Variação**: o mesmo pedido N vezes; o juiz diz se as peças são de fato diferentes e se ainda são da mesma marca.
- Custo e tempo por post, por agente; fato inventado; defeitos objetivos; "postaria sem editar".

## Arquivos locais (fora do git)

O repositório é público e as marcas reais não entram nele. O que é de marca real fica em `.context/studio/`:

- `brands/<id>.json`: empresa no formato de `COMPANIES` (`evals/cases.js`) com `studio.logos` (versões para fundo
  claro e escuro) e `studio.visualLanguage`;
- `requests.local.json`: pedidos simples dessas marcas (mesmo formato de `requests.js`);
- `exemplars/`: PNGs de peças aprovadas com nota máxima e `notes.json` com o que funciona em cada uma. O designer as
  vê como régua de acabamento (não de layout). Sem a pasta, trabalha sem referência.

## Resultado de 28/10/2026 (run-1)

12 pedidos simples (3 marcas, 4 pedidos), baseline x estúdio, juiz `gemini-3.1-pro-preview`. Resumo em
`baselines/run-1.json`.

| | baseline | estúdio |
|---|---|---|
| Nota de design (0 a 10) | 5,8 | 8,4 |
| Originalidade / acabamento | 3,0 / 4,3 | 8,2 / 7,6 |
| Duelos em pares | 0 de 12 | 12 de 12 |
| Postaria sem editar | 8 de 12 | 10 de 12 |
| Custo por post | cerca de US$ 0,01 | US$ 0,56 |
| Variação entre 4 tentativas do mesmo pedido | n/a | 6 de 10 (mesmo esqueleto em alguns pares) |

Pontos fracos conhecidos: variação (títulos e territórios repetem entre tentativas), setas e anotações cruzando
texto, texto sobre foto com contraste baixo. Cards: BEZ-404, BEZ-405 e BEZ-406.

## F0 da SPEC 030 (28/10/2026, `baselines/f0-ablate-1.json`)

Ablação em 6 pedidos (2 por marca), juiz de design; n pequeno, ruído de cerca de 0,5. `run-1` = 2 rascunhos, tudo Pro.

| Variante | Design | Postaria | Custo | Leitura |
|---|---|---|---|---|
| run-1 (2 rascunhos) | 8,57 | n/d | US$ 0,56 | referência |
| v1: 1 rascunho | 8,07 | 6 de 6 | US$ 0,48 | perde cerca de 0,5; o melhor de 2 parece valer |
| v2: v1 com Flash em marketing, diretor, redator e revisor | 7,20 | 4 de 6 | US$ 0,49 | perde 0,9: Flash nessas etapas não compensa |
| v3: v1 sem marketing nem diretor | 7,70 | 5 de 6 | US$ 0,38 | perde 0,4 e economiza US$ 0,10 e metade do tempo |

Outros resultados:
- Reavaliação das versões intermediárias (12 posts da `run-1`, `ablate-rejudge.js`): primeiro rascunho 7,63, melhor de 2 7,66,
  final 8,36. O ganho está no embelezador e no conserto, que resgataram 2 rascunhos quebrados (4,4 para 8,3 e 4,7 para 8,1).
- **Memória de variação** (títulos e territórios recentes da conta no diretor e no redator, 3 tentativas por marca):
  variedade 10 de 10 nas três marcas (era 6 de 10), marca ainda reconhecível (9 a 10), nenhum título repetido. BEZ-404.
- **Medições novas no render** (`text_overlap`, `arrow_over_text`, `contrast_low`): pegam os defeitos reais (seta cortando
  o "T" de "Total", `@` quase invisível no preto), mas depois do conserto ainda sobram `off_canvas` (5), `arrow_over_text` (5),
  `safe_margin` (4) e `text_overlap` (2) em 18 peças. Parte do `off_canvas` é título que sangra de propósito. BEZ-405 segue
  aberto: falta separar sangria intencional e dar mais de uma volta de conserto.
- Tempo de relógio (14 a 35 min por post) está contaminado pela carga da máquina; não serve para a meta de latência.

Decisões para a F1: manter marketing, diretor e redator em Pro; manter 2 rascunhos até haver mais amostra; incluir a memória
de variação; v3 (sem marketing e diretor) fica como opção de um "autoral rápido".

## Limites

- O juiz é um modelo e erra; o estúdio e o juiz são da mesma família de modelo, o que pode inflar a nota do
  estúdio. A decisão final é o olho de quem vai postar: olhe os `compare.png`.
- Peças com imagem por IA podem sair com defeito de geração (mão, texto dentro da foto); o revisor pega parte.
- Uma peça leva de 5 a 14 minutos e custa de US$ 0,45 a US$ 1,00. Não serve ainda para o caminho síncrono do
  produto: para ir à plataforma precisa virar job assíncrono e ter teto de custo por plano.
- O render é por navegador (Chrome); a plataforma hoje desenha por resvg. Levar o estúdio ao produto exige um
  renderizador de HTML no Cloud Run e uma spec própria.
