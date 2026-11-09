# 0032. Agência como grupo de contas: cada cliente é uma conta

Status: aceita (09/11/2026, decisão do Matheus). Vale para a [SPEC 039](../specs/039-agencia-com-clientes.md) e responde à pergunta 7
da [SPEC 021](../specs/021-planos-e-cobranca-por-consumo.md) ("perfil dentro da conta ou conta por cliente", BEZ-265).

## Contexto

A agência quer gerenciar vários Instagrams na Ekoai. Hoje a conta é a marca: `company_profiles` tem a conta como chave, e fatos,
regras, paleta, logo, agenda, métricas e a conexão do Instagram são guardados por conta. A publicação pega a única conexão ativa.

## Opções

1. **Várias marcas dentro de uma conta.** Um campo de marca em quase todas as tabelas, a publicação escolhendo a conexão pela marca
   e o RLS por marca. Reforma grande, em código que hoje funciona, e com risco de misturar dados de clientes diferentes.
2. **Cada cliente é uma conta, agrupada pela agência.** Uma coluna `tenants.agency_id`, um plano `agencia`, uma tela de clientes e
   um seletor de conta. O isolamento, a publicação e a marca continuam como estão.

## Decisão

Opção 2. `tenants.agency_id` aponta para a conta da agência, que está no plano `agencia` (só o console liga). As regras ficam no
banco (migration 0067): cliente só de agência, sem aninhar, agência sem clientes para sair do plano. Os administradores da agência
entram como administradores de cada cliente novo, e a troca de conta usa a rota de sempre (`POST /api/auth/tenant`).

## Consequências

- Nada muda no isolamento por conta: cada cliente continua sendo o limite do RLS e dos tokens.
- Sem limite de clientes. A cobrança por marca e o saldo de créditos único da agência ficam para a cobrança real (BEZ-301), que
  vai somar os clientes pela coluna `agency_id`.
- Uma visão única de todos os clientes (aprovar, agenda) é trabalho futuro e lê as contas pela mesma coluna.
- Quem só cria posts na agência não entra nos clientes automaticamente; o cliente convida pela Equipe.
