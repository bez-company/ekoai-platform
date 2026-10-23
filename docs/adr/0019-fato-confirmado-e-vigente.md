# ADR 0019: o post só usa fato confirmado por uma pessoa e dentro da validade

- **Status:** proposto (vira aceito com a aprovação da SPEC 018)
- **Data:** 2026-10-23
- **Specs que dependem:** [SPEC 018](../specs/018-objetivos-campanhas-e-fatos.md) (fatos e campanhas),
  [SPEC 012](../specs/012-agentes-instagram-fase-2.md) (decisão 5, base de fatos)

## Contexto

A base de fatos (`company_facts`, migration 0023) é o que impede o post de afirmar número, preço, prazo ou
claim que a empresa não confirmou. Ela vale hoje por um único critério: o fato existe e está ligado. Três
coisas vão mudar isso ao mesmo tempo:

1. Promoção e preço vencem, e fato vencido ainda "autoriza" o número no revisor.
2. A importação do site e o kit da marca (BEZ-192 e 197) vão propor fatos escritos por um agente, que
   ninguém conferiu.
3. A campanha (SPEC 018) cita oferta e prazo, o caminho mais curto para um claim errado.

A regra precisa valer em todo lugar que lê fato (geração, revisão, importação, campanha, publicação), não
só numa tela. Por isso é decisão transversal e não detalhe da feature.

## Decisão

1. **Um fato só vale se uma pessoa com `brand.manage` o confirmou e ele está dentro da validade.** O estado
   é `pending`, `confirmed` ou `rejected`. Vencido é derivado de `valid_until`, não gravado.
2. **O modelo propõe, a pessoa confirma.** Texto escrito por agente ou importação entra `pending`
   (`proposed_by = 'agent'`) e nenhum caminho de código de agente grava `confirmed`. Editar o texto de um
   fato confirmado o devolve a `pending`.
3. **A geração e o revisor leem a mesma função de vigência.** `factsForPrompt` entrega só o que vale. O
   revisor recebe também o que não vale (`inactive`) e reprova número que só existe lá.
4. **"Nunca afirmar" vale sempre que estiver ativo**, independente de status e prazo. Só `rejected` o
   desliga. Mais restrição nunca publica claim errado.
5. **Número que a pessoa digitou numa campanha confirmada vale como afirmado só para os posts dela e até o
   fim dela.** Não vira fato da conta.
6. **Aviso, não bloqueio silencioso:** o administrador é avisado 7 dias antes e no dia do vencimento.

Alternativas descartadas:

- *Deixar o modelo confirmar fato que ele mesmo tirou do site:* tira a única barreira humana entre um erro
  de leitura e o post publicado. O ganho (menos cliques) não paga o risco.
- *Gravar `expired` por job:* dois jeitos de ficar errado (job atrasado, relógio do banco). Derivar da data
  é sempre certo e testável com data fixa.
- *Tabela separada de fatos importados:* duplica leitura, RLS e tela. Uma coluna de estado resolve.

## Consequências

- A migration é aditiva: colunas novas em `company_facts`, as linhas antigas viram `confirmed` com
  `verified_at = created_at` (um administrador as digitou) e o default passa a `pending`.
- Toda leitura de fato passa pela vigência. Quem lê `company_facts` direto, fora de `factsForPrompt` e do
  revisor, está errado; o teste de escopo de conta e o de geração cobrem os caminhos de hoje.
- Fica uma lacuna conhecida: post aprovado antes do vencimento e publicado depois. A checagem na hora de
  publicar fica para a frente de publicação (card próprio); até lá, o aviso de 7 dias dá margem.
- Conta nova tem fatos pendentes até alguém revisar: o post sai sem número, não bloqueado. O custo é
  texto menos específico; o ganho é nunca afirmar o que ninguém confirmou.
