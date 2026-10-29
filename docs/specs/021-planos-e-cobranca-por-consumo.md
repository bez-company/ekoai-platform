# SPEC 021: planos individual, time e agência, com assinatura de créditos e recarga automática

- **Status:** regras revisadas em 29/10/2026 pela [ADR 0029](../adr/0029-assinatura-com-creditos-e-recarga-automatica.md) (direção aprovada
  pelo Matheus); valores, tabela de créditos, gateway e modelo de agência em aberto
- **Data:** 2026-10-23, revisada em 2026-10-29
- **Cards:** BEZ-135 (cobrança, pai), BEZ-489 (modelo de cobrança), BEZ-301 (cobrança real, adiada), BEZ-265 (modelo de agência)
- **Depende de:** [ADR 0029](../adr/0029-assinatura-com-creditos-e-recarga-automatica.md) (que substitui parte da
  [ADR 0023](../adr/0023-cobranca-por-consumo-com-cartao-obrigatorio.md)), [ADR 0007](../adr/0007-tres-papeis-de-conta.md) (papéis),
  [SPEC 015](015-site-da-ekoai-em-ekoai-com-br.md) (LP), [SPEC 031](031-fatura-e-uso.md) (tela de uso e fatura),
  [SPEC 032](032-preco-por-conta.md) (desconto por conta)
- **Protótipo:** dispensado pelo Matheus em 23/10/2026 para a seção de planos da LP. A tela de saldo, pacotes e recarga volta a pedir
  protótipo quando for feita (entrega 4 da SPEC 031).

## Problema

A LP vendia "Solo" e "Equipe" com 20 posts por mês e preço "R$ XX", e a plataforma não cobra nada (`plans` tem `pessoa` e `inicial`, sem
preço). O custo de cada post é da BEZ e varia de centavos a alguns reais conforme o tipo e o nível de qualidade
([análise de 28/10](../analises/2026-10-28-custo-e-preco-por-post.md)). A versão de 23/10 cobrava depois do uso; a ADR 0029 troca isso por
assinatura com créditos e recarga antes do uso, para a BEZ não gerar sem ter recebido.

## Resultado esperado

1. A LP mostra os três planos com as regras abaixo (hoje desatualizada: mostra Individual a R$ 0 e preço por post, ekoai-website #9).
2. A plataforma cobra a mensalidade, debita créditos a cada geração, recarrega por pacote antes do uso e bloqueia a falta de pagamento
   (BEZ-301, depois da tabela de créditos e do gateway).

**Fora de escopo agora:** integrar gateway, cobrar de verdade, nota fiscal, valores em reais, tela de saldo.

## Regras

### Planos

| Plano | Para quem | Base fixa por mês | Créditos do mês |
| --- | --- | --- | --- |
| Individual | uma pessoa, um perfil | mensalidade do plano (valor aberto) | franquia do plano (valor aberto) |
| Time | quem cria e quem aprova | mensalidade, primeiro usuário grátis, R$ 10 por usuário adicional | franquia (valor aberto) |
| Agência | várias marcas | mensalidade, primeiro usuário grátis, R$ 10 por usuário adicional, R$ 100 por marca | franquia (valor aberto) |

- Os R$ 10 por usuário e os R$ 100 por marca vêm da SPEC de 23/10 e seguem até decisão em contrário. A mensalidade e a franquia de cada
  plano dependem do custo medido (BEZ-260) e ficam em aberto.
- Os créditos são **da conta**, divididos entre todas as pessoas e marcas.
- Entrar no meio do mês paga o mês cheio. Sair vale a partir do mês seguinte.
- O upgrade acontece ao convidar: antes de enviar o convite, aviso "Convidar mais uma pessoa muda seu plano para Time. O primeiro usuário
  continua grátis e cada usuário adicional custa R$ 10 por mês", com os botões "Mudar para Time e convidar" e "Cancelar". Cobra quando o
  convidado aceita. Voltando a 1 usuário, o plano volta a Individual.
- Agência não pode voltar a Time ou Individual enquanto tiver mais de uma marca.

### Créditos

| Regra | Valor |
| --- | --- |
| Unidade | crédito. Cada item gerado debita conforme a tabela por tipo e nível de qualidade (abaixo) |
| O que debita | **tudo que custa token ou dinheiro à BEZ**: gerar, regenerar, ajuste, aplicar sugestão, avaliar de novo, tentar de novo a rede, regenerar o PDF e a publicação no X. O peso de cada um vem do custo medido; o que não tem custo mensurável pesa zero |
| Regeneração | debita como uma geração nova |
| Preço do crédito | dois: o do plano e o do pacote de recarga. O do pacote é de **10% a 25% mais caro** (percentual exato em aberto). Não existe crédito avulso fora de um plano |
| Validade do plano | **vence no fim do ciclo e não acumula** |
| Validade do pacote | **não vence e não tem reembolso**: usa até acabar |
| Ordem de consumo | primeiro o saldo do plano (vence), depois o do pacote |
| Falha técnica | estorno automático do crédito (erro nosso, modelo fora do ar, geração que não terminou) |
| Resultado ruim | não estorna |
| Primeiro post | grátis por conta, com cartão válido; um por conta |
| Desconto por conta | SPEC 032, sobre o preço do crédito ou em créditos bônus; nunca aparece para o cliente |

**Tabela de créditos (interna): pesos de partida, a confirmar com o BEZ-490.** O crédito equivale a um custo fixo da BEZ e cada item custa
o múltiplo dele. **Âncora: 1 crédito = US$ 0,01 de custo** (cerca de R$ 0,059 ao câmbio de `pricing.json`, R$ 5,9309). O preço do crédito em
reais, com a margem, é decisão à parte (SPEC 032 e o preço percentual do BEZ-471). Custo medido em 29/10/2026:

| Item | Custo por post (US$) | Origem do número | Créditos |
| --- | --- | --- | --- |
| Rápido, sem imagem de IA | 0,003 | produção, 10 posts do motor atual | 1 (mínimo) |
| Rápido, com imagem de IA | 0,05 a 0,07 | produção, 8 posts; a imagem custou 0,050 em média | 6 |
| Refinado, sem imagem | 0,25 + 0,04 (Cloud Run Job) | eval de 12 pedidos; o Job é estimativa | 29 |
| Refinado, com imagem Flash | 0,25 + 0,067 + 0,04 | idem | 36 |
| Autoral, sem imagem | 0,56 + 0,04 (Cloud Run Job) | eval de 12 pedidos (tudo Pro); o Job é estimativa | 60 |
| Autoral, com imagem Pro | 0,56 + 0,135 + 0,04 | idem | 74 |
| Publicação no X | 0,015, ou 0,20 com link | tabela da API do X (docs/analises) | 2 sem link, 20 com link |
| Carrossel | base mais um valor por lâmina | a medir | a medir |
| LinkedIn | como o Instagram | a API não cobra por post (a conferir) | como o Instagram |
| Regeneração | o mesmo custo do item | n/a | o mesmo valor do item |
| Avaliar de novo | cerca de 0,035 (uma chamada do crítico) | palpite, sem medida | 4 |
| Ajuste, aplicar sugestão | cerca de 0,08 a 0,15 (conserto e embelezador) | palpite, sem medida | 8 a 15 |
| Tentar de novo a rede, regenerar o PDF | desprezível | a medir | 0. Tentar de novo depois de falha técnica não cobra duas vezes: a falha foi estornada |

Leitura: do post mais barato ao mais caro o custo varia **cerca de 70 vezes**. Um plano de 250 créditos rende, por exemplo, 250 posts Rápido
sem imagem, 41 com imagem de IA, 6 Refinados com imagem ou 3 Autorais com imagem Pro.

Limites do dado: só o Rápido vem de produção (18 posts de teste, PostHog `post_ready` e `cost_by_step`). Refinado e Autoral vêm do eval e
ainda não rodaram em produção. O custo registrado (`cost_usd`) usa o preço de lista no código e não foi conferido contra a fatura do
Google Cloud. Taxa do gateway e impostos não entram aqui: são custo da venda e entram no preço do crédito.

Os pesos finais saem do custo real por tipo e nível, lido no Console › Financeiro (SPEC 031, entrega 3). A página pública mostra só
exemplos ("250 créditos rendem cerca de N posts com imagem ou M só de texto"), não a tabela inteira.

### Recarga automática

| Situação | O que acontece |
| --- | --- |
| Saldo cobre a geração | debita e gera |
| Saldo não cobre, recarga ligada e dentro do teto | cobra o pacote no cartão e, só se aprovado, libera a geração |
| Cobrança do pacote recusada | não gera; aviso e link para trocar o cartão |
| Recarga desligada ou teto mensal atingido | não gera; aviso e link para ligar a recarga ou comprar pacote |
| Quem liga, desliga e define | só `admin` da conta: liga e desliga, escolhe o pacote e o **teto mensal de recarga** |

Nada fica por cobrar depois: não existe consumo pós-pago. O teto de recarga é o limite de gasto da conta, e ele **bloqueia** (a ADR 0023
chamava o alerta de gasto de "não bloqueante").

```mermaid
flowchart TD
  A[Pedido de geração] --> B{saldo do plano cobre?}
  B -->|sim| G[debita do plano e gera]
  B -->|não| C{saldo de pacote cobre?}
  C -->|sim| H[debita do pacote e gera]
  C -->|não| D{recarga ligada e dentro do teto?}
  D -->|não| X[não gera: aviso e compra de pacote]
  D -->|sim| E[cobra o pacote no cartão]
  E -->|aprovou| H
  E -->|recusou| X
```

### Avisos de saldo

- Aviso quando o saldo total chega a 20% da franquia e quando acaba (proposta; níveis a confirmar), por e-mail e dentro do app.
- Aviso quando a recarga automática cobra um pacote e quando o teto mensal de recarga chega a 80% e a 100%.
- Nome na interface: "saldo", "pacote", "recarga automática" e "teto de recarga". "Limite" só para o teto, que de fato bloqueia.

### Cartão

| Situação | Regra |
| --- | --- |
| Sem cartão | a conta não cria post; a tela explica e leva a cadastrar |
| Cadastro | validado com autorização sem cobrança (3DS quando pedido); cartão recusado não vale |
| Remover o único cartão | desabilitado, com "Adicione outro cartão para remover este" |
| Trocar | adiciona o novo, define como padrão, remove o antigo |
| Encerrar a conta | o saldo de pacote que sobrar se perde, sem reembolso (validar com a advogada) |
| Quem vê e altera | só `admin` da conta |

### Falha de pagamento da mensalidade

| Estado | Acesso | O que acontece |
| --- | --- | --- |
| Ativo | total | n/a |
| Cartão falhou | total | e-mail, aviso no app e novas tentativas durante a carência |
| Bloqueado | somente leitura | ver, exportar, trocar o cartão; nenhum dado é apagado |
| Pagou | total | volta na hora |

## Onde o crédito aparece

**Decidido pelo Matheus em 29/10/2026: só o saldo, em Configurações › Fatura e uso.** O fluxo de post e a conexão não mostram custo nem
saldo, o que mantém a decisão de 28/10/2026 e a da SPEC 032 (o cliente não vê preço). O custo em créditos de cada nível antes de gerar
ficou de fora.

## Perguntas abertas

1. **Aviso de saldo sem mostrar o saldo no fluxo de post:** como a pessoa sabe que o saldo está acabando, se só Fatura e uso mostra? Os
   avisos por e-mail e dentro do app (acima) cobrem; confirmar o texto e onde o aviso aparece sem virar "custo no fluxo".
2. **Valores:** mensalidade e franquia por plano, preço do crédito no plano, percentual do pacote (de 10% a 25%), tamanho dos pacotes e
   teto padrão de recarga. Dependem do custo real (BEZ-260).
3. **Tabela de créditos:** os pesos de partida estão na tabela acima; confirmar os de Refinado e Autoral com a medida em produção, e medir carrossel, ajuste,
   avaliar de novo, X, Cloud Run Job e PDF (BEZ-490).
4. **Carência da mensalidade:** quantas tentativas e quantos dias antes de bloquear (proposta: 3 tentativas em até 7 dias).
5. **Teto de segurança interno** da BEZ contra abuso e cartão roubado, além do teto de recarga do cliente (proposta: invisível no uso normal).
6. **Limite técnico de gerações** por minuto e por dia da conta, só contra robô (proposta: invisível no uso normal).
7. **Marca da agência:** perfil dentro da conta ou conta por cliente (BEZ-265).
8. **Gateway, Pix e nota fiscal:** Asaas está citado em `docs/arquitetura`; falta decidir e conferir cartão recorrente, Pix Automático para a
   mensalidade, Pix pontual para pacote e nota de serviço para CNPJ.
9. **Pacote sem reembolso (regra do produto decidida):** quem compra pacote usa os créditos dentro da plataforma, sem devolução. Só falta
   conferir com a advogada se a lei de defesa do consumidor (direito de arrependimento em compra online, 7 dias) obriga a devolver em
   conta de pessoa física, e como escrever o termo. Para empresa (CNPJ) a regra não se aplica do mesmo jeito.
10. **Crédito bônus** (convidar, indicação, cortesia): fora do escopo; o desconto por conta da SPEC 032 cobre cortesia por enquanto.

## Verificação

- LP: `npm run check` e build no ekoai-website, e a página aberta no navegador em desktop e celular.
- Plataforma (quando houver código): teste que o único cartão não sai, que a geração nunca começa sem saldo ou recarga aprovada, que o
  saldo do plano é consumido antes do de pacote, que o saldo do plano zera no fim do ciclo e o de pacote não, que falha técnica estorna, que o
  ajuste, avaliar de novo e regenerar debitam o peso da tabela, o primeiro post é grátis uma vez só por conta, que o teto de recarga bloqueia, e que o somente leitura nunca apaga dado.
