# ADR 0015: BEZ Cloud Platform, base comum de todos os produtos no Google Cloud

- **Status:** aceito
- **Data:** 2026-10-21
- **Specs que dependem:** [SPEC 013](../specs/013-bez-cloud-platform.md)
- **Estende:** [ADR 0006](0006-google-cloud-como-plataforma.md) (de "plataforma do produto" para "plataforma da BEZ")
- **Análise:** [plataforma única, cinco anos](../analises/2026-10-21-plataforma-gcp-cinco-anos.md)

## Contexto

A BEZ tem quatro produtos em arranjos diferentes (Ekoai no Google Cloud; site da BEZ no Cloud Run;
bot de atendimento e Pilar na Vercel com Supabase). A meta é ver tudo numa só organização, com um
padrão repetível, sem custo fixo relevante para produto sem cliente. A análise mostrou que o Google
Cloud não é o Postgres mais barato (o Supabase Micro ganha por produto até cerca de 14 bancos
compartilhando uma instância de 2 vCPU), e que o argumento é governança: uma organização, um
faturamento, um padrão de deploy, IAM e Terraform.

## Decisão

1. **Google Cloud para todo produto da BEZ**, na ordem Ekoai, site, bot de atendimento e Pilar. O
   Pilar só é **preparado** no Google Cloud; a produção dele segue no Supabase até uma SPEC de virada.
2. **Estrutura:** uma pasta por produto; um projeto por produto e ambiente; um projeto `bez-platform`
   (estado do Terraform, exportação de faturamento, orçamentos) e um `bez-company-sandbox`.
3. **Níveis de maturidade** `lab`, `beta` e `production`, escolhidos pela variável `tier` e pelo label
   `tier`, com os valores iniciais da SPEC 013.
4. **Banco:** Postgres para SaaS multi-tenant com RLS; Firestore só para bot ou agente com dado
   simples; Postgres local em desenvolvimento. Sem Cloud SQL compartilhado entre projetos até haver 3
   produtos com cliente e medição de capacidade.
5. **Módulos de Terraform** extraídos quando o segundo consumidor real precisar, não antes.
6. **Governança:** políticas na organização, orçamento por projeto, exportação de faturamento para o
   BigQuery e labels `product`, `env` e `tier` em todo recurso. Nenhum crédito entra no orçamento.

## Consequências

- O estado do Terraform sai do `ekoai-prod` e passa a viver no `bez-platform` (bucket
  `bez-platform-tfstate`). Isso muda parte do D1 da SPEC 010, que evitava o projeto de administração.
- O `My First Project` (onde o site da BEZ roda) só é apagado depois de o site migrar e de os MCPs do
  Google Cloud da BEZ serem repontados.
- Cada produto novo paga o custo do módulo comum e ganha o padrão de custo, alerta e backup do seu
  nível; promover de nível é mudar uma variável, não reescrever.
- A unificação do Pilar custa cerca de US$ 50 por mês a mais que o Supabase Pro e 120 a 300 horas de
  migração (estimativa). É preço de padronização, aceito, e fica fora do caminho crítico.
- Cloud SQL compartilhado entre produtos continua uma decisão aberta, reavaliada com os números de 30
  dias medidos (SPEC 013, E1.15).
