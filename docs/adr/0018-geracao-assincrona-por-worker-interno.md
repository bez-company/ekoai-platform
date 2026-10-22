# ADR 0018: geração de post assíncrona, por um worker interno acordado pelo pedido

- **Status:** aceito
- **Data:** 2026-10-22
- **Specs que dependem:** [SPEC 012](../specs/012-agentes-instagram-fase-2.md) (R1, R5.1 e entrega 5)
- **Depende de:** [ADR 0017](0017-motor-de-design-hibrido-com-biblioteca-de-layouts.md)

## Contexto

Gerar um post leva de 15 a 150 segundos: uma chamada de texto, até duas voltas do revisor, uma
chamada de imagem (na prova, de 11 a 117 s) e o render. O Cloud Run da plataforma respondia em 60 s
e a pessoa não pode ficar com um pedido preso no navegador. O pedido precisa responder na hora,
a geração seguir por fora, e o andamento aparecer por etapa.

Opções olhadas: Cloud Tasks (fila gerida, exige mais infra e IAM), Cloud Run Jobs (uma execução por
pedido, lento para começar), e um worker dentro do próprio serviço.

## Decisão

1. **O pedido só grava.** `POST /api/posts` insere o `brief` com `status = queued` e responde com o
   id. Nada de modelo no caminho do pedido.
2. **O worker é uma rota do próprio serviço**, `/api/cron/generate`, protegida como as rotas de cron
   (token OIDC do Scheduler ou `Bearer CRON_SECRET`). Ela pega até 3 pedidos da fila com
   `for update skip locked` (duas instâncias nunca pegam o mesmo), roda a geração de cada um pelo
   `tenantDb` da conta e devolve à fila o que não coube no orçamento de tempo.
3. **Quem acorda o worker é o pedido**, com uma chamada não aguardada (`Bearer CRON_SECRET`). Se
   falhar, o **Cloud Scheduler chama a cada 2 minutos** e pega o que ficou. Brief "gerando" há mais
   de 15 minutos é de um worker que caiu e volta à fila.
4. **O timeout do serviço sobe para 300 s** e o worker trabalha com orçamento de 240 s.
5. **Idempotência vem do banco** (`generation_runs`, migration 0023): a etapa que já deu certo é
   reaproveitada; tentar de novo um pedido que falhou gera só o que faltou.

## Consequências

- Sem fila gerida: menos infra, e o custo fica no Cloud Run que já existe. Se a fila crescer (muitas
  contas pedindo ao mesmo tempo), a troca por Cloud Tasks é só na forma de acordar o worker.
- A rota de cron é mais uma rota pública por caminho exato no middleware, com a mesma prova das
  outras (OIDC ou segredo).
- Latência típica: o pedido vê a primeira etapa em segundos e o post pronto em cerca de 1 minuto;
  no pior caso (worker acordado só pelo Scheduler), mais 2 minutos.
- O Scheduler nasce pausado na staging (`schedules_paused`), como os outros: lá o caminho normal é
  o pedido acordar o worker.
