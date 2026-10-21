# Plataforma única no Google Cloud, olhando cinco anos (21/10/2026)

> Revisão de três análises feitas por IA em 20/10/2026 (decisão para hoje, plataforma de cinco anos,
> dicas de arquitetura e custo), cruzadas com o que já existe no repositório e na conta da BEZ.
> Preços são os lidos em 20/10/2026 ([custo da infraestrutura](2026-10-20-custo-infraestrutura.md),
> BEZ-79). Câmbio de R$ 5,90 por US$, sem impostos. O que não foi verificado está marcado.
> Desdobramento: [SPEC 013](../specs/013-bez-cloud-platform.md).

## Resumo

1. O objetivo mudou de "custo mínimo hoje" para "uma plataforma onde cabem todos os produtos da BEZ".
   Para esse objetivo o Google Cloud é uma escolha defensável. Ele **não** é a escolha mais barata de
   Postgres: o argumento é governança (uma organização, um faturamento, um padrão de deploy, IAM e
   Terraform), não preço.
2. O número de produtos não decide o custo. Decide quantos produtos precisam de Postgres em
   produção, com que garantia, e quantos cabem numa instância (número que ninguém mediu ainda).
3. Unificar o Pilar custa cerca de US$ 50 por mês a mais que o Supabase Pro e 120 a 300 horas de
   trabalho (estimativa, não medida). Isso é preço de padronização, e a decisão é do Matheus. O que
   a análise mostra é que a fundação não depende dela.
4. Há um prazo curto que nenhuma das três análises viu: o teste do Google Workspace termina em
   **02/11/2026** e a organização do Google Cloud depende do domínio dele.

## O que as três análises dizem, e onde discordam

| Tema | Análise "para hoje" | Análise "cinco anos" | Leitura |
| --- | --- | --- | --- |
| Pilar | ficar no Supabase Pro, tirar só o front da Vercel | migrar para o Google Cloud | Não é contradição: o horizonte e o objetivo são outros. Os dois textos concordam que migrar não economiza dinheiro |
| Saint-Jardin | manter, melhorar a fila | Cloud Run, Cloud Tasks e Firestore | A segunda é mais coerente com a meta de unificar, mas muda o banco: precisa de spike (ver abaixo) |
| Site da BEZ | "não manter contêiner Next.js ligado" | Firebase Hosting estático | A premissa está errada: no Cloud Run com mínimo 0 não há contêiner ligado, o site já custa perto de zero. Exportação estática é opcional |
| Banco compartilhado | só depois de medir | uma instância 2 vCPU para até 5 produtos | Concordam em medir antes. Nenhuma das duas trata o custo de rede (abaixo) |
| Tetos de custo | R$ 330 não comporta produção séria | o teto não pode ser permanente | Concordam. Faz mais sentido um orçamento por nível de maturidade do que um teto único |

## Conferência dos números

A aritmética das tabelas de cinco anos **bate** (conferida): Supabase Pro US$ 25 mais US$ 10 por Micro
extra; Cloud SQL `f1-micro` US$ 11,53 mais 10 GB de SSD US$ 2,55 = US$ 14,08; dedicado de 1 vCPU
US$ 76,55; dedicado de 2 vCPU US$ 154,55. Os preços de Cloud SQL vêm das medições do Matheus em
20/10/2026; não foram reproduzidos na calculadora pública.

Piso de banco de produção, em US$ por mês (sem staging, sem backup extra, sem rede):

| Produtos com Postgres | Supabase (Micro cada) | Cloud SQL `f1-micro` cada | Cloud SQL dedicado 1 vCPU cada | 2 vCPU para cada 5 produtos |
| --- | --- | --- | --- | --- |
| 1 | 25 | 14,08 | 76,55 | 154,55 |
| 3 | 45 | 42,24 | 229,65 | 154,55 |
| 10 | 115 | 140,80 | 765,50 | 309,10 |
| 20 | 215 | 281,60 | 1.531,00 | 618,20 |

O ponto de equilíbrio entre Supabase e uma instância de 2 vCPU compartilhada é de cerca de 14 bancos de
produção na mesma instância (25 + 10 × (N − 1) = 154,55). Abaixo disso o Supabase Micro é mais barato
por produto.

**Por que a análise de 20/10 do repositório e a de cinco anos divergem quatro vezes em 50 projetos**
(US$ 419 contra US$ 1.545 no Cloud SQL dividido): a primeira supõe dezenas de bancos por instância; a
segunda, cinco. Essa suposição, que ninguém mediu, domina o resultado. Medir pico de CPU, memória e
conexões da Ekoai e do bot antes de planejar qualquer instância compartilhada.

Comparação não equivalente que as tabelas escondem: o Micro do Supabase já traz Auth, Storage,
Edge Functions e backup diário; o Cloud SQL traz só o banco. O custo de Auth (Identity Platform tem
franquia grande, ver abaixo), Storage e funções no Google Cloud é próximo de zero em volume pequeno,
mas o custo de **reescrever** não é.

### Custo fixo mensal dos quatro produtos, por caminho (US$)

Ekoai com produção em `f1-micro` e staging ligado só nos testes (decisão de 20/10, BEZ-79): 20 a 24.
Site e bot em Cloud Run com franquia gratuita: 0 a 7 somados (estimativa).

| Caminho para a Pilar | Pilar (produção + staging) | Total dos 4 produtos | R$ por mês |
| --- | --- | --- | --- |
| A. Supabase Pro + staging Micro, front no Firebase Hosting | 35 | 55 a 66 | 325 a 389 |
| B. Google Cloud, `g1-small` (sem SLA, o Google desaconselha produção) | 44 a 49 | 64 a 80 | 378 a 472 |
| C. Google Cloud, dedicado de 1 vCPU, staging `f1-micro` sob demanda | 80 a 85 | 100 a 116 | 590 a 684 |

A diferença A para C, cerca de US$ 48 a 50 (R$ 285 a 295) por mês, é o que a unificação do Pilar
custa em infraestrutura, além das horas de migração. Os preços de Cloud Run, Identity Platform e
Firestore dentro da franquia foram tratados como zero; ver "Não verificado".

## O que as análises não viram

1. **Prazo do Workspace.** O e-mail e o domínio da BEZ estão em teste do Google Workspace até
   02/11/2026. A organização `bezcompany.com.br` nasce desse domínio. Confirmar a assinatura (ou
   migrar para Cloud Identity Free) antes da data, para não colocar a organização em risco.
2. **O estado do Terraform mora num projeto de produto.** `ekoai-prod-tfstate` guarda o estado de
   todos os ambientes. Quando entrarem outros produtos, o estado deles ficaria dentro do projeto da
   Ekoai. Um projeto de plataforma separado (`bez-platform`) resolve isso e custa centavos. Isso
   reverte uma parte do D1 da SPEC 010, que evitava o projeto de admin por simplicidade.
3. **As políticas de organização valem só para a pasta `ekoai`.** Pasta nova de outro produto não
   herda nada. Subir as políticas para a organização (ou aplicá-las por módulo em cada pasta).
4. **Banco compartilhado entre projetos exige rede compartilhada.** Uma instância Cloud SQL com IP
   privado vive na VPC de um projeto. Para o Cloud Run de outro projeto alcançá-la é preciso Shared
   VPC ou Private Service Connect (a confirmar no desenho). Compartilhar banco entre produtos tem
   um custo de complexidade que a tabela de preços não mostra. Dentro de um mesmo produto (staging
   e produção do mesmo SaaS) não se compartilha: ver a regra de nunca juntar teste e produção.
5. **Staging é grátis quando o produto não usa Cloud SQL.** Cloud Run com mínimo 0 e Firestore no
   banco `(default)` cobram só uso, e a franquia do Firestore vale por projeto. Um projeto de
   staging para o bot custa perto de zero. O staging só pesa onde há Cloud SQL.
6. **O orçamento atual é menor que a conta da Ekoai.** O orçamento "BEZ mensal R$ 100" alerta em 50%,
   90% e 100%, e a Ekoai já ajustada fica em R$ 118 a 142. Conferir se o orçamento conta antes ou
   depois do crédito; sem ajuste, o alerta de 100% vira rotina e deixa de significar alguma coisa.
7. **Apagar `My First Project` pode derrubar o site.** O site da BEZ (Cloud Run em São Paulo) provavelmente
   roda no projeto padrão, que a SPEC 010 manda apagar na fase 7. Conferir antes.
8. **O Vercel Hobby é só para uso não comercial.** Vale para o front do Pilar e, se estiver nele, para o
   bot. Quem tem cliente pagante nessa plataforma está fora dos termos hoje.
9. **O repositório do bot é público e tem material de descoberta** (`docs/01-descoberta`, inclusive
   um `_chat.txt`). Conferir se há conversa real de cliente ali.
10. **Pilar e a Trinity.** O repositório e a organização do Supabase do Pilar são da Trinity, e há
    ordem de não tocar. Migrar ou até mexer no hosting do front depende de autorização e de definir
    onde o projeto passa a viver (BEZ-81 já cobre a transferência do Supabase).

## Padrão que serve para os próximos produtos

### Três níveis de maturidade (ideia da análise de dicas, adotada)

Um produto muda de nível por **uma variável do Terraform**, sem trocar de arquitetura. A Ekoai já se
comporta como `beta`. Valores iniciais na [SPEC 013](../specs/013-bez-cloud-platform.md).

### Três categorias de produto, para decidir o banco

| Categoria | Exemplo | Banco | Custo fixo típico |
| --- | --- | --- | --- |
| A, serverless | bot, agente, ferramenta interna | Firestore no `(default)` ou nenhum | perto de zero |
| B, SaaS pequeno | Ekoai agora | Postgres, `f1-micro` em `beta` | US$ 14 a 20 |
| C, SaaS com cliente e receita | Pilar no lançamento, Ekoai com cliente | Postgres dedicado, backup e PITR testados, HA se o cliente exigir | US$ 77 ou mais |

### Boas práticas que pesam mais, em ordem

1. Cloud Run com mínimo 0 e máximo baixo; o máximo protege o banco de conexões, não só a fatura.
2. Postgres local em Docker em desenvolvimento (a Ekoai já faz isso no CI), Cloud SQL só em
   staging e produção.
3. Staging do Cloud SQL ligado só nos testes (`activation_policy`). Parado, a máquina não cobra, mas
   disco e IP continuam.
4. Exportação de faturamento para o BigQuery **agora**: ela não recupera o passado.
5. Labels `product`, `env` e `tier` em todo recurso, para dividir o custo compartilhado depois.
6. Cota de IA por produto e por cliente (o custo de imagem passa o de Cloud Run cedo).
7. CI sem permissão de apagar produção (a Ekoai já tem: Workload Identity limitado à branch, ADR 0013).
8. Teste de restauração de backup a cada trimestre, não só backup configurado (a Ekoai já executou um).

## O que cada produto pede

| Produto | Hoje | Alvo no Google Cloud | Observação |
| --- | --- | --- | --- |
| Ekoai | Cloud Run, Cloud SQL, Identity Platform | igual, com módulos reaproveitáveis e `tier` | já pronta; é o molde |
| Site da BEZ | Cloud Run mínimo 0 e Firebase Hosting | igual, em projeto próprio | exportação estática é opcional |
| Bot de atendimento | Vercel, Supabase, `pg_cron` e `pg_net` por minuto | Cloud Run, Cloud Tasks (atraso de 60 s) e Scheduler | banco por spike, abaixo |
| Pilar | Vercel (front), Supabase (tudo) | Firebase Hosting no front já; o resto em spec própria | depende da Trinity |

### Bot de atendimento: o que o código mostra

> **Revisado em 21/10/2026.** Esta seção propunha Firestore e Cloud Tasks por mensagem, antes de ler o
> código. Depois da leitura a recomendação mudou para Postgres no Cloud SQL (pelo `@ekoai/db`) e Cloud
> Scheduler por minuto: ver a [SPEC 014](../specs/014-bot-de-atendimento-no-google-cloud.md).

Schema com 8 tabelas pequenas (`contatos`, `conversas`, `mensagens`, `handoffs`,
`eventos_processados`, `disponibilidade`, `consentimentos`, `fila_mensagens`), sem junção complexa, e
o banco isolado por portas (`src/ports`, `src/adapters/supabase.ts`). A fila é uma tabela com
`processar_apos` e um `pg_cron` por minuto chamando `/api/process` por `pg_net`.

- No Google Cloud a fila vira **Cloud Tasks** com `scheduleTime` de agora mais 60 s e o nome da tarefa
  igual ao `message_id` da Meta. O Cloud Scheduler por minuto deixa de existir, e o `pg_net` também.
  O nome da tarefa dá deduplicação, mas a tabela `eventos_processados` continua, porque o Cloud
  Tasks entrega pelo menos uma vez.
- Banco: **Firestore** (franquia grátis, escreve-se um adapter novo atrás das portas) ou **Postgres**
  num `f1-micro` (US$ 14 fixos, as migrations atuais valem). Recomendação: spike de meio dia com o
  adapter de Firestore; se o estado `conversas.slots` (jsonb) e as consultas por telefone cabem,
  seguir com Firestore. O Cloud Tasks aceita agendar até 30 dias à frente, o que cobre o delay e o
  follow-up, mas não lembretes de meses (usar o Scheduler com o dado no banco).

## Não verificado

- Preços de Cloud Run em São Paulo e se a franquia gratuita vale na região (a página oficial lista
  São Paulo na franquia de instâncias, mas o texto dos resultados da busca veio truncado; o
  [Cloud Run pricing](https://cloud.google.com/run/pricing) tem a palavra final).
- Se o Cloud SQL aceita `pg_net` (a lista de extensões não foi lida por inteiro; o `pg_cron` entra pela
  flag `cloudsql.enable_pg_cron`). Para o bot não importa, pois o Cloud Tasks substitui, mas importa
  para o Pilar.
- Firestore em São Paulo e a franquia nele: os resultados confirmam 1 GiB, 50 mil leituras e 20 mil
  gravações por dia e **um banco gratuito por projeto (o `(default)`)**, mas não confirmam a região.
- Preços de Cloud SQL em São Paulo por reprodução na calculadora, e de HA e PITR dessa região.
- Garantia (SLA) do plano Pro do Supabase: se não houver SLA formal nele, o argumento "o `f1-micro`
  não tem SLA" pesa menos contra o Supabase Micro do que as análises sugerem.
- Elegibilidade da BEZ aos créditos (Google for Startups exige intenção de captar investimento) e a
  data de constituição do CNPJ.
- Horas de migração do Pilar (120 a 300) são estimativa, sem inventário das 58 funções.
- Consumo real de CPU, memória e conexões de cada produto.
- Os links e casos de mercado citados nas análises originais não foram revisitados aqui.
