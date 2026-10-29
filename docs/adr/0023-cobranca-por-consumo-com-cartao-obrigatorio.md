# ADR 0023: cobrança por consumo, sem mensalidade no plano individual, com cartão obrigatório

- **Status:** aceito (decisão do Matheus, 23/10/2026); as decisões 1, 4 e 5 foram substituídas pela
  [ADR 0029](0029-assinatura-com-creditos-e-recarga-automatica.md) (29/10/2026). Valem ainda a 2, a 3 e a 6.
- **Data:** 2026-10-23
- **Specs que dependem:** [SPEC 021](../specs/021-planos-e-cobranca-por-consumo.md),
  [SPEC 015](../specs/015-site-da-ekoai-em-ekoai-com-br.md) (a LP mostra os planos)
- **Revisa:** [ADR 0004](0004-construir-o-saas-sem-cnpj-validando-com-a-pilar.md) (cobrança só depois dos
  gates). A venda direta pela LP tira a cobrança de trás dos gates; o que precisa ser verdade antes de cobrar
  de verdade continua na SPEC 021.

## Contexto

O BEZ-135 pedia planos, preço e checkout para a venda direta. A LP mostrava "Solo" e "Equipe", com 20 posts
por mês e preço "R$ XX". Três coisas pesaram na decisão:

1. **O custo de cada post é da BEZ** (modelo de texto e de imagem, publicação). Franquia grátis ou plano com
   cota fixa gera prejuízo antes de existir receita.
2. **O custo real por post ainda não foi avaliado**, então não dá para fixar um preço por post nem uma cota.
3. **O modelo que o Matheus usa e quer espelhar é o do GCP:** paga pelo consumo, com cartão cadastrado, e
   define um alerta de orçamento.

## Decisão

1. **Cobrança por consumo, depois do uso (pós-pago).** Sem franquia grátis. O plano Individual não tem
   mensalidade: paga só pelos posts. O preço do post fica indefinido até avaliar o custo real.
2. **Três planos, com taxa por pessoa e por marca no lugar de mensalidade fixa:**

   | Plano | Base | Uso |
   | --- | --- | --- |
   | Individual | R$ 0 | R$ X por post |
   | Time | primeiro usuário grátis, R$ 10 por usuário adicional, por mês | R$ X por post |
   | Agência | primeiro usuário grátis, R$ 10 por usuário adicional e R$ 100 por marca, por mês | R$ X por post |

   Quem entra no meio do mês (usuário ou marca) paga o mês inteiro. O plano muda quando a pessoa convida o
   segundo usuário, com aviso e confirmação antes de enviar o convite.
3. **Cartão obrigatório para usar a plataforma.** Sem cartão cadastrado e válido, a conta não cria post.
   O único cartão não pode ser removido: só se troca (adiciona o novo, define como padrão, remove o antigo).
   Encerrar a conta é o caminho explícito para sair e cobra o consumo pendente na hora. Isso é o que o GCP
   e o Google Workspace fazem com o método de pagamento principal.
4. **Alerta de gasto mensal, não limite.** A pessoa define um valor. A Ekoai avisa em 50%, 80% e 100% e,
   passando do valor, **continua gerando**, com um aviso não bloqueante ao criar post. O nome na interface
   é "alerta de gasto", nunca "limite", porque nada é bloqueado. A tela de cobrança mostra o gasto do mês e
   a % do alerta, sem estimativa do total.
5. **Falha de pagamento:** novas tentativas, aviso por e-mail e carência curta. Depois dela a conta fica
   **somente leitura** (ver, exportar, trocar o cartão) e volta ao normal ao pagar. Nunca se apaga dado
   por falta de pagamento.
6. **Cartão e alerta pertencem à conta**, não à pessoa. Só o papel `admin` vê e altera
   ([ADR 0007](0007-tres-papeis-de-conta.md)).

## Consequências

- **A exposição ao custo é aberta.** Como o alerta não bloqueia, uma conta pode gerar muito acima dele. O
  que segura: cartão validado no cadastro, cobrança ao acumular um valor (limiar) além do fechamento do
  mês, e um teto de segurança interno da BEZ, invisível no uso normal. Os dois últimos são propostas, não
  decisões fechadas (SPEC 021, perguntas abertas).
- **Só cartão.** Quem não tem cartão fica de fora, e Pix não serve para cobrança por consumo recorrente.
  É um custo de alcance aceito para começar.
- **O modelo de dados muda na implementação:** a tabela `plans` hoje tem `pessoa` e `inicial` e o gatilho
  exige plano do mesmo tipo de conta (`PLAN_BY_KIND`). Individual, time e agência não mapeiam um para um
  para empresa e pessoa. A migration é aditiva e entra com a cobrança real.
- **"Marca" da agência depende do BEZ-265:** um perfil de Instagram dentro da conta, ou uma conta por
  cliente com um agrupador acima. A decisão de preço (R$ 100 por marca) vale nos dois.
- **A LP e a plataforma precisam falar a mesma coisa.** Os textos de plano ficam em um só lugar de cada
  lado e a SPEC 021 é a fonte.
