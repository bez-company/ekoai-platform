# ADR 0021: cada ajuste do post vira uma revisão imutável, com o diff por campo calculado pelo servidor

- **Status:** aceito (SPEC 019 aprovada em 23/10/2026; implementado nas PRs #159, #160, #164, #165 e #166)
- **Data:** 2026-10-23
- **Specs que dependem:** [SPEC 019](../specs/019-estudio-incremental-e-aprendizado-com-a-edicao.md),
  [SPEC 012](../specs/012-agentes-instagram-fase-2.md) (decisão 1, motor híbrido)

## Contexto

O motor híbrido ([ADR 0017](0017-motor-de-design-hibrido-com-biblioteca-de-layouts.md)) guarda o design do
post como dado (`post_designs.design`) e o redesenha sem chamar o modelo. Isso permite ajustar um post por
centavos de CPU, mas pede três respostas que valem para mais de uma feature (ajuste rápido, histórico,
regra de marca, e depois o Estúdio e o pedido de ajuste em texto livre):

1. Como guardar o que a pessoa mudou, para desfazer, voltar a uma versão e mostrar quem mudou o quê.
2. Como dois editores no mesmo post não se sobrescrevem em silêncio.
3. Como o sistema aprende com a mudança sem ler o texto do post e sem depender de modelo.

## Decisão

1. **Uma revisão por versão, imutável.** `post_design_revisions` guarda o design completo da versão, o
   diff contra a versão de origem, o autor e um resumo. Não se altera: voltar a uma versão antiga cria uma
   versão nova. A única exclusão é a retenção (20 por post) e a cascata do post e da conta.
2. **O diff é uma lista de `{campo, operacao, antes, depois, contexto}` com campos de uma lista fechada,
   calculada pelo servidor** a partir de dois designs. O cliente nunca manda diff. Valor é escalar
   (texto curto, hex, enum, booleano ou nulo). O resumo é montado por template, nunca por modelo.
3. **A chave única `(tenant_id, post_design_id, version)` é o controle de versão.** Quem grava informa a
   `baseVersion` e insere `baseVersion + 1`. A violação de unicidade é o conflito (409), sem transação nova
   nem trava de linha, no padrão da reserva de `generation_runs` (ADR 0012). A revisão é a fonte da verdade;
   `post_designs.version` é o ponteiro da versão em uso e se recompõe a partir dela.
4. **Aprender usa só o que é categórico.** A regra de marca nasce da mudança líquida (valor da v1 contra a
   versão em uso) repetida em posts diferentes, só nos campos categóricos do diff. Texto livre fica na
   revisão, visível à conta, e nunca entra em regra, evento nem prompt.
5. **Guardar parâmetros, não pixels.** A revisão não tem PNG. O PNG da versão se redesenha do design (o mesmo
   design gera o mesmo PNG). Só a versão em uso tem PNG no bucket.

## Consequências

- Desfazer, histórico, conflito e regra usam a mesma tabela e o mesmo diff; o Estúdio e o pedido de ajuste
  em texto livre (BEZ-193) passam a gravar revisões em vez de inventar outro histórico.
- Campo novo editável exige entrar na lista do diff, no parser e no teste: é de propósito. Campo fora da
  lista não tem como virar revisão nem regra.
- O diff por campo não registra mudança de **posição** (arrastar) nem de **visual**. Quando a fase 3 vier,
  a lista cresce (`elements.N.x`, `visual`); revisões antigas continuam válidas, porque o diff é por campo
  e o design da revisão é completo.
- O texto antes e depois fica no banco da conta. É conteúdo da própria empresa, sob RLS, apagado com a
  conta, e nunca sai para analytics; o teste de eventos garante.
- Renderizar versão antiga a cada abertura da lista custa CPU (resvg), não armazenamento. A lista é
  limitada a 20 e a imagem reduzida; se virar gargalo, o cache fica por `(design, hash)`.
- Sem transação, uma queda entre inserir a revisão e atualizar o post deixa o ponteiro atrasado. A leitura
  detecta e completa; o custo é uma checagem a mais na leitura da versão em uso.

Alternativas descartadas:

- *JSON Patch (RFC 6902) ou diff genérico de jsonb:* serve a qualquer campo e por isso não diz nada sobre
  o que a pessoa fez (`/texts/items/2`). Não dá para agrupar por significado, e deixa campo novo virar regra
  sem passar pela lista.
- *Só snapshot, diff calculado na leitura:* simples, mas a regra de marca precisaria recalcular o diff de
  todas as revisões a cada proposta, e o resumo mudaria se o cálculo mudasse. Guardar o diff congela o que
  a pessoa fez na época.
- *Resumo escrito por modelo:* custa uma chamada por Confirmar, quebra o "custo de modelo zero" do ajuste e
  não é testável.
- *Versão por contador em `post_designs` com `update ... where version = n` apenas:* detecta o conflito mas
  não guarda a revisão que perdeu; o histórico e o desfazer ficariam de fora.
- *Um PNG por versão no bucket:* custo de armazenamento e de limpeza para uma imagem que se redesenha igual.
