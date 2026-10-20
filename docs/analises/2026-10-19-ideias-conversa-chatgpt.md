# Ideias da conversa com o ChatGPT sobre o Ekoai (19/10/2026)

> Análise, não decisão. Fonte: transcrição de uma conversa por voz entre o Matheus e o ChatGPT,
> com valores e exemplos que são hipóteses, não preços nem limites fechados. Cruzada com a
> [SPEC 011](../specs/011-plataforma-generica-fase-1.md), os ADRs
> [0004](../adr/0004-construir-o-saas-sem-cnpj-validando-com-a-pilar.md),
> [0005](../adr/0005-tenancy-e-login-por-usuario.md),
> [0007](../adr/0007-tres-papeis-de-conta.md) e
> [0010](../adr/0010-plataforma-generica-sem-pilar-no-codigo.md), a
> [SPEC 003](../specs/003-ideia-reaproveitamento-e-feedback.md) e a
> [pesquisa de concorrentes](2026-10-16-concorrentes-e-insights.md). O briefing da prova de
> conceito de design está em [2026-10-19-poc-design-briefing.md](2026-10-19-poc-design-briefing.md).

## Inventário

| # | Ideia | Situação |
| --- | --- | --- |
| 1 | Posicionar como "departamento de marketing movido por IA", não gerador de posts | Nova |
| 2 | Cadeia de agentes (estrategista, conteúdo, diretor de arte, copy, revisor, analytics) com orquestrador; agendamento determinístico, sem IA | Parcial (pipeline antigo na tag `pilar-v1`) |
| 3 | Três públicos: individual, time, agência | Parcial (papéis no ADR 0007; um usuário em várias contas no ADR 0005) |
| 4 | Hierarquia conta, workspace, marca, redes | Conflita com o modelo atual (ver abaixo) |
| 5 | Híbrido proativo: frequência e dias configurados, gera antes, aprovação | Parcial |
| 6 | Autonomia manual, supervisionado e automático, por tarefa | Nova |
| 7 | Publicação automática se o usuário não responder no prazo | Nova, de risco |
| 8 | Central de aprovações (aprovar todos, editar, pedir nova versão) | Parcial (SPEC 003 aprova por ideia) |
| 9 | Sem chatbot; cinco áreas: início, planejamento, estúdio, campanhas, inteligência | Decisão do Matheus |
| 10 | Motivo da rejeição vira aprendizado | Já na SPEC 003, por aspecto |
| 11 | Criação manual, assistida ou total; manual não gasta crédito | Nova |
| 12 | Motor de referências: analisar perfis admirados e extrair o que agrada | Nova |
| 13 | Biblioteca de inspirações: salvar link e classificar | Nova |
| 14 | Formato (imagem, carrossel, vídeo) separado de objetivo (educar, vender, engajar) | Parcial (pilar e ângulo da SPEC 003) |
| 15 | Três direções criativas por post | Nova, contradiz a pesquisa de 16/10 |
| 16 | Motor de design: camadas editáveis, híbrido de templates e IA, post aprovado vira template | Nova, a mais cara |
| 17 | Memória de marca e biblioteca de ativos | Parcial (perfil da empresa, R3 da SPEC 011) |
| 18 | Contexto verdadeiro: site, blog e GitHub alimentam os agentes | Nova |
| 19 | Campanhas (10 posts em 2 semanas) | Já na SPEC 001 |
| 20 | Reaproveitar post em carrossel e vídeo | Parcial |
| 21 | Calendário que acha lacunas | Nova |
| 22 | Vídeo e gêmeo digital | Fora do escopo atual |
| 23 | Pilotos: escritório de engenharia, Pilar, Ekoai | Parcial |
| 24 | Planos de R$ 49, 99 e 249; agência R$ 299 por 5 marcas; créditos; custo por post aprovado | Hipótese |
| 25 | Promessa "um mês de conteúdo em poucos minutos" | Nova |

## Revisão

### Escopo
A SPEC 011 cortou a fase 1 para plataforma sem geração, só Instagram, sem vídeo, e o ADR 0010 não
prevê piloto fora da Pilar. A conversa reabre quase tudo isso. Tratar as ideias 12 a 22 como
roadmap da fase 2 em diante, sem mexer na fase 1.

### Workspace e marca (4)
Hoje uma conta (tenant) é uma empresa, com RLS por `tenant_id`. Não adicionar camada de workspace
agora.
- Cada cliente de agência é um tenant e o usuário da agência pertence a vários (ADR 0005).
- Falta cobrança agregada e portal de aprovação do cliente. Quando agência virar prioridade, criar
  um agrupador "organização" acima dos tenants só para cobrança, sem reescrever o RLS.
- O papel Leitor já lê e dá parecer. Falta aprovar por link mágico, sem login.

### Autonomia (6 e 7)
- Modelar como tarefa por nível: planejar, gerar e publicar, cada uma em "pede aprovação" ou
  "automático". `creator_can_approve` e a pausa da grade de horários já existem no ADR 0007.
- Prazo vencido não publica por padrão. Quem quiser liga; a pausa serve de botão de emergência.
- Ideia nova: sugerir subir o nível depois de N aprovações seguidas sem edição. A sugestão fica com
  o usuário e nunca é automática.
- Na aprovação em lote, marcar o que merece olho (preço, número, funcionalidade nova), para
  "aprovar todos" não virar aprovar às cegas.

### Três direções por post (15)
Triplica o custo de geração, e o mercado foi no sentido oposto: o Metricool trocou 5 opções por 1
post com atalhos de ajuste. Gerar uma direção, oferecer "outra direção" por clique e, se for
mostrar três, mostrar só o esboço barato e renderizar apenas o escolhido.

### Motor de design (16)
Maior risco do produto. Arquitetura proposta:
- A IA gera só o visual: fundo, ilustração, foto, ícone.
- Texto, logo e grade são renderizados por código (HTML/SVG para PNG) com os tokens da marca.
  Modelo de imagem ainda erra acento e palavra em português; texto renderizado nasce editável.
- Template é um schema JSON de slots (título, subtítulo, imagem, selo). A IA escolhe o layout,
  preenche os slots e pede o visual. Post aprovado vira schema novo.
- O revisor automático checa regras: contraste, tamanho mínimo de fonte, margem de segurança do
  feed.
- Layout e densidade de texto viram braços do bandit, e o analytics ensina o estilo, não só o tema.

### Referências e perfis de terceiros (12 e 13)
Ler o perfil de terceiros depende de acesso que a API oficial limita; scraping viola os termos da
plataforma. Caminho viável:
- O usuário envia print ou link e um modelo com visão extrai uma ficha de estilo: layout, paleta,
  densidade de texto, estrutura narrativa, CTA.
- O usuário edita a ficha ("quero isso, não quero aquilo") e ela alimenta o diretor de arte.
- Referência vira receita; copiar fica fora.

### Contexto verdadeiro (18)
- Base de fatos da empresa, cada fato com fonte (site, changelog, texto do dono).
- O post só afirma o que está na base. Fato novo exige fonte.
- Campo "nunca afirmar" para claims sensíveis (engenharia tem regra de conselho profissional).
- Vai no perfil da empresa (R3). Integração com GitHub e blog entra depois, mas o modelo nasce com
  `fonte`.

### Preço (24)
- A margem do ChatGPT ignora regeneração. Custo por post aprovado é custo por geração dividido pela
  taxa de aprovação de primeira: com 40%, R$ 1 vira R$ 2,50.
- Âncora de mercado: mLabs cobra cerca de R$ 30 por marca, com Pix e teste sem cartão.
- Estrutura que Blotato e Metricool já usam: post manual e agendamento sem crédito, crédito só em
  imagem e vídeo.
- O gate do ADR 0004 continua valendo: sem preço antes de validar com a Pilar.

### Pilotos (23)
Escritório de engenharia e Pilar são B2B técnico, e o Ekoai é o próprio Matheus. Falta um piloto de
perfil diferente (influenciador ou pequeno comércio) antes de afirmar que serve aos três públicos.

### Buracos
- Meta: revisão do app, permissões de publicação e insights, limite diário de publicação, tipo de
  conta exigido. O prazo de aprovação decide o cronograma, então começar cedo.
- Rótulo de conteúdo gerado por IA e direito de imagem e voz no gêmeo digital (LGPD): confirmar
  antes de planejar vídeo.
- Métrica de produto: "tempo até o primeiro post aprovado" mede melhor que a promessa do mês
  inteiro.

## Ideias acrescentadas
1. Ficha de estilo a partir de referências.
2. Base de fatos com fonte.
3. Sugestão de subir autonomia por histórico.
4. Design como schema de slots mais render por código.
5. Estilo como braço do bandit.
6. Aprovação por link mágico para o cliente da agência.

## Ordem sugerida
1. **Fase 1 como está.** Acrescentar só o campo `fonte` nos fatos da empresa e o modelo de
   autonomia como dado, sem tela.
2. **Prova de conceito de design** antes da fase 2 (briefing no documento ao lado).
3. **Fase 2:** imagem única e legenda, aprovação, referências por upload, motivo da rejeição.
4. **Depois:** carrossel, proatividade avançada, agência. Vídeo e gêmeo digital por último.

## Decisões em aberto
1. A fase 2 sai com uma direção e botão "outra direção", ou com três direções?
2. Publicação automática por prazo vencido entra como opção ou fica fora?
3. Agência entra como organização acima dos tenants agora, ou só com o primeiro cliente?
