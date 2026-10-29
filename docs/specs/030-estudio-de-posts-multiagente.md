# SPEC 030: estúdio de posts multiagente (estilo e esforço por post)

- **Status:** protótipo v26 aprovado pelo Matheus em 2026-10-29; código liberado. O ADR 0028 segue proposto.
- **Data:** 2026-10-28, revisada em 2026-10-29
- **Cards:** BEZ-406 (esta spec); pai BEZ-403 (experimento e eval); BEZ-404 (variação), BEZ-405 (defeitos de layout) e BEZ-447 (custo, imagem e níveis)
- **Origem:** o Matheus comparou os posts do experimento com os do gerador atual: "ficaram absurdamente melhores, vamos
  implementar". Em 29/10/2026 decidiu: não se cobra por tempo (o post pode levar minutos); o foco é qualidade e custo por post, com
  cobrança por uso; o usuário escolhe estilo, tipo, qualidade da imagem e o esforço dos agentes, e vê uma referência de preço.
  O experimento está em `evals/studio/` (README, `baselines/` e `docs/analises/2026-10-28-custo-e-preco-por-post.md`).
- **Depende de:** [ADR 0017](../adr/0017-motor-de-design-hibrido-com-biblioteca-de-layouts.md) (o motor de layouts, que vira o nível
  Instantâneo), [ADR 0018](../adr/0018-geracao-assincrona-por-worker-interno.md) (geração por fila),
  [SPEC 020](020-instrucoes-explicitas-do-pedido.md) (o leitor de instruções), [SPEC 018](018-objetivos-campanhas-e-fatos.md)
  (fatos e campanha), [SPEC 021](021-planos-e-cobranca-por-consumo.md) e [SPEC 031](031-fatura-e-uso.md) (consumo e fatura),
  [SPEC 026](026-logo-e-variacoes.md) (variações do logo) e [ADR 0028](../adr/0028-estudio-de-posts-em-cloud-run-job-com-chromium.md) (onde roda)
- **Protótipo:** artifact https://claude.ai/artifact/55avs7vhgtwKFn9HMAR9Fz, versão 26 (`version_id` 1793276790-85ba), grupo
  **Fase 11: estilo e esforço do post** (Criar post com 12 estados, Criando o post com 5 e Aprovar post autoral com 3), desktop e
  celular. Fonte em `.context/proto-030` do workspace nukualofa (`phase11.js`, `phase11.css`, `build.py`).

## Problema

O post de hoje sai de uma família fixa de layout (etiqueta, título, subtítulo, logo, @ e foto de fundo). Pedidos diferentes
saem com a mesma cara, e o cliente não confia no resultado. Na rodada de 28/10/2026 (12 pedidos simples, 3 marcas), um estúdio
com vários agentes que escrevem o HTML da peça foi melhor em 12 de 12 duelos: nota de design 8,4 contra 5,8 (juiz
independente), originalidade 8,2 contra 3,0, "postaria sem editar" em 10 de 12 contra 8 de 12.

O experimento também mostrou o que falta para virar produto: variação fraca entre tentativas (6 de 10), uma cauda de defeitos
de layout, custo de cerca de US$ 0,56 por post e de 5 a 35 minutos por peça, nenhum uso do contexto da conta e saídas dos
agentes sem validação de formato.

## Decisões

1. **Três escolhas por post, no "Criar post".** O **estilo** vem de uma vitrine de 16 direções de design (cartaz tipográfico, cena
   surreal, cartão com anotações, número gigante etc.), cada uma com prévia nas cores e na fonte da marca; "Deixar a Ekoai escolher"
   é o padrão e varia o estilo a cada post. O **tipo** é uma propriedade do estilo: **minimalista** (só tipografia e formas, sem imagem
   de IA) ou **com imagem de fundo**; a vitrine filtra por ele. A **qualidade da imagem** (Padrão ou Alta) só aparece quando há imagem.
   O **esforço dos agentes** tem 5 níveis. Os nomes são provisórios: Instantâneo, Padrão, Refinado, Autoral e Pro.
2. **Os níveis são conjuntos de agentes e modelos, nunca o nome do modelo na tela.** Mapeamento, com o que o eval mediu (6 pedidos,
   juiz de design; custo de modelo por post):

   | Nível | O que roda | Nota medida | Custo (US$) |
   |---|---|---|---|
   | Instantâneo | o motor atual (SVG), texto em Flash | 5,8 | 0,002 |
   | Padrão | 1 chamada de plano e 1 de HTML em Flash, render e medições | 6,5 a 6,7 | 0,015 a 0,05 |
   | Refinado | cadeia completa com 1 rascunho; designer, embelezador e conserto em Flash; o resto em Pro | 8,06 | 0,25 |
   | Autoral | cadeia completa com 1 rascunho, tudo em Pro (raciocínio baixo no designer) | 8,15 | 0,41 |
   | Pro | 2 rascunhos, tudo em Pro, **3 opções de design** para escolher | 8,4 a 8,6 | 0,56 |

   Refinado, Autoral e Pro empatam em nota dentro do ruído; por isso o Pro entrega algo que se vê (3 opções). Se o Padrão não passar
   do Instantâneo por margem relevante numa amostra maior, ele sai e ficam 4 níveis.
3. **Imagem.** Padrão usa um modelo de imagem rápido e barato (Flash ou Flash Lite, 1K); Alta usa o Pro. No teste de 29/10 as quatro
   notas ficaram a 0,25 uma da outra; Alta só se justifica com algo visível (resolução, mais detalhe). No máximo 2 imagens por post.
4. **Preço fixo por nível, mostrado antes de criar.** A pessoa vê a estimativa (nível mais qualidade da imagem) no resumo, e o que se
   cobra é esse valor, não o custo real do post: o risco de custo é da BEZ e o teto por post (decisão 9) o limita. Cobra-se **ao
   aprovar**; descartar ou cancelar não cobra; o primeiro ajuste está incluso. O valor de cada nível vem de uma tabela de configuração
   (os do protótipo são fictícios) e a regra do que conta como post fica na SPEC 021 e na [SPEC 031](031-fatura-e-uso.md). Mostrar o
   preço no fluxo do post contradiz a decisão de 28/10 sobre o X (custo na fatura, não no fluxo); como o Matheus pediu a referência de
   preço em 29/10, o preço aparece, atrás de uma constante (`SHOW_PRICE_IN_FLOW`) que o liga ou desliga sem mexer na tela (o protótipo
   tem a variante "Sem preço").
5. **Sem meta de tempo.** Níveis de Refinado para cima levam de 10 a 15 minutos; a tela "Criando o post" mostra os agentes na ordem,
   o tempo decorrido e que a pessoa pode fechar a página, e avisa por e-mail e pelo sino ao terminar. O Instantâneo sai em segundos.
6. **Erro cai no Instantâneo, sem cobrar o que não saiu.** Se o nível escolhido não termina ou estoura o teto, o post sai no Instantâneo,
   com aviso, e cobra só o Instantâneo.
7. **Contexto montado por código** (`studio/context.ts`): perfil e voz, fatos **válidos**, campanha e objetivo, regras de estilo
   aprendidas (SPEC 019), os últimos posts da conta (territórios e títulos, BEZ-404), análise do público e as instruções do pedido
   (SPEC 020), que o designer obedece. No eval, a memória de variação levou a variedade de 6 para 10.
8. **Contrato fechado nas saídas** de cada agente (parser puro, uma repetição, falha com motivo), HTML do designer sanitizado, e
   **medição por código no render** (margem, corpo, texto cortado, logo, sobreposição, traço sobre texto, contraste); defeito medido
   volta ao designer (até 2 voltas) e nunca vai à aprovação.
9. **Teto por post e por conta.** Custo estimado acumulado a cada chamada em `generation_runs` (já existe); acima de US$ 0,90 por post
   o post fecha com a melhor versão ou cai no Instantâneo. O alerta de gasto da SPEC 021 vale (passar dele só avisa).
10. **Política de imagem de IA:** sem rosto reconhecível, sem criança e sem logo ou texto dentro da imagem, em todas as marcas, imposta
    no prompt do ilustrador e conferida pelo revisor final.
11. **Ajuste depois de pronto.** "Pedir ajuste" (SPEC 024) num post autoral reabre o designer com o HTML guardado e a instrução, uma
    volta cirúrgica com guarda de regressão. O editor em camadas (SPEC 027) não abre post autoral na v1.
12. **Portão de qualidade antes de ligar para clientes:** nota de design do juiz de pelo menos 8,0 nos níveis Refinado e acima,
    variedade pelo menos 8, zero defeito de layout medido e "postaria sem editar" de pelo menos 90% em 24 peças, **e** a aprovação
    do Matheus olhando os `compare.png`. Já houve a aprovação humana da rodada de 28/10.

## Execução e dados (decisão técnica no ADR 0028)

| Item | Mudança |
|---|---|
| Onde roda | Instantâneo e Padrão no worker de hoje; Refinado, Autoral e Pro num Cloud Run Job `ekoai-studio` com Chromium, um brief por execução (ADR 0028) |
| `briefs` | colunas `effort text not null default 'instantaneo'`, `style text not null default 'auto'` (`auto`, `auto-minimalista`, `auto-imagem` ou o id de um estilo) e `image_quality text null` (`padrao`, `alta`), com `check`. Migration aditiva e reaplicável; brief antigo vira Instantâneo |
| `studio/levels.ts` (puro) | catálogo de níveis (nome, tempo, agentes acesos, preço, modelos por etapa), estilos (id, nome, imagem sim ou não, dica) e a conta da estimativa |
| `post-requests.ts` | o pedido aceita e valida `effort`, `style` e `image_quality`; valor inválido é recusado antes de qualquer I/O |
| `post_designs.design` (jsonb) | `studio?: { effort, style, territory, htmlKey, assetKeys, scores, costUsd }`; o HTML fica em arquivo no bucket, só a chave no jsonb |
| `generation_runs` | uma linha por chamada, com `step` = nome do agente, e os labels do BEZ-458 |
| Etapas da tela | `STEPS` ganha, por nível, as etapas dos agentes (Ideia, Texto, Arte, Imagem, Design, Crítica, Refino, Revisão) |

## Fases

- **F1, base e tela:** `studio/levels.ts` com testes, migration de `briefs`, validação em `post-requests.ts`, e a tela "Criar post" com
  vitrine, qualidade da imagem, níveis e resumo com estimativa. Só o Instantâneo gera; os outros níveis aparecem como "em breve" até a F3.
- **F2, lib do estúdio em TypeScript:** agentes, parsers, contexto, medições, memória de variação, com testes puros; o eval passa a
  apontar para este código.
- **F3, execução:** imagem do job com Chromium, Terraform, disparo pelo cron, batimento, teto de custo, a tela "Criando o post" por
  nível e o fallback para o Instantâneo. Liga Padrão, Refinado e Autoral.
- **F4, aprovar e cobrar:** "Aprovar post autoral", cobrança ao aprovar, ajuste incluso, o nível Pro com 3 opções.
- **F5, ajuste:** "Pedir ajuste" em post autoral.
- **F6, portão e liberação:** eval no piso, aprovação do Matheus e liberação por conta (sinalizador), depois geral.

## Fora do escopo

Editor livre para post autoral; carrossel autoral (cada lâmina vira uma peça, custo multiplica: spec própria); vídeo e Reels; bucket
de referências públicas de design (as referências de nível vêm da galeria interna, sem marca de cliente); trocar o modelo de
texto da produção.

## Como verificar

- Testes puros: cada parser (aceita, recusa e repete), a montagem de contexto (fato vencido fora, histórico recente
  incluído), a sanitização do HTML, as medições de render (uma peça boa e uma com cada defeito) e o teto de custo.
- Teste puro de `studio/levels.ts` (catálogo, estimativa por nível e qualidade, estilos por tipo) e de `post-requests.ts` (valor inválido recusado).
- Teste de banco: colunas novas de `briefs` com `check`, fila e batimento, `generation_runs` por etapa.
- Eval: `evals/studio` apontando para `platform/src/lib/studio` e o gerador atual como baseline, nos 3 conjuntos de marcas; o
  `compare` do eval entra no corpo da PR.
- Fluxo real: um pedido autoral de ponta a ponta no ambiente `staging` (job, Chromium, bucket, tela de aprovação).

## Perguntas abertas

1. **Preço de cada nível** e da qualidade Alta (os do protótipo são fictícios): depende do BEZ-301 e da SPEC 031.
2. **O que conta como post** na cobrança: proposta de cobrar o aprovado, com 1 ajuste incluso (SPEC 021, pergunta 1).
3. **Nomes dos níveis:** Instantâneo, Padrão, Refinado, Autoral e Pro são provisórios; o Matheus aceita usar os do ChatGPT.
4. **Preço no fluxo do post** (decisão 4): ligado por padrão; confirmar com o Matheus se prefere só na fatura.
5. **Modelo de imagem do nível Padrão:** Flash ou Flash Lite (a confirmar o preço do Lite na Vertex).

## Riscos

- **Qualidade medida por modelo da mesma família.** Mitigação: aprovação humana no portão e piso revisado com ela.
- **Custo fora de controle.** Preço fixo por nível com custo variável: o teto por post, o fallback para o Instantâneo e o designer em Flash (nível Refinado) limitam o risco. Flash nas etapas leves de texto não vale (perdeu 0,9 de nota na F0).
- **Chromium na imagem aumenta superfície e tamanho.** Mitigação: job isolado, sem a imagem da plataforma, rede só para o
  Vertex e o bucket (ADR 0028).
- **Injeção por pedido ou por fato da conta.** O texto do cliente entra em prompts: vai entre delimitadores e o HTML do
  designer passa por sanitização; nenhum agente tem ferramenta nem acesso a dados da conta além do brief montado.
