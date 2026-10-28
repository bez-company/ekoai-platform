# ADR 0028: o estúdio de posts roda em um Cloud Run Job com Chromium

- **Status:** proposto (SPEC 028, 28/10/2026)
- **Data:** 2026-10-28
- **Specs que dependem:** [SPEC 028](../specs/028-estudio-de-posts-multiagente.md)
- **Revisa:** o trecho "o render de artes sai e volta na fase 2" do [ADR 0010](0010-plataforma-generica-sem-pilar-no-codigo.md),
  só para o caminho Design autoral; o motor de layouts em SVG do [ADR 0017](0017-motor-de-design-hibrido-com-biblioteca-de-layouts.md)
  continua sendo o caminho rápido

## Contexto

O estúdio escreve a peça como HTML/CSS (fontes, filtros, máscaras, sobreposições) e precisa de um navegador para virar PNG;
o resvg do motor atual não renderiza esse CSS. Uma geração leva de 5 a 35 minutos (várias chamadas de modelo em série, uma
delas com mais de 10 minutos sob carga), e o worker interno de geração ([ADR 0018](0018-geracao-assincrona-por-worker-interno.md))
trabalha dentro de 240 s, abaixo do timeout de 300 s do Cloud Run. A imagem dos jobs hoje não tem Chromium.

## Decisão

1. **Um Cloud Run Job, `ekoai-studio`, executa um brief por execução.** Timeout de tarefa de 30 minutos, 1 tentativa
   automática (a idempotência é pelo brief e por `generation_runs`), 2 vCPU e 4 GiB. O cron de geração, ao pegar um brief com
   `engine = 'studio'`, só dispara a execução do job e sai; o brief fica "em geração" e o job bate o coração (`updated_at`) a
   cada etapa, então o reaproveitamento de brief parado há 15 minutos continua valendo.
2. **Chromium só nesta imagem** (`docker/studio.Dockerfile`), com `puppeteer-core` e o Chromium do sistema, fontes curadas de
   `platform/fonts` e usuário sem privilégio. A imagem da plataforma e a dos jobs de métricas não mudam.
3. **O navegador é isolado por requisição:** só `data:` e `about:` passam (o resto é abortado), sem JavaScript do HTML (removido
   antes), sem acesso à rede da conta. O job fala apenas com o Vertex AI e com o bucket de mídia da conta, com uma conta de
   serviço própria e mínima.
4. **O código do estúdio vive em `platform/src/lib/studio/`** e é compartilhado: o job o importa, o eval o importa e a
   plataforma só importa os tipos. O caminho rápido não muda.
5. **Fallback sempre:** erro, timeout ou teto de custo no job marca o brief para o caminho rápido, que gera o post no
   worker de sempre.

## Alternativas descartadas

- **Renderizar no worker da plataforma.** Estoura o orçamento de 240 s e coloca o Chromium no serviço que atende o
  cliente.
- **Serviço de renderização separado só para o HTML.** Resolve o Chromium mas não o tempo: a cadeia inteira continua sem lugar
  para rodar por 5 a 35 minutos. Um job resolve os dois.
- **satori (HTML para SVG) no lugar do navegador.** Cobre um subconjunto pequeno de CSS; perderia justamente o que dá o
  acabamento (filtros, máscaras, blend, SVG inline).
- **Cloud Tasks encadeando uma etapa por chamada.** Mais peças móveis e estado entre etapas; só se o job de longa duração se
  mostrar insuficiente.

## Consequências

- Nova imagem, novo job e conta de serviço no Terraform; custo por execução (vCPU e memória durante a geração) soma-se ao
  custo de modelo, e entra no teto por post.
- O tempo do post autoral deixa de ser limitado pelo worker, mas passa a depender da latência do modelo: a meta (p50 8 min,
  p95 15) é requisito da tiering de modelos (SPEC 028, F0).
- Uma segunda cadeia de render existe (Chromium e resvg): o contraste, as margens e os tamanhos mínimos são medidos nos dois
  pelas mesmas regras, em módulos próprios de cada um.
