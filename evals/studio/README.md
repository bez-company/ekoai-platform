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
`STUDIO_SMART_MODEL`, `STUDIO_FAST_MODEL`, `STUDIO_IMAGE_MODEL`, `STUDIO_JUDGE_MODEL`, `VERTEX_PROJECT_ID`.

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

## Limites

- O juiz é um modelo e erra; o estúdio e o juiz são da mesma família de modelo, o que pode inflar a nota do
  estúdio. A decisão final é o olho de quem vai postar: olhe os `compare.png`.
- Peças com imagem por IA podem sair com defeito de geração (mão, texto dentro da foto); o revisor pega parte.
- Uma peça leva de 5 a 14 minutos e custa de US$ 0,45 a US$ 1,00. Não serve ainda para o caminho síncrono do
  produto: para ir à plataforma precisa virar job assíncrono e ter teto de custo por plano.
- O render é por navegador (Chrome); a plataforma hoje desenha por resvg. Levar o estúdio ao produto exige um
  renderizador de HTML no Cloud Run e uma spec própria.
