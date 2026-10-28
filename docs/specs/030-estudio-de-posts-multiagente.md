# SPEC 030: estúdio de posts multiagente (design autoral por pedido)

- **Status:** aprovada pelo Matheus em 2026-10-28 (o ADR 0028 segue proposto)
- **Data:** 2026-10-28
- **Cards:** BEZ-406 (esta spec); pai BEZ-403 (experimento e eval); BEZ-404 (variação) e BEZ-405 (defeitos de layout) entram como fases
- **Origem:** o Matheus comparou os posts do experimento com os do gerador atual: "ficaram absurdamente melhores, vamos
  implementar". O experimento está em `evals/studio/` (README e `baselines/run-1.json`).
- **Depende de:** [ADR 0017](../adr/0017-motor-de-design-hibrido-com-biblioteca-de-layouts.md) (o motor de layouts, que continua
  como caminho rápido), [ADR 0018](../adr/0018-geracao-assincrona-por-worker-interno.md) (geração por fila),
  [SPEC 020](020-instrucoes-explicitas-do-pedido.md) (o leitor de instruções), [SPEC 018](018-objetivos-campanhas-e-fatos.md)
  (fatos e campanha), [SPEC 021](021-planos-e-cobranca-por-consumo.md) (consumo), [SPEC 026](026-logo-e-variacoes.md) (variações do logo)
  e [ADR 0028](../adr/0028-estudio-de-posts-em-cloud-run-job-com-chromium.md) (onde roda)
- **Protótipo:** não há tela nova. A única mudança visível é o texto das etapas de "Criando o post" e o aviso de espera mais
  longa; é copy, fora da regra do protótipo.

## Problema

O post de hoje sai de uma família fixa de layout (etiqueta, título, subtítulo, logo, @ e foto de fundo). Pedidos diferentes
saem com a mesma cara, e o cliente não confia no resultado. Na rodada de 28/10/2026 (12 pedidos simples, 3 marcas), um estúdio
com vários agentes que escrevem o HTML da peça foi melhor em 12 de 12 duelos: nota de design 8,4 contra 5,8 (juiz
independente), originalidade 8,2 contra 3,0, "postaria sem editar" em 10 de 12 contra 8 de 12.

O experimento também mostrou o que falta para virar produto: variação fraca entre tentativas (6 de 10), uma cauda de defeitos
de layout, custo de cerca de US$ 0,56 por post e de 5 a 35 minutos por peça, nenhum uso do contexto da conta e saídas dos
agentes sem validação de formato.

## Decisões propostas

1. **Dois caminhos, escolhidos por post.** O caminho rápido de hoje (SVG por código, segundos, centavos) continua. O caminho
   **Design autoral** (o estúdio) roda quando a pessoa o escolhe em "Criar post" ou quando o plano o inclui. Falha ou estouro de
   custo no autoral cai no rápido, nunca em "erro".
2. **Os agentes do experimento viram a cadeia de produção**, na mesma ordem: marketing, diretor criativo, redator, direção de
   arte, ilustrador, designer (2 rascunhos), crítico, embelezador, revisor final. O código passa de JS do eval para TypeScript em
   `platform/src/lib/studio/`, com o mesmo contrato de cada agente.
3. **Contexto montado por código, não por agente.** Um passo determinístico (`studio/context.ts`) reúne e entrega um brief
   único: perfil e voz, fatos **válidos** (vencidos e recusados ficam de fora), campanha e objetivo, regras de estilo aprendidas
   com as edições (SPEC 019), os últimos N posts da conta (territórios e títulos, para o diretor e o redator evitarem repetição:
   BEZ-404), análise do público quando houver (SPEC 022) e as instruções lidas do pedido (SPEC 020), que o designer obedece
   (logo, fundo, texto exato).
4. **Contrato fechado nas saídas.** Cada agente devolve JSON validado por parser puro (formato, tamanhos, enumerações) antes
   de alimentar o próximo; saída inválida repete uma vez e depois falha a etapa com motivo. O HTML do designer passa por
   sanitização (sem script, sem URL externa, só fontes e imagens da conta).
5. **Variedade por construção.** O sorteio de territórios criativos continua com semente por pedido, agora excluindo os usados
   recentemente na conta; o diretor reprova rota ou título parecido com os recentes.
6. **Medição por código no render, antes e depois do crítico:** margem, corpo mínimo, texto cortado, logo (tamanho e
   contraste da versão certa), mais as novas medições de BEZ-405: sobreposição entre texto e anotação e contraste do texto sobre
   imagem, amostrando os pixels atrás de cada caixa. Defeito medido volta ao designer (até 2 voltas) e nunca vai à aprovação.
7. **Modelos por etapa.** Pro para designer, direção de arte, crítico e juiz; Flash para marketing, diretor, redator e
   revisor, **se** a ablação (F0) mostrar que a nota não cai. Imagem: `gemini-3-pro-image`, no máximo 2 por post.
8. **Teto de custo e de tempo por post.** Custo estimado acumulado a cada etapa, em `generation_runs` (já existe, uma linha por
   chamada); passou de US$ 0,90 ou 20 minutos, o post fecha com a melhor versão que existe ou cai no caminho rápido.
9. **Ajuste depois de pronto.** "Pedir ajuste" (SPEC 024) num post autoral reabre o designer com o HTML guardado e a
   instrução, uma volta cirúrgica com o mesmo guarda de regressão. O editor livre em camadas (SPEC 027) **não** abre post
   autoral na v1: o botão "Preciso de mais controle" continua contando o desejo. Converter HTML em camadas fica para depois,
   se houver demanda.
10. **Portão de qualidade antes de ligar para clientes.** Só vai ao ar com o eval no piso: nota de design do juiz de pelo
    menos 8,0, variedade pelo menos 8, zero defeito de layout medido e "postaria sem editar" de pelo menos 90% em 24 peças,
    **e** a aprovação do Matheus olhando os `compare.png`. O piso é revisado com a avaliação humana, que é o único dado fora
    da família do modelo.

## Execução e dados (a confirmar na implementação; decisão técnica no ADR 0028)

| Item | Mudança |
|---|---|
| Onde roda | Cloud Run Job `ekoai-studio` com Chromium na imagem; o cron de geração só dispara a execução do job para o brief (a geração de 5 a 35 min não cabe nos 300 s do worker) |
| `briefs` | coluna `engine text not null default 'fast' check (engine in ('fast','studio'))`; migration aditiva e reaplicável. Fila e reaproveitamento de brief "em geração" há mais de 15 min seguem iguais, com batimento (`updated_at`) a cada etapa |
| `post_designs.design` (jsonb) | `studio?: { html, territory, scores, assetKeys, costUsd }`: o HTML final e o que ele usa, para o ajuste. Sem migration; o limite de 64 KB do `design` pede guardar o HTML em arquivo (`studio/<brief>.html` no bucket) e só a chave no jsonb |
| `generation_runs` | uma linha por chamada, com `step` = nome do agente; o custo por etapa sai daqui |
| Etapas da tela | `STEPS` ganha, no caminho autoral, "Pensando a ideia", "Escrevendo", "Desenhando a imagem", "Montando e revisando", cada uma com o texto de espera |
| Consumo | o post autoral consome mais que o rápido (a definir em SPEC 021: ver perguntas abertas) |

## Fases

- **F0, no eval:** ablação (pipeline sem cada agente), tiering Flash x Pro, e a montagem de contexto simulada com histórico
  fictício. Entra aqui BEZ-404 (variação) e BEZ-405 (defeitos). Saída: números que justificam o que fica e o que sai da cadeia.
- **F1, lib:** `platform/src/lib/studio/` em TypeScript com agentes, parsers, contexto e medição, testes puros e eval apontado
  para o código de produção (o eval deixa de ter a cópia em JS).
- **F2, execução:** imagem do job com Chromium, Terraform do job, disparo pelo cron, batimento e teto de custo.
- **F3, integração:** `engine` no brief, escolha em "Criar post", etapas e copy, fallback para o caminho rápido, eventos de produto.
- **F4, ajuste:** "Pedir ajuste" em post autoral.
- **F5, portão e liberação:** eval no piso, aprovação do Matheus e liberação por conta (sinalizador), depois geral.

## Fora do escopo

Editor livre para post autoral; carrossel autoral (cada lâmina vira uma peça, custo multiplica: spec própria); vídeo e Reels; bucket
de referências públicas de design (as referências de nível vêm da galeria interna, sem marca de cliente); trocar o modelo de
texto da produção.

## Como verificar

- Testes puros: cada parser (aceita, recusa e repete), a montagem de contexto (fato vencido fora, histórico recente
  incluído), a sanitização do HTML, as medições de render (uma peça boa e uma com cada defeito) e o teto de custo.
- Teste de banco: `engine`, fila e batimento, `generation_runs` por etapa.
- Eval: `evals/studio` apontando para `platform/src/lib/studio` e o gerador atual como baseline, nos 3 conjuntos de marcas; o
  `compare` do eval entra no corpo da PR.
- Fluxo real: um pedido autoral de ponta a ponta no ambiente `staging` (job, Chromium, bucket, tela de aprovação).

## Perguntas abertas

1. **Preço e consumo:** o autoral custa cerca de US$ 0,56. Vira "crédito de design autoral" na SPEC 021, entra só em plano
   maior ou é limite mensal? Preciso da sua decisão antes da F3.
2. **Tempo aceitável:** a meta proposta é p50 de 8 minutos e p95 de 15. Se for aceitável a pessoa esperar isso na tela
   "Criando o post" (com aviso e notificação ao terminar), seguimos; senão, a tiering da F0 passa a ser requisito.
3. **Imagens de IA com pessoa:** o estúdio gera cenas com figuras humanas (a pessoa minúscula diante de um celular). Para
   marcas como a Fé a regra "nunca criança" é do perfil; vale uma política geral (sem rosto reconhecível, sem criança) no
   portão de segurança?

## Riscos

- **Qualidade medida por modelo da mesma família.** Mitigação: aprovação humana no portão e piso revisado com ela.
- **Custo e latência fora de controle.** Mitigação: teto por post, fallback e Flash nas etapas leves (F0 decide).
- **Chromium na imagem aumenta superfície e tamanho.** Mitigação: job isolado, sem a imagem da plataforma, rede só para o
  Vertex e o bucket (ADR 0028).
- **Injeção por pedido ou por fato da conta.** O texto do cliente entra em prompts: vai entre delimitadores e o HTML do
  designer passa por sanitização; nenhum agente tem ferramenta nem acesso a dados da conta além do brief montado.
