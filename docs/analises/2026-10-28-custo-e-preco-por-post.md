# Custo e preço por post: viabilidade do design autoral (28/10/2026)

Análise para a decisão do Matheus de 28/10/2026: o post pode levar minutos (não se cobra por tempo), mas precisa ter
**boa qualidade e custo baixo**, porque a cobrança é por uso e, se o post sai caro, a pessoa prefere uma agência. Base:
eval do estúdio (`evals/studio/`, [SPEC 030](../specs/030-estudio-de-posts-multiagente.md), cards BEZ-403 a BEZ-406 e BEZ-447).
Câmbio R$ 5,90 por US$, o mesmo da análise de custo de 20/10/2026. Tudo o que é estimativa está marcado.

## O que mudou em relação ao spike

O spike de "segundos" (BEZ-447) mostrou que nenhum caminho rápido chega à nota de 8,4 da cadeia completa. Com a decisão de
aceitar minutos, o problema passa a ser **baixar o custo da cadeia completa sem perder nota**, e dar ao usuário o controle do
que cada post custa.

## Custo medido hoje (12 posts, cadeia completa, tudo no modelo Pro)

| Etapa | US$ por post | Observação |
|---|---|---|
| Designer (HTML) | 0,20 | maior fatia; 2 rascunhos |
| Conserto de layout | 0,08 | roda quando o render mede defeito |
| Embelezador | 0,07 | |
| Marketing, redator, direção de arte | 0,034 a 0,037 cada | |
| Crítico | 0,035 | 2 a 3 chamadas |
| Diretor criativo | 0,019 | |
| Revisor final | 0,006 | |
| **Total sem imagem de IA** | **0,53** (R$ 3,10) | média de 9 posts |
| Imagem de IA (Pro) | +0,135 (R$ 0,80) | 1 imagem; total de 0,66 com imagem |

Para comparação, o gerador atual (SVG por código, texto em Flash) custa cerca de **US$ 0,002 por post** (R$ 0,01), sem imagem
de IA. Fora do ledger e **estimados**: o Cloud Run Job (2 vCPU, 4 GiB, uns 10 a 15 min) custa da ordem de US$ 0,03 a 0,05 por
post (conferir na calculadora do Cloud Run), e a taxa do gateway de pagamento (a decidir na SPEC 021) incide sobre o que se cobra.

## Preço da imagem por modelo e qualidade

Fonte: página de preços da Gemini API, citada por buscas na web em 28/10/2026 (Vertex não mostrou a tabela de imagem; conferir
antes de fixar preço).

| Modelo | 1K | 2K | 4K | Batch (metade) |
|---|---|---|---|---|
| Gemini 3.1 Flash Image | US$ 0,067 | US$ 0,101 | US$ 0,151 | US$ 0,034 em 1K |
| Gemini 3 Pro Image | US$ 0,134 | US$ 0,134 | US$ 0,24 | US$ 0,067 em 1K |

O post do Instagram tem 1080 x 1350, então 1K basta; 2K só faz diferença em corte e ampliação. A imagem do Pro leva de 60 a
110 s, a do Flash de 10 a 30 s (medido). A qualidade relativa de cada um **ainda não foi medida** com o juiz; é o próximo teste.

## O seletor do usuário (proposta)

O usuário escolhe três coisas por post, e a tela mostra a **estimativa de custo antes de gerar**:

| Controle | Opções | Efeito no custo |
|---|---|---|
| Tipo de post | **Minimalista** (sem imagem de IA, tipografia e formas) ou **Com imagem de fundo** | com imagem soma o custo da imagem |
| Qualidade da imagem (só com imagem) | **Padrão** (Flash, 1K) ou **Alta** (Pro) | US$ 0,067 contra 0,134 |
| Nível de design | **Rápido** (motor atual, segundos) ou **Autoral** (cadeia completa, minutos) | US$ 0,002 contra cerca de 0,5 |

Nomes por nível, não por modelo: modelos mudam todo trimestre e o usuário não precisa saber qual é. Por baixo, cada nível
mapeia para um conjunto de modelos que a BEZ troca sem mexer na tela. Isso responde à ideia de "escolher o modelo de IA":
o controle existe, só que como nível de qualidade.

Sobre a "biblioteca": o que testei no spike era uma biblioteca de **layouts** (HTML com espaços para texto e imagem), não de
imagens prontas. A imagem continua sendo gerada a partir do pedido de cada pessoa. O resultado foi fraco com poucos layouts
(nota 5,4 a 6,6), então a biblioteca fica como evolução futura e não como caminho principal.

## Experimento de fronteira (6 pedidos, juiz de design, 1 rascunho; `evals/studio/variants.eval.js`)

| Configuração | Nota | Postaria | Custo (US$) | Defeitos medidos |
|---|---|---|---|---|
| Tudo Pro, raciocínio médio (referência `v1`) | 8,07 | 6 de 6 | 0,48 | 8 |
| **`k1`: designer e embelezador em Flash**, crítico e revisor em Pro | **8,06** | 5 de 6 | **0,25** | 11 |
| `k2`: tudo Pro, designer com raciocínio baixo | 8,15 | 6 de 6 | 0,41 | 3 |
| `k3`: Flash e raciocínio baixo (só 2 posts terminaram: 8,5 e 8,4) | n=2 | 2 de 2 | 0,27 | 2 |

Leitura: **trocar o designer e o embelezador para Flash corta o custo em 47% sem perder nota** (8,06 contra 8,07; ruído de
cerca de 0,5, amostra pequena). Raciocínio baixo no Pro cortou só 15% do custo. O juiz forte (crítico e revisor em Pro) é o que
segura a qualidade; o gerador pode ser mais barato. Falta confirmar em mais pedidos e medir `k3` completo (dois posts da `k3` ficaram
presos em chamadas do modelo e foram interrompidos).

## Combinações e custo (U$ por post)

Os valores abaixo usam o custo medido da cadeia completa em Pro (teto atual). Com a configuração `k1`, a linha Autoral cai para
cerca de metade: **minimalista ~US$ 0,21 (R$ 1,25), com imagem Flash ~US$ 0,28 (R$ 1,65), com imagem Pro ~US$ 0,34 (R$ 2,00)**
(estimativa: `k1` mediu US$ 0,25 em média, com imagem Pro em 2 de 6 posts).

| Combinação | Custo de modelo | Em R$ |
|---|---|---|
| Rápido, minimalista | 0,002 | 0,01 |
| Rápido, com imagem Flash | 0,07 | 0,41 |
| Rápido, com imagem Pro | 0,14 | 0,80 |
| Autoral, minimalista | 0,53 | 3,10 |
| Autoral, imagem Flash | 0,60 | 3,55 |
| Autoral, imagem Pro | 0,66 | 3,90 |

Somar cerca de US$ 0,04 (R$ 0,24, estimado) de execução nas linhas Autoral. Depois do experimento de fronteira (abaixo), a
linha Autoral deve cair; os números acima são o teto atual.

## Viabilidade: o custo cabe no preço?

- **Referência de mercado (não verificada de forma independente):** blogs de social media indicam de R$ 800 a R$ 3.500 por mês por
  cliente para pequenas empresas, de R$ 4.000 a R$ 10.000 para especialistas. Com um pacote de 12 a 20 posts por mês (suposição),
  isso dá de R$ 40 a R$ 290 por post em agência ou freelancer. Fontes: [Jamile Fernandes](https://jamilefernandes.com.br/blog/precificacao-para-social-media-quanto-cobrar-em-2026),
  [FreelaSemCrise](https://www.freelasemcrise.com.br/calculadoras/preco/social-media-freelancer).
- **Conclusão preliminar:** mesmo o Autoral com imagem Pro (R$ 3,90 de custo) fica de 10 a 70 vezes abaixo do custo por post da
  agência. Cobrar R$ 8 a R$ 15 por post Autoral dá margem de 2 a 4 vezes e continua muito mais barato que contratar. O risco de
  perder cliente para a agência não está no custo do Autoral, e sim em o preço total do mês (posts e ajustes) parecer alto
  para quem posta pouco ou compara com ferramentas grátis.
- **O que decide a margem de verdade** é a regra do que conta como post: ajuste, regeneração e post descartado têm custo de
  modelo e hoje não estão definidos (SPEC 021, pergunta 1). Um ajuste no Autoral reabre o designer (estimativa de US$ 0,10 a 0,20).
  Sem regra, um usuário que regenera 5 vezes um post custa 5 vezes.
- **Teto de custo por post** (proposta da SPEC 030: US$ 0,90) protege contra o pior caso.

## Alavancas para baixar o custo do Autoral

| Alavanca | Efeito esperado | Estado |
|---|---|---|
| Menos raciocínio no designer (`low` em vez de `medium`) | menos tokens de saída no maior item | medido: -15% de custo, mesma nota (`k2`) |
| Designer e embelezador em Flash, crítico em Pro | corta a maior fatia, mantendo o juiz forte | **medido: -47% de custo, mesma nota (`k1`)** |
| 1 rascunho em vez de 2 | menos US$ 0,08; perdeu cerca de 0,5 de nota na F0 | medido |
| Pular marketing e diretor (só no minimalista) | menos US$ 0,10; perdeu cerca de 0,4 | medido |
| Imagem em Flash 1K em vez de Pro | menos US$ 0,07; qualidade a medir | a medir |
| Batch para posts agendados (a agenda da semana, gerada à noite) | metade do preço de imagem e de texto, se confirmado na Vertex | a verificar |
| Cache de contexto (marca, regras e referências são iguais entre posts da conta) | corta tokens de entrada repetidos; entrada é a menor parte do custo | a verificar |
| Parar cedo quando o crítico aprova (nota 8 e `ship`) | evita embelezador e conserto | já existe; medir a taxa |

## Perguntas para o Matheus

1. **O que conta como post** na cobrança: gerado, aprovado ou publicado? Ajuste e regeneração cobram? Proposta: cobrar o post
   **aprovado**, com 1 ajuste incluso e os seguintes a preço de ajuste.
2. **Estimativa antes de gerar** na tela de "Criar post", com o preço do nível escolhido: confirma?
3. **Mínimo de qualidade:** o Rápido deve existir para sempre como opção barata ou é só a porta de entrada do Autoral?

## Próximos passos

1. Fechar o experimento de fronteira (designer em Flash e com menos raciocínio) e atualizar a tabela de combinações.
2. Medir imagem Flash 1K contra Pro com o juiz de design (4 a 6 prompts, mesmos pedidos).
3. Revisar a SPEC 030: sem meta de tempo; seletor de tipo, qualidade de imagem e nível; estimativa antes de gerar; teto por post.
4. Definir com a SPEC 021 o que conta como post e o preço por nível.
