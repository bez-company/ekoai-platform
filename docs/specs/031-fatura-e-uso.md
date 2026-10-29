# SPEC 031: Configurações › Fatura e uso

- **Status:** aprovada em 29/10/2026 (protótipo v25 e as seis decisões abaixo); em construção pela entrega 1
- **Data:** 2026-10-29
- **Cards:** BEZ-434 (esta spec), BEZ-301 (cobrança real, adiada), BEZ-135 (cobrança, pai)
- **Depende de:** [SPEC 028](028-um-pedido-um-post-por-rede-e-avaliador.md) (seção "Custo e cobrança": o dado existe em
  `generation_runs`), [SPEC 021](021-planos-e-cobranca-por-consumo.md) e [ADR 0023](../adr/0023-cobranca-por-consumo-com-cartao-obrigatorio.md)
  (planos, cartão, alerta de gasto), [ADR 0007](../adr/0007-tres-papeis-de-conta.md) (papéis)
- **Protótipo:** versão 25 (`version_id` 1793275712-c835) do artifact https://claude.ai/artifact/55avs7vhgtwKFn9HMAR9Fz, grupo "Fase 10: fatura e uso (SPEC 031)", em desktop e celular. Aprovado pelo Matheus em 29/10/2026.

## Problema

1. **Ninguém vê o que a conta usa.** A plataforma grava tokens, imagens e `cost_usd` de cada chamada em `generation_runs` (e a
   SPEC 028 completa o registro por rede e por etapa), mas nenhuma tela mostra isso. A pessoa só sabe de quantos posts do plano
   ainda tem (`monthlyUsage`).
2. **A cobrança por consumo (SPEC 021) precisa de um lugar para existir.** Gasto do mês, alerta de gasto e cartão não têm tela.
3. **O Matheus não vê a parte financeira.** O custo real de um post (texto, imagem, avaliador, conserto, publicação no X) e a
   margem contra o que foi cobrado só se leem por consulta ao banco. O alerta de post caro (BEZ-410) avisa por e-mail, mas não mostra
   onde o dinheiro foi.
4. **Decisão de 28/10/2026 (Matheus):** nenhuma tela do fluxo de post ou de conexão mostra custo. O valor vai para a fatura do
   usuário à medida que ele publica. Este é o lugar onde o valor aparece.

## Resultado esperado

Duas visões do mesmo dado, para dois públicos:

1. **Conta (administrador): Configurações › Fatura e uso.** O que a conta usou no mês e, quando houver preço, o que vai na fatura:
   gasto do mês, uso por tipo, lista de posts do mês com a cobrança de cada um, alerta de gasto e forma de pagamento.
2. **BEZ (Matheus): Console › Financeiro.** O custo real por conta, por post, por etapa e por rede, contra o que foi cobrado.
   Só a equipe da BEZ vê (console interno).

Nenhuma das duas aparece em Criar post, Gerando, Aprovar ou Redes.

## A pergunta central: o que a pessoa vê antes de existir preço?

Hoje **não há preço por post** (SPEC 021: `R$ XX`) e **não há cobrança real** (BEZ-301). Mostrar um valor em reais agora seria
inventar. Proposta: a tela nasce em **dois estados**, escolhidos por um único dado (a conta tem tabela de preço ativa?):

| Estado | Quando | O que mostra |
| --- | --- | --- |
| **Uso** | sem preço (hoje) | quantidades: posts, redes publicadas, imagens, pessoas. Faixa fixa: "A cobrança ainda não começou. Nada é cobrado por enquanto." Nenhum valor em reais |
| **Fatura** | com preço (BEZ-301) | os mesmos blocos mais gasto do mês em reais, linhas da fatura, alerta de gasto e cartão |

Assim a primeira entrega (só uso) é verdadeira, e a segunda só liga o que já está desenhado.

## O que conta, e como a fatura se divide

Regras já decididas e aplicadas aqui:

- **Uma ideia é um post** no plano, em qualquer número de redes (SPEC 028). A fatura lista a ideia como **uma linha**, com as redes
  como chips; a cobrança dela é uma só.
- **Ajuste, Aplicar sugestão, Avaliar de novo, Tentar de novo a rede e regenerar o PDF não são posts novos** e não contam na quantidade de
  posts. Aparecem no uso como "ajustes". Revisão de 29/10/2026 ([SPEC 021](021-planos-e-cobranca-por-consumo.md), ADR 0029): cada um
  **debita crédito** pelo peso da tabela (zero se o custo for desprezível), porque gasta token ou dinheiro. Na entrega 1 (sem preço) nada
  muda na tela; a linha de débito nasce com a fatura (entrega 4).
- **A publicação no X é consumo próprio** (`step = publish`, `channel = twitter`, uma vez por post, mesmo se repetir). Entra na fatura
  como uma linha separada, "Publicações no X", com quantidade e valor. Não aparece no post nem na conexão.
- **A base do plano** (usuários adicionais e marcas, SPEC 021) é uma linha própria, antes dos posts.
- Mês cheio para quem entra no meio do mês; troca de plano vale no mês seguinte (SPEC 021).

### Fatura da conta (com preço)

| Linha | Quantidade | Valor |
| --- | --- | --- |
| Base do plano Time (3 usuários adicionais) | 3 | R$ 30,00 |
| Posts | 18 | 18 × preço do post |
| Publicações no X | 14 | 14 × preço da publicação |
| **Total do mês até agora** | | soma |

Sem estimativa do total do mês (SPEC 021). O alerta de gasto compara o gasto até agora com o valor que a pessoa definiu e avisa em
50%, 80% e 100%; passar dele **não bloqueia** nada.

### Custo da BEZ (console)

Por post: soma de `cost_usd` de todas as chamadas do pedido, dividida em:

| Grupo | Etapas de `generation_runs` |
| --- | --- |
| Núcleo e legenda | `directives`, `strategist`, `writer`, `core` |
| Texto por rede | `adapt` (um por rede) |
| Avaliação e conserto | `critic`, `fix` |
| Imagem | `visual`, `art`, `render` |
| Publicação | `publish` (o custo do X) |

Cada grupo se divide por rede quando a linha tem `channel`. Uma regeneração ou um ajuste somam ao post de origem e aparecem como
"alterações". Custo em dólar (como a Vertex e a API do X cobram) e em reais, com a taxa de uma tabela datada (como o preço do X).

## Quem vê o quê

| Quem | Fatura e uso | Console › Financeiro |
| --- | --- | --- |
| Administrador da conta | vê e altera (alerta, cartão) | não |
| Pessoa que cria | não vê a seção (a aba some, rota 404) | não |
| Pessoa que revisa | não vê | não |
| Conta pessoal (única pessoa) | vê, como administradora | não |
| Equipe BEZ | pelo console, por conta | sim |

## Entregas

Em ordem, cada uma numa PR. A 1 e a 2 não dependem de preço nem de gateway.

| # | Entrega | Como verificar |
| --- | --- | --- |
| 1 | **Uso do mês** em Configurações › Fatura e uso: posts, redes publicadas, imagens, ajustes, pessoas; mês atual e anteriores; estados vazio, carregando e erro | teste de banco: o uso do mês bate com `generation_runs` e `scheduled_posts`; ajuste e regeneração não contam como post; outra conta nunca aparece |
| 2 | **Lista de posts do mês** (título, data, redes, estado) com o detalhe de um post, ainda sem valores | uma ideia em duas redes é uma linha; mês sem posts mostra o estado vazio |
| 3 | **Console › Financeiro**: custo por conta, por post, por grupo e por rede, em US$ e R$; margem quando houver cobrança | soma dos grupos = soma de `cost_usd` do post; linha `publish` do X conta uma vez |
| 4 | **Fatura** (com o BEZ-301): gasto em reais, linhas, alerta de gasto, cartão e falha de pagamento | cartão único não sai; passar do alerta não bloqueia; conta bloqueada é somente leitura |

## Dados (aditivo e reaplicável)

- Entregas 1 a 3: nenhuma tabela nova. Leitura de `generation_runs` (por `brief_id`, `step`, `channel`, `cost_usd`, `created_at`),
  `scheduled_posts` e `tenant_members`. Um índice em `(tenant_id, created_at)` de `generation_runs` se a consulta pedir.
- Taxa de câmbio e preço da API do X em arquivo de configuração datado (`platform/src/lib/pricing.json`), com teste que reprova
  data de revisão vencida, como `channel-signals.json`.
- Entrega 4: tabelas de preço, fatura e cartão, na migration de cobrança do BEZ-301.

## Telas (protótipo v25)

1. **Configurações › Fatura e uso** (administrador e conta pessoal): `uso` (hoje), `fatura`, `alerta`, `passou-do-alerta`,
   `sem-cartao`, `pagamento-falhou` (somente leitura), `mes-anterior`, `vazio`, `carregando`, `erro`.
2. **Detalhe de um post** (cobrança do post e o que não foi cobrado).
3. **Console › Financeiro**: visão por conta, o custo de um post por grupo e rede, e o estado sem dado.

## Decisões do Matheus (29/10/2026)

1. **Moeda:** reais por padrão. O usuário pode ver em dólar também. A cotação é **um número fixo e datado** em `platform/src/lib/pricing.json`
   (atualizado à mão uma vez por mês, com teste que reprova se a data passar de 40 dias), como `channel-signals.json`. O custo da BEZ
   nasce em dólar (a Vertex e a API do X cobram assim) e a fatura do cliente é em reais, então a cotação só serve para o "≈ US$"
   e para o custo no console. Buscar a PTAX do Banco Central automaticamente fica para depois, se a atualização à mão incomodar.
   O seletor "R$ / US$" entra junto da fatura (entrega 4); antes dela não há valor para converter.
2. **Linha do X na fatura:** "Publicações no X", com o preço unitário.
3. **Histórico:** 12 meses.
4. **Exportar CSV do mês:** depois da fatura real (entrega 4).
5. **Conta pessoal** vê alerta e cartão como administradora de si mesma.
6. **Plano** continua no Perfil (SPEC 025); a seção nova guarda gasto e cartão, com um link entre as duas.

## Como verificar

- Teste de banco do cálculo de uso e do custo por post (ver Entregas).
- Teste de papel: só administrador abre a seção; criador e revisor recebem 404.
- Protótipo aberto em desktop e celular, com os estados acima.
