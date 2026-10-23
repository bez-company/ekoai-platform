# SPEC 021: planos individual, time e agência e cobrança por consumo

- **Status:** proposta aprovada nas regras (23/10/2026); preço do post, gateway e modelo de agência em aberto
- **Data:** 2026-10-23
- **Cards:** BEZ-135 (cobrança, pai), BEZ-301 (cobrança real, adiada), BEZ-265 (modelo de agência)
- **Depende de:** [ADR 0023](../adr/0023-cobranca-por-consumo-com-cartao-obrigatorio.md),
  [ADR 0007](../adr/0007-tres-papeis-de-conta.md) (papéis), [SPEC 015](015-site-da-ekoai-em-ekoai-com-br.md) (LP)
- **Protótipo:** dispensado pelo Matheus em 23/10/2026 para a seção de planos da LP. A tela de cobrança
  da plataforma ainda não existe e volta a pedir protótipo quando for feita.

## Problema

A LP vendia "Solo" e "Equipe" com 20 posts por mês e preço "R$ XX", e a plataforma não cobra nada
(`plans` tem `pessoa` e `inicial`, sem preço). O custo de cada post é da BEZ, então o modelo precisa
cobrar pelo uso desde o primeiro post, sem franquia grátis.

## Resultado esperado

1. A LP mostra os três planos com as regras abaixo (entregue no ekoai-website #9).
2. A plataforma cobra por consumo, com cartão obrigatório, alerta de gasto e bloqueio por falta de pagamento
   (BEZ-301, depois do preço do post e do gateway).

**Fora de escopo agora:** integrar gateway, cobrar de verdade, nota fiscal, preço por post, tela de cobrança.

## Regras

### Planos

| Plano | Para quem | Base por mês | Exemplo |
| --- | --- | --- | --- |
| Individual | uma pessoa, um perfil | R$ 0 | só os posts |
| Time | quem cria e quem aprova | primeiro usuário grátis, R$ 10 por usuário adicional | 4 usuários = R$ 30, mais os posts |
| Agência | várias marcas | primeiro usuário grátis, R$ 10 por usuário adicional, R$ 100 por marca | 4 usuários e 5 marcas = R$ 30 + R$ 500 = R$ 530, mais os posts |

- Todo plano paga por post. O valor é `R$ XX` na LP até o custo real ser avaliado.
- Entrar no meio do mês paga o mês cheio. Sair vale a partir do mês seguinte.
- O upgrade acontece ao convidar: antes de enviar o convite, aviso "Convidar mais uma pessoa muda seu
  plano para Time. O primeiro usuário continua grátis e cada usuário adicional custa R$ 10 por mês", com
  os botões "Mudar para Time e convidar" e "Cancelar". Cobra quando o convidado aceita. Voltando a 1
  usuário, o plano volta a Individual.
- Agência não pode voltar a Time ou Individual enquanto tiver mais de uma marca.

### Cartão

| Situação | Regra |
| --- | --- |
| Sem cartão | a conta não cria post; a tela explica e leva a cadastrar |
| Cadastro | validado com autorização sem cobrança (3DS quando pedido); cartão recusado não vale |
| Remover o único cartão | desabilitado, com "Adicione outro cartão para remover este" |
| Trocar | adiciona o novo, define como padrão, remove o antigo |
| Encerrar a conta | cobra o consumo pendente antes de encerrar |
| Quem vê e altera | só `admin` da conta |

### Alerta de gasto mensal

- A pessoa define o valor. Avisos em 50%, 80% e 100%, por e-mail e dentro do app.
- Passou do valor: **nada é bloqueado**. Ao criar post, faixa informativa: "Você já passou do seu alerta de
  gasto este mês. A criação continua normal." com "Ver gasto" e "Mudar alerta" (texto final a confirmar).
- A tela de cobrança mostra o gasto do mês em reais e a % do alerta. Sem estimativa do total.
- O nome é "alerta de gasto" em toda a interface. "Limite" não, porque nada limita.

### Falha de pagamento

| Estado | Acesso | O que acontece |
| --- | --- | --- |
| Ativo | total | n/a |
| Cartão falhou | total | e-mail, aviso no app e novas tentativas durante a carência |
| Bloqueado | somente leitura | ver, exportar, trocar o cartão; nenhum dado é apagado |
| Pagou | total | volta na hora |

## Perguntas abertas

1. **O que conta como post:** gerado, aprovado ou publicado? Ajuste e regeneração cobram? (a LP não diz.)
2. **Preço por post:** depende do custo real por post aprovado (BEZ-260).
3. **Carência:** quantas tentativas e quantos dias antes de bloquear (proposta: 3 tentativas em até 7 dias).
4. **Cobrança por limiar:** cobrar ao acumular um valor além do fechamento do mês, para limitar o calote.
5. **Teto de segurança interno** da BEZ contra abuso e cartão roubado (proposta: invisível no uso normal).
6. **Marca da agência:** perfil dentro da conta ou conta por cliente (BEZ-265).
7. **Gateway e nota fiscal:** Asaas está citado em `docs/arquitetura`; falta decidir e conferir Pix, cartão
   recorrente e nota de serviço para CNPJ.

## Verificação

- LP: `npm run check` e build no ekoai-website, e a página aberta no navegador em desktop e celular.
- Plataforma (quando houver código): teste que o único cartão não sai, que o upgrade só ocorre com
  confirmação, que passar do alerta não bloqueia, e que o somente leitura nunca apaga dado.
