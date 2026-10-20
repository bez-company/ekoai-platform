# Prova de conceito de design: briefing (19/10/2026)

> Aprovada em 20/10/2026 com as decisões abaixo (BEZ-75). Responde o risco central da conversa de 19/10: dá para gerar post
> com qualidade de designer a um custo que fecha a conta? Contexto em
> [ideias da conversa](2026-10-19-ideias-conversa-chatgpt.md). Roda antes da fase 2 da
> [SPEC 011](../specs/011-plataforma-generica-fase-1.md) e fora da plataforma: script isolado, sem
> tela e sem tabela nova.

## Pergunta

Um pipeline que gera o visual por IA e renderiza texto, logo e grade por código produz posts que
um avaliador cego aprova sem edição, a um custo por post aprovado dentro do alvo?

## Variantes comparadas

| | A: imagem inteira por IA | B: híbrido |
| --- | --- | --- |
| Visual | Modelo de imagem gera o post completo, texto incluso | Modelo gera só fundo, ilustração ou foto |
| Texto, logo, grade | Dentro da imagem | Renderizados por código com os tokens da marca |
| Layout | Livre | Schema JSON de slots; a IA escolhe e preenche |
| Editável depois | Não | Sim (texto e slots) |

A é a linha de base barata. B é a hipótese. Se A empatar em qualidade, o motor de B não se paga.

## Entradas

- **4 marcas** com perfis diferentes: Pilar (empresa de engenharia, B2B técnico), Ekoai (SaaS),
  BEZ Company (holding, foco em posicionamento de marca) e Projeto Fé (ONG, tom humano e social).
  A ficha de cada uma vem da exportação de dados da conta no staging.
- **20 briefs**, 5 por marca, misturando formato e objetivo: educar, vender,
  apresentar novidade, provocar a dor. Cada brief diz tema, objetivo e a ficha da marca (paleta,
  fontes, tom, fatos permitidos).
- **Referências:** 3 prints por marca, para testar a ficha de estilo (extrair layout, paleta,
  densidade de texto e narrativa).
- Sem chamada à API da Meta. O resultado é um PNG e uma legenda em pasta local.

## Avaliação

Cega: 3 pessoas (o Matheus e mais duas, ao menos uma de fora da BEZ) veem os posts das duas variantes embaralhados, sem saber qual é qual.

- Nota de 1 a 5: hierarquia, legibilidade, aderência à marca, originalidade.
- Pergunta binária: "postaria sem editar?" (sim ou não).
- Checagem por regra, automática: contraste mínimo, tamanho mínimo de fonte, margem de segurança do
  feed, acento e ortografia corretos no texto da imagem.
- Controle: 5 posts equivalentes feitos num editor de templates (Canva ou similar), para dar escala
  de comparação.

## Métricas

| Métrica | Como medir |
| --- | --- |
| Taxa de aprovação de primeira | "postaria sem editar" = sim, por variante |
| Custo por geração | Soma de tokens e imagens por post, registrada em cada chamada |
| Custo por post aprovado | Custo por geração dividido pela taxa de aprovação de primeira |
| Número de regenerações por post | Contagem até a primeira aprovação, limite de 3 |
| Erros de texto na imagem | Contagem por variante |
| Tempo por post | Do brief ao PNG final |

## Critério de passar

Definido antes de rodar, para não ajustar a régua ao resultado. Números confirmados pelo Matheus
em 20/10/2026:

- B com taxa de aprovação de primeira acima de 50% e acima de A.
- Nota média de B próxima da do controle de templates (diferença de até 0,5 ponto).
- Custo por post aprovado de B abaixo de R$ 2.
- Zero erro de acento ou ortografia no texto renderizado por código.

Se B passar, a fase 2 segue com o motor híbrido. Se só A passar, a fase 2 usa A e adia as camadas
editáveis. Se nenhum passar, a fase 2 vira geração de legenda mais seleção de template, e a imagem
espera o próximo ciclo de modelos.

## Fora de escopo

Vídeo, carrossel, publicação, agendamento, analytics, tela de aprovação, biblioteca de
inspirações como produto. Três direções por post não entram: testa-se uma direção, com um ajuste
por instrução.

## Riscos

- 20 briefs é amostra pequena: serve para decidir direção, não para provar estatística.
- Três avaliadores conhecem as marcas e podem inflar a nota. Ao menos um deve ser de fora.
- Modelos de imagem mudam rápido; registrar nome e versão do modelo em cada geração.

## Entregável

Uma pasta com os posts de A e B por brief, a planilha de notas e custos, e uma página de
conclusão com a decisão (B, A ou nenhum) e o motivo. A conclusão vira ADR curto se a decisão
passar de uma feature.
