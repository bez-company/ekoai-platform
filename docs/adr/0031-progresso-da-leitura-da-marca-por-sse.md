# 0031. Progresso da leitura da marca por eventos (SSE sobre POST)

Status: aceita (03/11/2026). Vale para a [SPEC 034](../specs/034-onboarding-leitura-em-tempo-real.md) e para qualquer trabalho longo
que a tela precise acompanhar por etapa.

## Contexto

A leitura da marca (SPEC 033, ADR 0030) leva de 30 a 60 segundos e hoje responde de uma vez: a tela mostra "Lendo o seu site" até o fim. A
SPEC 034 quer mostrar o que o servidor está fazendo agora ("lendo a página de produtos", "pegando o logo") e cada resultado assim que existe.
Era preciso escolher como o servidor avisa a tela. A Ekoai roda no Cloud Run, atrás do Firebase Hosting, com Postgres e Firebase Auth; a leitura
é uma requisição só, sem fila, e não grava nada até a pessoa confirmar.

## Decisão

1. **Fluxo de eventos na própria requisição.** `POST /api/profile/site-read/stream` devolve `text/event-stream` (Server-Sent Events): um quadro
   por evento, com `id` (o `seq`), `event` e `data` em JSON. A tela lê o corpo com `fetch` e um leitor de quadros. É POST, não `EventSource`, porque o
   endereço do site vai no corpo e o cookie de sessão já acompanha o `fetch`.
2. **Contrato fechado** em `lib/site-read/events.ts`: `read.started`, `step.started`, `step.result`, `step.failed`, `read.done` e `read.failed`,
   cada um com `seq` (de 1 em 1) e `t` (ms desde o início). O leitor da tela confere cada evento (parser puro) e descarta o que não tem a forma
   certa, comentário, JSON quebrado e `seq` repetido ou voltando.
3. **Mesma regra da leitura de resposta única:** permissão `brand.manage`, teto por hora (`RULES.siteRead`), nada gravado. O que dá errado antes de abrir o
   fluxo (sessão, teto, endereço) volta como JSON, como nas outras rotas; depois de aberto, a falha vira `read.failed` com a frase da pessoa e o erro
   nosso vai para o log, sem detalhe na tela.
4. **Sinal de vida a cada 10 s** (comentário `: ping`) e cabeçalhos `Cache-Control: no-cache, no-transform` e `X-Accel-Buffering: no`, para quem está
   no caminho não segurar nem cortar o fluxo.
5. **Sem reenvio no servidor.** Se a conexão cai no meio, a tela mostra o aviso, mantém o que já chegou e lê de novo, uma vez; se o fluxo nem abre,
   usa a rota de resposta única, que continua existindo. Um buffer de eventos por leitura exigiria estado entre instâncias do Cloud Run (a CPU também é
   cortada depois que a requisição termina), complexidade que o ganho não paga: reler custa uma chamada ao modelo (cerca de US$ 0,004).
6. **Quem escuta os passos é um `probe`** (`lib/site-read/progress-model.ts`): a leitura não conhece SSE. O mesmo `probe` alimenta o log de tempo por
   etapa (BEZ-532).

## Alternativas

- **Polling** (como a Native, cerca de 200 chamadas em 3 minutos): simples, mas gasta chamada, atrasa o evento até o próximo sorteio e precisa de
  estado guardado no servidor entre uma chamada e outra.
- **Realtime (Firestore ou Postgres LISTEN):** serviria a leitura em segundo plano e o reenvio, mas pede um job fora da requisição, uma tabela ou
  coleção de eventos, regras de acesso e limpeza. Fica para quando houver trabalho que precise continuar sem a tela aberta.
- **`EventSource`:** só faz GET e não leva corpo; o endereço teria de ir na URL e ficar no log de acesso.

## Consequências

- **Risco não medido:** o Firebase Hosting na frente do Cloud Run pode limitar o tempo da requisição ou guardar a resposta antes de entregá-la. Só se
  confirma em staging. Se segurar o fluxo, a tela cai na resposta única sozinha (o comportamento de hoje). `maxDuration` fica em 60 s e a leitura do
  site inteiro tem de caber nele.
- Cada leitura segura uma requisição aberta até o fim (30 a 60 s). O teto por hora (8 leituras por conta) limita o efeito na concorrência do Cloud Run.
- Quem lê o fluxo precisa de um leitor tolerante (pedaços partidos, comentários): fica em `events.ts`, testado em `tests/site-read-events.test.js`.
- A rota é testada com o fluxo inteiro (`tests/site-read-stream.test.js`); o caminho real por Hosting e Cloud Run não é testado em CI.
