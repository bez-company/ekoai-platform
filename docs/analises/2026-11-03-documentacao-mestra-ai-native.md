# Ekoai: documentação mestra de evolução AI-native

**Estratégia, contexto, operação de comunicação, funcionalidades, arquitetura, referências e cronograma de implementação.**

**Data de consolidação:** 3 de novembro de 2026.
**Versão:** 1.1, a versão pública para o repositório, com a reconciliação com a `staging` (seção 25.5).
**Responsável de produto:** Matheus Rezende.
**Card:** [BEZ-540](https://app.clickup.com/t/1dfhfaq9cvj).
**Natureza:** documento de estratégia e planejamento; não equivale a aprovação de todas as propostas, especificação pronta para merge ou atestado de produção.

Esta documentação consolida uma conversa de estratégia, leituras dirigidas do repositório e documentos anteriores. A seção 25.5 cruza cada iniciativa com specs, PRs, código e cards da `staging` em 03/11/2026 (commit `cf1aeac`). O resto não é auditoria técnica nova nem atualização de mercado.

**Como interpretar os estados:**
- **Diretriz do fundador:** intenção ou restrição explicitamente estabelecida por Matheus.
- **Observado em código:** implementação vista em arquivo/revisão; não garante deploy, flag ativa ou funcionamento em produção.
- **Documentado em spec/PR:** estado declarado pela equipe, que pode estar adiantado ou atrasado em relação ao código.
- **Proposta:** recomendação ainda sujeita a validação, protótipo, critérios de aceite e decisão.
- **Hipótese/experimento:** oportunidade que depende de teste técnico ou comercial.
- **Histórico/superado:** preservado para explicar a evolução, sem prevalecer sobre decisões posteriores.

As referências externas registram o que foi apresentado na conversa. Condições de APIs, planos, preços, permissões e capacidades comerciais precisam ser reconfirmadas quando forem virar dependências de implementação. Nenhum cronograma abaixo afirma que o trabalho já foi contratado, iniciado ou concluído.

**Versão pública:** o original citava fontes privadas de terceiros. Aqui ficaram só os princípios, sem fonte privada. O que é de outro produto da BEZ (por exemplo, a tela de indicação dentro dele) mora no repositório daquele produto.

---

## Sumário

- [1. Contexto, tendências e motivo da transformação](#contexto)
- [2. Visão, público-alvo, posicionamento e resultado desejado](#visao)
- [3. Registro de decisões e ideias substituídas](#decisoes)
- [4. Base existente, código observado e lacunas](#inventario)
- [5. Metodologia de comunicação delegada](#metodologia)
- [6. Onboarding: compreender a marca sem entregar post imediato](#onboarding)
- [7. Base de conhecimento, briefing vivo e três memórias](#marca)
- [8. Board de direção criativa e escolha de ideias](#board)
- [9. Campanha como unidade de trabalho e rotina contínua](#campanhas)
- [10. Produção visual, estúdio e qualidade editorial](#geracao)
- [11. Aprendizado contínuo: usar cada trabalho sem confundir sinais](#aprendizado)
- [12. Radar de oportunidades, pesquisa atualizada e notícias](#radar)
- [13. Coleta proativa de material e memória criativa](#materiais)
- [14. Publicação confiável, preflight e coordenação dos canais](#publicacao)
- [15. Métricas, atribuição e aprendizado de negócio](#mensuracao)
- [16. Modo agência, times e operação gerenciada](#agencias)
- [17. Apostas novas de produto e diferenciação](#apostas)
- [18. Indicação vinda de produto parceiro, sem acoplamento indevido](#integracao-parceiro)
- [19. Arquitetura de operação: conhecimento, planos e execução](#arquitetura)
- [20. Lições de engenharia: conectores, crawlers e agentes](#conectores)
- [21. Segurança, qualidade, autonomia e governança](#seguranca)
- [22. Modelo comercial, cobrança e economia da operação](#economia)
- [23. Concorrentes e padrões a incorporar](#benchmark)
- [24. Cronograma de implementação e gates](#roadmap)
- [25. Backlog consolidado e rastreabilidade](#backlog)
- [26. Pilotos, cenários de teste e perguntas abertas](#pilotos)
- [27. Apêndice: tendências, números e alternativas do início da conversa](#contexto-historico)
- [28. Matriz de cobertura da conversa e memória de contexto](#cobertura)
- [29. Fontes, referências e limites de evidência](#fontes)

---

<a id="contexto"></a>
## 1. Contexto, tendências e motivo da transformação

### 1.1. Pergunta original

Matheus começou questionando o futuro do SaaS quando IA de desenvolvimento facilita reproduzir telas e funcionalidades. A análise usou o mercado americano como referência e chegou à tese de que a vantagem precisa migrar de "ter software" para contexto, domínio, distribuição, confiança e execução.

Para a Ekoai, um gerador de legendas/imagens isolado não representa a ambição. A marca deve conseguir delegar uma parte de sua operação de comunicação.

### 1.2. Conceitos adotados

| Conceito | Significado no plano |
|---|---|
| SaaS | Acesso recorrente ao sistema; continua sendo modelo comercial possível. |
| AI-native | IA participa da decisão, execução e avaliação, não apenas de um campo de texto. |
| Service as Software | Cliente compra um trabalho delimitado entregue pela tecnologia. |
| Serviço AI-native | Pode combinar automação e intervenção humana, com escopo/custo explícitos. |
| Vertical AI | Conhecimento especializado do trabalho; na Ekoai, pode incluir playbooks de nicho sem limitar toda a plataforma a engenharia. |
| System of Action | O sistema planeja, produz, publica, verifica e acompanha. |
| System of Record | Guarda fatos, aprovações, campanhas, peças e eventos que sustentam a operação. |
| Aprendizado contínuo | Melhora de contexto, preferências, seleção e decisões; não exige atualizar pesos do modelo a cada post. |

### 1.3. Tendências discutidas

Produção multimodal, geração visual, agentes com ferramentas, tarefas assíncronas, memória autorizada, avaliações, seleção de modelos por custo/qualidade, cobrança por unidade de trabalho e interfaces para outros agentes.

Nos cenários 2027 a 2030 foram discutidos sistemas de execução, governança, software operado por software e comércio entre agentes. Para a Ekoai, o valor imediato é **menos coordenação do usuário e melhor decisão de comunicação**, não tentar antecipar toda infraestrutura desse horizonte.

Atribuição, confiabilidade e economia precisam amadurecer junto com a autonomia. Não prometer que toda campanha gera venda nem que um avaliador de IA sabe prever viralização.

### 1.4. Evolução da conversa

A proposta inicial enfatizou geração, campanhas e analytics. Matheus pediu mais ambição: o usuário não deveria precisar pensar continuamente nos posts, preencher detalhes ou conduzir cada etapa.

Foram acrescentados onboarding por leitura de marca, memória, experimentos, radar de oportunidades, pedidos proativos de material e board criativo. Depois, Matheus estabeleceu uma restrição clara: **não entregar post imediatamente no onboarding**.

O plano consolidado mantém a visão de operação completa sem contrariar essa decisão.

### 1.5. Contexto de outros mercados

Contabilidade, logística, captação de recursos, licenciamento e operações industriais foram explorados como exemplos de trabalho vendido como serviço tecnológico. Rillet, HappyRobot, Grantable/Instrumentl, PermitFlow e Sidekick apareceram nesse contexto.

Não são instruções para transformar a Ekoai em plataforma horizontal de todos esses serviços. A lição reutilizada é acompanhar um trabalho até o resultado verificável. Dados de mercado e investimento citados no começo estão preservados como registro histórico, não como premissas revalidadas.


---

<a id="visao"></a>
## 2. Visão, público-alvo, posicionamento e resultado desejado

### 2.1. Direção consolidada

> **A Ekoai deixa de apenas gerar conteúdo e passa a conduzir uma rotina de comunicação.**

A empresa fornece contexto e orientação comercial; a Ekoai compreende a marca, identifica oportunidades, propõe direção, produz, organiza execução e aprende com o que ocorre.

Frase de direção discutida:

> "Mostre sua empresa uma vez. A Ekoai prepara sua comunicação, identifica oportunidades e aprimora as próximas campanhas com o que aprende."

"Uma vez" não significa que informações nunca mais precisem ser atualizadas. Significa eliminar o briefing repetido e pedir somente mudanças/lacunas relevantes.

### 2.2. Público-alvo

Empresas individuais/pequenos times que precisam manter comunicação de qualidade e agências que operam múltiplas marcas. A plataforma deve continuar genérica, sem marcas de clientes embutidas no código.

A agência pode ser parceira operacional, não apenas alvo de substituição. O modo agência separa organização pagante, marcas operadas, colaboradores e aprovadores.

A escolha do primeiro segmento comercial ainda precisa ser validada. Confeitaria/bolos foi um exemplo do usuário para explicar relevância de notícias; não é decisão de nichar toda a Ekoai.

### 2.3. Não ser apenas um chatbot

A experiência desejada mantém board, campanhas, calendário, estúdio, aprovação, histórico e inteligência. Chat/comando pode ajudar a delegar, mas não deve ser necessário para toda ação nem o único lugar onde o trabalho existe.

O usuário não precisa saber pedir um prompt perfeito. O produto prepara direção e solicita o mínimo que realmente falta.

### 2.4. Trabalho entregue e limites

A Ekoai pode assumir planejamento, produção, agendamento permitido, verificação, coleta de sinais e proposta da próxima ação. Não controla completamente oferta, atendimento, concorrência, algoritmo da rede ou decisão de compra.

Distinguir: peça produzida; campanha executada; sinal observado; resultado comercial atribuído com determinado grau de confiança.

### 2.5. Vantagem competitiva proposta

Conhecer o que esta marca pode afirmar, como prefere se expressar, quais materiais possui, o que foi aprovado/publicado e como o público respondeu.

A qualidade visual é parte indispensável dessa proposta. Não sacrificar design em nome de automação, mas não confundir beleza com estratégia ou venda.

North Star provisória: **campanhas/rotinas executadas com aprendizado utilizável e baixo esforço humano**, acompanhadas de qualidade, retenção, custo e sinais comerciais.


---

<a id="decisoes"></a>
## 3. Registro de decisões e ideias substituídas

| ID local | Direção registrada | Estado e consequência |
|---|---|---|
| DEC-E01 | Ekoai deve pensar/preparar/executar mais trabalho de comunicação. | Diretriz explícita; não limitar a gerador. |
| DEC-E02 | A marca deve ficar melhor representada com o uso. | Diretriz; separar preferência, qualidade e desempenho. |
| DEC-E03 | Onboarding simples com site, Instagram conectado e/ou materiais. | Diretriz; leitura gera informação revisável. |
| DEC-E04 | Não entregar post imediatamente no onboarding. | Decisão explícita mais recente; substitui sugestão anterior de "primeira peça no cadastro". |
| DEC-E05 | Detalhes e variantes podem ser enriquecidos depois. | Diretriz; confirmar o essencial sem formulário exaustivo. |
| DEC-E06 | Instagram pode ser conectado no início. | Em implementação documentada; depende de permissões/liberação. |
| DEC-E07 | Buscar assuntos com modelo barato e busca real é opção. | Diretriz de investigação; LLM sem busca não fornece atualidade garantida. |
| DEC-E08 | Criar board/direção mais criativa, não só refinar ideias dadas. | Pedido explícito; estrutura do board é proposta. |
| DEC-E09 | Plataforma pede materiais reais quando isso melhora o trabalho. | Proposta discutida; não obrigar o usuário a virar produtor profissional. |
| DEC-E10 | Integração inicial com outro produto da BEZ é indicação contextual. | Diretriz; sem troca automática de dados dos clientes. |
| DEC-E11 | Uma empresa da BEZ usa a Ekoai no próprio marketing. | Laboratório possível; não acesso irrestrito aos dados dos clientes dela. |
| DEC-E12 | Campanha e seleção de ideias vêm antes de gasto visual desnecessário. | Proposta de método. |
| DEC-E13 | Autonomia por mandato e risco, não por aprovação automática após poucas peças. | Proposta de governança. |

### 3.1. O que continua das propostas anteriores

Fatos confirmados e vigentes, campanhas como unidade de trabalho, memória criativa, instrumentação comercial, supervisão de carteira e publicação confiável.

A proposta de mostrar três direções/peças cedo foi revisada: direções podem ser preparadas no fluxo posterior, mas o onboarding **termina com a marca compreendida/confirmada**, sem obrigar geração de post.

### 3.2. O que não foi decidido

Não foi escolhido modelo próprio, fornecedor único de notícias, preço final por campanha, escopo de serviço gerenciado, percentual universal de exploração, abertura de anúncios pagos ou calendário de redes adicionais.

Não existe autorização para treinar com material de outras marcas, raspar perfis privados, copiar identidade de concorrente ou publicar alegações não confirmadas.

### 3.3. Nomes e fronteiras

Ekoai é o nome do produto. Variações de grafia na conversa não representam novos produtos.

Uma marca da própria BEZ pode ser cliente da plataforma. O produto não contém regras específicas dela no código genérico. A indicação comercial é descrita em seção própria e não exige mistura das identidades.


---

<a id="inventario"></a>
## 4. Base existente, código observado e lacunas

### 4.1. Referência da leitura

Repositório `bez-company/ekoai-platform`, leitura principal em `staging`, revisão `5d6210a2ea5300ae18026bc9be63caa857d8ac5f`. A conversa posterior consultou SPEC 033/034 e PRs de onboarding.

Não houve execução independente dos testes, login completo no produto ou confirmação de todas as flags/deploys. PR com "Verified" é declaração de seu autor. Não converter em teste executado por esta análise.

### 4.2. Inventário a preservar

| Capacidade | Evidência observada/documentada | Próximo salto |
|---|---|---|
| Plataforma multi-tenant | Login, papéis, RLS por conta e `tenantDb`. | Supervisão de marca/carteira sem vazamento. [E01] [E02] |
| Contexto de geração | Perfil, voz, fatos, proibições, campanha e diretivas. | Briefing comercial vivo e memória estruturada. [E03] |
| Geração assíncrona | Worker, reserva de chamadas e reaproveitamento de etapas. | Trabalho contínuo por campanha, não só solicitação isolada. [E04] |
| Memória visual recente | Territórios e títulos para evitar repetição. | Atributos criativos e aprendizado de edição. [E05] |
| Feedback | Regras de estilo, evidência e edição manual. | Separar contexto da campanha e regra permanente. [E06] |
| Coordenador | Rotação, promoção, foto, datas, campanha e engajamento. | Selecionar hipóteses e coerência estratégica. [E07] |
| Analytics | Estados para pouca informação e permissões. | Sinais comerciais e incerteza explícita. [E08] |
| Publicação | Lease, tentativa, container Meta, reconciliação, ensaio. | Revalidação de fatos/condições antes de qualquer envio. [E09] [E10] |
| Fatos/campanhas | Fonte, validade, confirmação e vínculo. | Reagir à mudança do fato e invalidar conteúdo afetado. [E11] |
| Estúdio | Motor híbrido e evolução multiagente documentada. | Design melhor com custo e qualidade demonstrados. [E12] |
| Onboarding | Leitura do site, revisão, progresso e Instagram no cadastro. | Concluir e medir, sem reconstruir em paralelo. [E13] [E14] |

### 4.3. Arquivos de maior relevância

`platform/src/lib/agents.ts`, `generation.ts`, `studio/context.ts`, `feedback.ts`, `content-plan-model.ts`, `analysis-view.ts`, `publish.ts` e `app/api/cron/publish-due/route.ts`.

O comentário de um arquivo pode refletir uma fase anterior. "Estratégista/redator/diretor" no prompt não comprova uma equipe autônoma que conduz toda a campanha.

### 4.4. Revalidação no envio

A SPEC 018 registrou BEZ-275 para reavaliar fatos na publicação. Nos trechos de publicação lidos, não foi identificado um gate equivalente completo. Isso é uma lacuna estática a verificar, não prova de publicação incorreta em produção. [E09] [E11] Confirmado na reconciliação de 03/11 (seção 25.5): o envio só confere a pausa da conta.

Revalidar oferta, validade, campanha, mídia autorizada, versão aprovada e pausa imediatamente antes do efeito externo, inclusive no caminho em que a reconciliação decide publicar.

### 4.5. Legado não é capacidade ativa

README descrevia foco inicial em Instagram; código de LinkedIn/X e comentários de bandit/UTM podem existir sem toda a experiência estar habilitada.

Não reativar motor antigo de aprendizado, campanha ou seleção apenas por encontrar tabela/função. Mapear flags, interface, dados, testes e uso atual.

### 4.6. Três evidências diferentes

Código presente, experimento visual bom e melhoria comercial são evidências distintas. A documentação de estúdio não prova aumento de vendas nem substitui teste da campanha com clientes.


---

<a id="metodologia"></a>
## 5. Metodologia de comunicação delegada

### 5.1. Uma operação, não uma fila de prompts

A rotina proposta segue:

**Compreender → orientar → identificar oportunidade → escolher conceito → produzir → revisar/executar → observar → aprender → ajustar.**

A plataforma mantém esse ciclo vivo entre visitas do usuário. Uma semana sem comando não deveria significar perda completa de continuidade, desde que exista rotina autorizada e contexto suficiente.

### 5.2. Contrato da responsabilidade

Exemplo:

> "Mantenha a comunicação da marca ativa, priorize este serviço neste período e me chame quando precisar de material ou decisão."

Campos: objetivo, público, ofertas válidas, canais, cadência, limite de gasto, ações autorizadas, aprovador, materiais, restrições e condição de pausa.

A política deve impedir que "mantenha ativa" vire permissão para inventar desconto, publicar qualquer imagem ou gastar em anúncios.

### 5.3. Campanha e rotina permanente

Uma campanha tem objetivo e janela definidos. Uma rotina mantém presença e relacionamento. As duas podem coexistir, mas não devem competir por horários e mensagens sem coordenação.

O sistema pode propor reduzir, adiar ou encerrar comunicação quando oferta perde validade, material é insuficiente ou a empresa não consegue atender. Não precisa produzir a qualquer custo.

### 5.4. Entrega ao usuário

Em vez de "o que você quer postar?", mostrar direção preparada, motivos, materiais faltantes e decisões relevantes.

O usuário aprova direção, oferta ou exceção no nível adequado. Não precisa revisar instruções internas entre agentes. Aprovar a estratégia não autoriza qualquer afirmação material nova.

### 5.5. Metodologias por tipo de negócio

Playbooks de serviço local, e-commerce, marca pessoal ou agência são hipóteses de evolução. Devem partir de casos validados, não uma enciclopédia de nichos sem evidência.

Confeitaria ajuda a testar temas, capacidade e sazonalidade. Um SaaS da própria BEZ ajuda a testar comunicação de software e sinais do próprio funil. Esses casos não devem virar dependências fixas do produto.


---

<a id="onboarding"></a>
## 6. Onboarding: compreender a marca sem entregar post imediato

### 6.1. Resultado desejado

> "Esta é a empresa que entendemos. Estes são seus produtos, público, identidade e limites de comunicação. Confirme o essencial para começarmos."

Esse é o resultado do onboarding. Geração de post não é recompensa obrigatória nem condição de ativação desta fase.

### 6.2. Entradas

Site, conexão de Instagram elegível, material enviado e preenchimento manual como alternativa. Um `@` digitado não equivale a autorização para ler todos os dados do perfil.

O site fornece candidatos a nome, descrição, logo, cores, tipografia, voz, oferta e fatos. A conta conectada pode enriquecer com as capacidades realmente disponíveis. Não prometer análise visual de fotos quando a implementação só lê legendas/hashtags.

### 6.3. Progresso real

A SPEC 034 e PRs descrevem etapas e eventos: leitura de página, CSS, logo, cores, texto, modelo e Instagram. Resultados aparecem quando estão prontos; não usar animação que finge execução. [E14] [E17] [E18]

Falha de uma etapa não precisa destruir todo o resultado. Preservar o que chegou, explicar o que falta e permitir continuar.

**Nuance de implementação:** a spec considerou retomada por `Last-Event-ID`; a PR de UI descrita na conversa usa nova leitura após queda e fallback, não retomada server-side exata. Não anunciar a capacidade mais avançada até existir. [E18] Confirmado na reconciliação de 03/11: não há `Last-Event-ID` no código.

### 6.4. Leitura do site por orçamento

Inicialmente, a leitura era limitada à home e poucas páginas. A evolução proposta usa sitemap/links, classificação e prioridade para produto, serviço, sobre, preço e FAQ; blog entra conforme relevância e recência.

"Ler o site inteiro" não significa ausência de limites. Definir páginas, tempo, concorrência, bytes e texto por leitura a partir das medições.

Fontes lidas são registradas. Fato novo entra como rascunho, não como afirmação automaticamente autorizada. Sites podem estar desatualizados ou conter ofertas expiradas.

### 6.5. Revisão simples, enriquecimento posterior

Confirmar nicho, o que vende e para quem; corrigir identificação visual essencial. Permitir hex/seleção de cor e logo quando necessário, sem tornar variantes, persona longa e brand book completo obrigatórios.

Mais detalhes podem ser adicionados depois: variantes para fundo claro/escuro, símbolo, referências, exemplos aprovados e restrições. A ausência de um detalhe visual não deve bloquear tudo sem necessidade.

A SPEC 033 documentou três cores iniciais e expansão de paleta, escalas e variações de logo. Preservar o contrato atual do código, sem criar outra paleta paralela. [E13]

### 6.6. Instagram e liberação

A PR #338 descreve `state` assinado, destino em lista fixa e retorno ao cadastro. Uma feature flag controla a exposição pública conforme revisão da Meta. [E19]

"Agora não" precisa manter o caminho sem Instagram. Não prometer prazo de aprovação da Meta. Validar conta externa real, permissões, revogação e exclusão quando a integração estiver liberada.

### 6.7. Segurança e custo

Somente URLs permitidas, prevenção de SSRF, validação de DNS/redirecionamento, limites por página, sem cookies indevidos, regras de acesso e robots. Conteúdo externo é dado, não instrução ao agente. [E13] [E14]

A leitura consome recursos: medir tempo e custo por etapa. Testes e protótipos declarados nas PRs não substituem execução real atrás do Hosting/Cloud Run.

### 6.8. Critérios de aceite

Marca compreendida sem post obrigatório; campos essenciais explicados; resultado parcial preservado; fatos com fonte; conexão opcional; falha não obriga recomeço manual completo; cada progresso corresponde a evento; nenhum dado de outro tenant; orçamento de leitura respeitado.


---

<a id="marca"></a>
## 7. Base de conhecimento, briefing vivo e três memórias

### 7.1. Não criar uma memória paralela

A geração já usa perfil, voz, fatos, proibições, campanha e regras. A evolução deve enriquecer e organizar essas estruturas. [E03] [E06] [E11]

### 7.2. Separação fundamental

| Memória | Pergunta | Exemplo | Risco de misturar |
|---|---|---|---|
| Fatos | O que podemos afirmar? | Oferta, produto, preço, prazo, disponibilidade. | Transformar preferência em verdade comercial. |
| Preferência da marca | Como queremos expressar? | Tom, densidade, composição, palavras, referências. | Uma campanha excepcional alterar toda a identidade. |
| Desempenho | O que aconteceu? | Engajamento disponível, pedido identificado, aprovação. | Usar likes ou nota de design como prova de venda. |

Qualidade técnica da produção também é registrada, mas não substitui as três memórias.

### 7.3. Contrato de conhecimento

Cada informação relevante precisa de fonte, autoria/confirmação, escopo, validade, versão e uso permitido.

Uma oferta vale para aquela campanha e período. Um preço antigo do site não entra como vigente apenas por ter sido extraído. Uma regra manual não deve ser apagada silenciosamente por uma consolidação automática.

Mídia tem direitos, pessoas identificáveis quando houver, autorização e restrições. Revogação precisa atingir trabalhos futuros/preparados conforme a política.

### 7.4. Briefing comercial vivo

Acrescentar público prioritário, objeções, capacidade, região, disponibilidade, diferenciais comprovados e objetivo. Pedir mudança quando relevante, não refazer o onboarding semanalmente.

O sistema deve distinguir: "a empresa vende", "o usuário quer vender agora" e "a empresa consegue atender agora".

### 7.5. Esquecimento e correção

Permitir editar, suspender, substituir e apagar conhecimentos conforme regras de retenção. Mostrar por que uma regra foi aplicada e quais exemplos a sustentam.

Uma informação refutada não pode reaparecer porque está em um embedding antigo. Busca/contexto precisam respeitar o estado atual.

### 7.6. Referências e digest de perfis

A ideia de aprender com referências de Instagram foi preservada como análise de características autorizadas: composição, gancho, ritmo e tom. Não significa copiar a identidade ou obter métricas privadas de terceiros.

Usar material fornecido/autorizado ou APIs/fontes permitidas. Uma referência pode ser apreciada pela hierarquia, não pela paleta ou pelo texto literal.

### 7.7. Isolamento

Preferência e desempenho de uma marca não passam para outra por conveniência. Aprendizado agregado ou treinamento entre contas exige desenho próprio, autorização e tratamento de privacidade.


---

<a id="board"></a>
## 8. Board de direção criativa e escolha de ideias

### 8.1. Pedido do fundador

Matheus pediu sugestões mais criativas e destacou um board que ajude a pensar além de produzir posts avulsos. O board deve vir preenchido pelo sistema; não ser um formulário novo para o usuário.

### 8.2. Conteúdo de uma direção

Oportunidade e motivo de atualidade; público e tensão; conceito central; prova/material que sustenta; direção visual; desdobramentos; objetivo; sinal esperado; limites e informações faltantes.

Propor poucas direções completas e distintas, em vez de dezenas de títulos genéricos.

Exemplo ilustrativo para confeitaria: "A celebração começa antes da primeira fatia", com escolha de tamanho, bastidores, preparação e entrega. O exemplo não autoriza oferta ou alegação nutricional sem fonte.

### 8.3. Do board à campanha

Selecionar/ajustar direção → confirmar oferta/material → planejar sequência → produzir → aprovar no nível adequado → executar → aprender.

Cada peça tem papel no conceito: apresentar problema, explicar processo, mostrar evidência, responder objeção ou orientar a ação. Não apenas preencher buracos do calendário.

### 8.4. Seleção antes de renderização cara

A referência de Native/Norn é escolher ideias antes de investir em produção. A API foi descrita como não pública/lista de espera na pesquisa anterior; não depender dela sem nova verificação. [W10] [W11] [B12]

Pipeline: objetivo → alternativas curtas → restrições → ranking explicável → produção das escolhidas → observação.

### 8.5. Hipótese criativa como dado

Registrar público, ângulo, mensagem, oferta, prova, formato, CTA, por que testar, diferença do conteúdo recente, esforço relativo, sinal esperado e condição que invalida a hipótese.

A seleção pode começar por regras e heurísticas. Depois incorpora evidência da própria conta. Modelos estatísticos entram apenas com dados e avaliação temporal suficientes.

### 8.6. Evitar falsa precisão

Não apresentar "87% de chance de vender" derivado de nota subjetiva do LLM. Explicar critérios e incerteza.

Ideia rejeitada não é fracasso de público: não foi publicada. Ideia escolhida também não é sucesso comprovado. Guardar preferência e desempenho separadamente.

### 8.7. Exploração e identidade

Reservar espaço para hipóteses novas dentro do mandato; proporção é parâmetro a validar. Repetir só o último "vencedor" pode causar monotonia e impedir aprendizado.

Variar sem descaracterizar a marca. Uma ideia criativa precisa continuar verdadeira, pertinente e viável com os materiais disponíveis.

### 8.8. Aceite

Direções distintas, fontes válidas, objetivo claro, lacunas visíveis, custo de produção dentro do limite e justificativa compreensível. O board não dispara gasto ilimitado nem publicação automática ao ser aberto.


---

<a id="campanhas"></a>
## 9. Campanha como unidade de trabalho e rotina contínua

### 9.1. Base e evolução

Campanhas, sugestões e regras de coordenação já existem/documentam parte do fluxo. [E07] [E11] A proposta é completar a operação, não acrescentar outra tabela de campanhas sem integração.

### 9.2. Entrada e saída

Entrada: objetivo, oferta válida, público, janela, capacidade, restrições e materiais. Saída: plano coerente, peças, pedidos de material, aprovações, execução e leitura dos sinais.

Meta comercial escolhida pelo cliente é objetivo, não previsão automática da Ekoai.

### 9.3. Estados propostos

Rascunho → contexto incompleto → direção em revisão → plano autorizado → produção → revisão necessária → agendado → publicado → observação → aprendizado registrado.

Estados podem coexistir por peça dentro da campanha; a visão deve explicar o bloqueio sem esconder o que já foi entregue.

### 9.4. Coordenador existente como baseline

O código lido organiza sequência com datas, não repetição, promoção limitada, fotos e engajamento; campanha participa com cotas/regras. [E07]

Usar esse planejador como comparação e fallback. Melhorar a decisão estratégica sem apagar regras seguras ou reativar sistema legado de bandit por causa de comentário antigo.

### 9.5. Supervisão por nível

Revisar direção, oferta e exceções materiais. Rotinas de menor risco podem ser autorizadas antecipadamente. Uma aprovação de campanha não autoriza novas alegações ou gasto publicitário sem limite.

A plataforma continua responsável por acompanhar materiais faltantes, falha de canal, prazo e fato vencido. Não desaparecer depois de gerar a primeira imagem.

### 9.6. Adaptação durante a execução

Mudança de oferta, capacidade ou prioridade pode pausar, substituir ou replanejar peças. Preservar o que já foi publicado e a razão da mudança.

Não manter campanha comercial ativa só porque existem posts agendados. Não inventar urgência/escassez para ocupar o calendário.

### 9.7. Critérios e métricas

Plano atende ao objetivo declarado; peças relacionam-se à hipótese; bloqueios têm responsável; publicação tem evidência; aprendizado altera uma decisão posterior.

Medir tempo humano por campanha, retrabalho, execução no prazo acordado, custo por entrega aproveitada e sinais compatíveis com o objetivo.


---

<a id="geracao"></a>
## 10. Produção visual, estúdio e qualidade editorial

### 10.1. Preservar o investimento em design

O estúdio é parte central da proposta. Gerar comunicação com consistência não significa aceitar peças genéricas ou qualidade visual baixa.

A base observada combina contexto, instruções explícitas, revisão por regras, renderização e evolução para composição autoral. [E03] [E04] [E12]

### 10.2. Agentes como implementação, não espetáculo

Estratégia, redação, direção de arte, ilustração, design, crítica e correção podem ser etapas ou chamadas separadas quando avaliações justificarem.

Mais agentes não equivalem a melhor resultado. Consolidar tarefas simples, limitar tentativas e usar código para verificações objetivas. A UI mostra trabalho compreensível, não precisa exibir um teatro de agentes.

### 10.3. Níveis de produção: preservar a história sem congelar configuração obsoleta

A SPEC 030 descreve várias revisões: primeiro Instantâneo/Padrão/Refinado/Autoral/Pro; depois três níveis (Rápido, Refinado e Autoral) e mudanças na quantidade de rascunhos/opções.

A descrição de F4 voltou a alterar a quantidade de rascunhos. **Antes de implementar ou precificar, conferir a configuração realmente vigente.** Não tomar a primeira tabela da spec como contrato final. [E12] Na `staging` de 03/11, `platform/src/lib/studio/levels.ts` tem `instantaneo` (na tela, Rápido), `refinado` e `autoral`, e a PR #314 voltou o Autoral a um rascunho só.

Direção mantida: cada nível deve entregar diferença perceptível de qualidade/variação, não apenas usar modelo mais caro.

### 10.4. Dados de experimento mencionados

A spec relatou uma rodada de 12 pedidos/3 marcas em que o estúdio venceu os duelos do avaliador, com design 8,4 versus 5,8, originalidade 8,2 versus 3,0 e "postaria sem editar" de 10/12 versus 8/12.

Também relatou experimentos de custo/modelo, com valores aproximados entre US$ 0,002 no motor simples e cerca de US$ 0,56 no modo mais caro daquela rodada; havia limites e fallback. São **relatos de experimentos pequenos do repositório**, não benchmarks independentes, preços atuais dos provedores ou garantia de produção. [E12]

A própria spec reconhece risco de juiz da mesma família de modelos e necessidade de avaliação humana. Não converter esses números em promessa de vendas, preferência de audiência ou acurácia geral.

### 10.5. Contratos de produção

Saídas estruturadas, parser, tentativas limitadas, fatos válidos e rastreio por etapa. O modelo não decide permissão, tenant ou preço de cobrança.

HTML gerado exige sanitização e ambiente de render isolado. Medições devem verificar corte, sobreposição, legibilidade, contraste e presença/uso de marca, com limitações reconhecidas.

Corrigir defeito medido antes de levar à aprovação quando possível. Não gastar indefinidamente para subir uma nota subjetiva.

### 10.6. Imagens, fotos e identidade

Usar mídia real quando agrega prova e autenticidade; confirmar autorização. Um arquivo autorizado na criação pode deixar de estar autorizado antes da publicação.

A SPEC 030 descreveu restrições de imagem de IA, como evitar rostos reconhecíveis, crianças e logo/texto dentro da imagem gerada. Essas eram regras de produto daquele experimento; registrar a política vigente por uso, sem confundir restrição interna com capacidade universal do provedor.

Variações de logo, fundo claro/escuro e símbolo devem ser tratadas como ativos, não recriados livremente pelo modelo.

### 10.7. Ajuste depois da geração

Guardar versão, instrução de ajuste, diferenças e resultado. Ajuste cirúrgico não deve destruir fatos/qualidade que já estavam corretos.

Editor livre e post autoral podem ter caminhos distintos; a spec restringia editor livre e carrossel autoral em determinada fase. Carrossel multiplica esforço/custo; vídeo e Reels exigem escopo próprio.

### 10.8. Execução longa

Estado durável e aviso quando pronto; o usuário pode sair da página sem perder o trabalho. Não adotar tempos experimentais como SLA. Medir custo e tempo do ambiente real.

Fallback para nível diferente precisa ser comunicado. Não cobrar uma entrega premium que não ocorreu.


---

<a id="aprendizado"></a>
## 11. Aprendizado contínuo: usar cada trabalho sem confundir sinais

### 11.1. Intenção do fundador

Quanto mais a Ekoai trabalha para a marca, mais adequada deve se tornar a geração de imagem, legenda, texto, conceito e campanha.

O gasto em uma geração deve produzir também informação útil, quando autorizado. Isso não significa que o modelo se treina sozinho ou que toda saída vira dado de treinamento de qualidade.

### 11.2. Três ciclos

| Ciclo | Evidência | Mudança possível |
|---|---|---|
| Preferência da marca | Aprovação, rejeição, edição e motivo. | Voz, seleção de referência, estilo e restrição. |
| Qualidade de produção | Defeitos, correções, verificações e revisão. | Prompt, template, renderer, escolha de etapa/modelo. |
| Resposta do público/negócio | Sinais disponíveis e eventos identificados. | Tema, sequência, formato e próxima hipótese. |

Uma peça pode ser tecnicamente ótima e comercialmente inconclusiva. Uma peça com bom sinal pode conter uma promessa indevida; desempenho não neutraliza o erro.

### 11.3. Feedback com pouco esforço

Capturar aprovação, edição, descarte, pedido de outra direção e tempo de revisão. Pedir nota/comparação somente quando isso responde uma dúvida relevante.

Exemplos: "preferiu pela mensagem ou pelo visual?"; "essa correção vale só para esta peça ou para a marca?". Não transformar o cliente em anotador obrigatório de dataset.

### 11.4. Dados de cada execução

Contexto/versão, objetivo, hipótese, atributos, modelos, prompts, custo de tentativas, rascunhos relevantes, versão aprovada, publicação, sinal posterior e limitações de atribuição.

Registrar o que não foi publicado para aprender preferência/custo. Não atribuir desempenho de audiência a essas peças.

### 11.5. Progressão técnica

**Estágio 1 (contexto e memória):** aplicar preferências confirmadas e recuperar exemplos adequados.

**Estágio 2 (seleção):** ordenar ideias/candidatos com restrições e evidência da própria conta.

**Estágio 3 (modelos especializados):** avaliar ranking, ajuste fino ou outras técnicas apenas com volume, qualidade, autorização e ganho comprovado fora da amostra.

Não reativar bandit legado sem entender dados, objetivo e compatibilidade. Não treinar a partir de toda nota produzida por outro modelo como se fosse verdade humana.

### 11.6. Cada post é observação; nem todo post é experimento

Horário, distribuição, público, oferta e contexto variam. Resultado melhor não prova isoladamente que a cor ou o título causou a melhora.

Registrar hipótese antes, atributo alterado, janela de observação e fatores de confusão. Com pouco volume, admitir "inconclusivo". Não criar falso A/B orgânico quando não existe randomização/exposição comparável.

### 11.7. Avaliadores automáticos

Usar regras para defeitos objetivos, modelo para aspectos qualitativos e humanos para calibrar e resolver divergências. Avaliar resultado final, não só diálogo entre agentes. [T12]

Separar casos de treino/ajuste e teste; usar avaliação temporal quando o objetivo for aprender com histórico. Verificar deriva de marca e viés de notas do mesmo modelo/família.

### 11.8. Limite de custo e valor da próxima tentativa

Uma nova chamada deve ter objetivo: corrigir um defeito ou testar uma alternativa com valor esperado. Limitar rodadas, custo e alterações.

Não gerar dez peças caras apenas para escolher uma quando dez ideias curtas permitiriam selecionar melhor antes.

### 11.9. Esquecimento, escopo e aprovação

Aprendizado por campanha, marca e usuário pode ser diferente. Uma campanha comemorativa não altera permanentemente a identidade; uma edição privada não vira regra para todos os clientes.

Permitir revisão/revogação de regra. Manter evidência de por que foi criada.


---

<a id="radar"></a>
## 12. Radar de oportunidades, pesquisa atualizada e notícias

### 12.1. Dúvida do usuário preservada

Matheus questionou depender de notícias genéricas e sugeriu modelo barato capaz de pesquisar assuntos do nicho, por exemplo confeitaria, bolos, farinha, glúten e fitness.

A conclusão foi: **um LLM barato pode organizar pesquisas e interpretar resultados, desde que tenha ferramenta de busca real ou fontes consultadas**. Memória do modelo, sozinha, não comprova notícia recente.

### 12.2. Arquitetura proposta

Contexto da marca → mapa de assuntos/perguntas → consultas → busca/fontes → verificação → relevância → oportunidade editorial → board/campanha.

Registrar URL, data da consulta, data da publicação e data do acontecimento. Agrupar duplicatas e separar notícia nova de republicação.

### 12.3. Fontes complementares

Grounding with Google Search foi uma opção pesquisada, sujeito a modelos compatíveis, custos e requisitos de exibição. [T08]

GDELT pode ajudar na descoberta; RSS e fontes setoriais/institucionais podem ser melhores para determinados nichos. NewsAPI é alternativa comercial, mas o plano gratuito de desenvolvimento citado não autorizava produção. [T10] [T11]

Não é necessário contratar todas as fontes. Começar com poucas fontes úteis e busca sob demanda/orçamento.

### 12.4. Pesquisa mais inteligente que "notícias sobre bolo"

Construir grupos: ocasiões de compra, dúvidas recorrentes, sazonalidade, ingredientes, apresentação, eventos, mudanças confirmadas e assuntos ligados à oferta real.

Perguntar: isso interessa ao público desta marca? Existe relação com o serviço? Há prova? A marca tem algo útil a acrescentar? A oportunidade tem prazo? Precisa de material?

Notícia sobre custo de farinha pode interessar à operação e não ao comprador final. Uma dúvida sobre tamanho do bolo pode servir melhor à comunicação.

Assuntos de saúde/nutrição exigem fontes e cuidado editorial; não transformar tendência em alegação de benefício de um produto sem confirmação apropriada.

### 12.5. Sinais internos são tão importantes quanto notícias

Produto lançado, projeto entregue, disponibilidade, perguntas de clientes, material novo e resultado de campanha podem gerar pautas melhores.

Uma função que só reage à internet tende a afastar a comunicação da realidade da empresa. A Ekoai deve saber quando não usar uma notícia.

### 12.6. Oportunidade entregue

Em vez de "quer um post sobre isto?", apresentar motivo, fonte, ângulo, conceito, relação comercial, risco e informação faltante.

Oportunidade é candidata a ação; não publicação automática. A plataforma pode propor campanha, peça educativa ou simplesmente registrar que o assunto não vale ser explorado.

### 12.7. Custo e confiabilidade

Cache de pesquisa quando permitido, deduplicação, orçamento por marca/período, prioridade por relevância e alertas de fonte desatualizada. Modelo simples filtra/organiza; verificação deve continuar suficiente para o risco.

API aberta, código aberto e direito de republicar reportagem são coisas diferentes. Produzir conteúdo próprio fundamentado, sem copiar artigo ou imagem sem direito de uso.

### 12.8. Aceite

Fonte acessível e coerente, atualidade demonstrada, relevância explicada, autoria/limites respeitados, nenhuma notícia inventada, ausência de dado marcada, gasto delimitado. Se o provedor falhar, não preencher a lacuna com uma "notícia provável".


---

<a id="materiais"></a>
## 13. Coleta proativa de material e memória criativa

### 13.1. O sistema deve buscar a evidência que falta

Uma campanha pode precisar de foto, demonstração, caso, resposta ou depoimento. A Ekoai identifica a lacuna e faz um pedido pequeno e específico.

Exemplos propostos: gravar um trecho do processo; enviar duas fotos autorizadas da entrega; confirmar uma condição da oferta. Explicar por que o material importa.

Não pedir um banco de imagens inteiro antes de começar. Não transformar a rotina em tarefas diárias ilimitadas para o empresário.

### 13.2. Ciclo

Oportunidade → material necessário → solicitação → recebimento/triagem → confirmação de uso → produção → campanha → aprendizado.

O pedido fica associado ao trabalho. Arquivo enviado não desaparece em uma pasta sem contexto.

### 13.3. Prova autêntica

Material real pode demonstrar produto, processo e resultado documentado. A IA pode organizar e adaptar, mas não deve inventar depoimento, cliente, obra executada ou imagem que se apresente como fotografia real daquele negócio.

Conteúdo gerado e conteúdo documental têm papéis diferentes. A peça deve respeitar a expectativa do público.

### 13.4. Memória criativa utilizável

Classificar referências autorizadas por composição, hierarquia, contraste, densidade, tipo de gancho, tom, prova e relação texto/imagem.

Preservar o motivo de preferência: "gostamos da clareza" não equivale a "copie a identidade dessa marca".

A memória de territórios e títulos recentes existente é base útil, não precisa ser descartada. [E05]

### 13.5. Reaproveitamento

Um mesmo material autorizado pode originar vários formatos, respeitando contexto, direitos e relevância. Não repetir a mesma mensagem indefinidamente nem alterar o sentido de fala/depoimento.

Regra de edição precisa preservar fatos e permitir rastrear a origem.

### 13.6. Aceite

Solicitação objetiva, material no tenant correto, autorização registrada, revogação aplicada, vínculo com campanha e menos esforço do que o fluxo anterior.


---

<a id="publicacao"></a>
## 14. Publicação confiável, preflight e coordenação dos canais

### 14.1. Base observada

`publish.ts` já contém tentativa com lease, status, container Meta persistido e reconciliação. O cron tenta tratar publicação presa antes de novos trabalhos. Ensaio é separado do histórico real. [E09] [E10]

É uma fundação valiosa. Não reescrever o sistema para adicionar autonomia sem preservar esses controles.

### 14.2. Gate imediatamente antes do efeito externo

Verificar conta, permissão, canal, pausa, aprovação/versão, oferta, fatos vigentes, mídia autorizada, campanha e teto de execução.

Se o fato mudou depois de gerar/aprovar, o conteúdo pode precisar de nova revisão. Se a reconciliação descobre container pronto e decide publicar, o mesmo gate deve ser aplicado.

### 14.3. Resultado incerto

Timeout não prova que falhou. Consultar o estado quando possível. Onde a rede não oferece verificação suficiente, escalar a exceção em vez de publicar novamente às cegas.

O código lido diferenciava a capacidade de reconciliação do Instagram da incerteza em outros canais. Não prometer comportamento idêntico sem suporte da API. [E09]

### 14.4. Campanha pausada e publicação em trânsito

Definir explicitamente o que ainda pode ser cancelado e o que já ocorreu. Não esconder publicação confirmada quando a gravação de histórico falha; reparar a associação sem duplicar o post.

Pausa da conta é freio operacional. Ao retomar, revisar fatos e datas para não publicar automaticamente promoção vencida.

### 14.5. Instagram, LinkedIn e X

Instagram é o foco inicial discutido; demais canais são expansão condicionada. Código existente não é prova de capacidade pública habilitada.

Confirmar formatos, permissões, rate limits, aprovação do app, revogação e métricas disponíveis por canal. A mesma ideia pode ter núcleo comum, mas precisa de adaptação, não cópia cega da legenda.

Vídeo, Reels, Stories e anúncios têm escopo/custo/consentimento próprios. Não incluir tudo no primeiro ciclo.

### 14.6. Aceite

Nenhum envio sem mandato vigente; fatos/mídia revalidados; retry seguro; estado externo reconhecido; ensaio não contamina analytics; cada rede declara capacidade; falha visível com próxima ação.


---

<a id="mensuracao"></a>
## 15. Métricas, atribuição e aprendizado de negócio

### 15.1. O que não fazer

Não chamar curtida de lead, clique de cliente ou venda posterior de resultado causado automaticamente pela campanha.

Não substituir métrica ausente por zero. A camada de analytics já reconhece estados de pouca informação e permissão; preservar isso. [E08]

### 15.2. Camadas de sinais

| Camada | Exemplo | Interpretação |
|---|---|---|
| Produção | Ideia escolhida, aprovação, edição. | Adequação percebida e esforço. |
| Rede | Alcance, comentário, salvamento quando disponíveis. | Resposta da plataforma/público, não receita. |
| Propriedade da empresa | Formulário, link identificado, pedido registrado. | Intenção/ação com grau de associação. |
| Comercial | Conversa qualificada, orçamento, venda confirmada. | Resultado de negócio com origem qualificada. |

### 15.3. Qualidade de atribuição

Marcar origem como observada diretamente, declarada, associação agregada ou desconhecida. Cada classe tem limitação.

UTM pode ajudar, mas não torna visualização sem clique rastreável nem determina qual post originou toda visita ao link da bio.

Aceitar registro manual simples no piloto. CRM e canal são integrações futuras conforme uso, não pré-requisito para toda validação.

### 15.4. Relatório que muda a decisão

Registrar hipótese, execução, sinais, limitações e mudança proposta.

Exemplo ilustrativo: conteúdo de processo gerou mais salvamentos; casos reais tiveram mais solicitações identificadas; amostra pequena; próximo ciclo testa novas versões sem declarar superioridade universal.

O produto entrega uma decisão, não apenas narrativa sobre um gráfico.

### 15.5. Instrumentação

IDs consistentes entre campanha, brief, versão, publicação e evento. Deduplicar eventos e preservar origem. Alteração de atribuição não deve reescrever silenciosamente o histórico.

Compartilhar somente o mínimo necessário, sem enviar dados pessoais de clientes para contexto de modelo por padrão.

### 15.6. Métricas centrais

Minutos humanos por marca/campanha, aprovação com/sem ajuste relevante, confiabilidade de publicação, custo por entrega aproveitada, aprendizado aplicado e sinais compatíveis com o objetivo.

Retenção e renovação continuam importantes. Muito conteúdo gerado com pouco uso ou valor não comprova sucesso.


---

<a id="agencias"></a>
## 16. Modo agência, times e operação gerenciada

### 16.1. Duas relações comerciais

A Ekoai pode atender diretamente uma marca ou fornecer capacidade operacional a uma agência. Não assumir que todos querem o mesmo grau de delegação ou que a agência será substituída.

Validar primeiro um segmento e manter o modelo capaz de suportar os dois sem misturar permissões.

### 16.2. Supervisão de carteira por exceção

A agência vê marca sem contexto, material faltante, cliente que não aprovou, campanha bloqueada, canal com problema e sinal que exige decisão.

Isso reduz tempo de procurar informação em várias contas. Não é apenas um seletor de perfis sociais.

### 16.3. Fronteiras

Separar organização pagante, marca, membro da agência e aprovador do cliente. O cliente final vê apenas o recorte autorizado da própria marca.

Conexão social e fatos pertencem à marca/conta correspondente. Revogação e transferência de gestão precisam de fluxo explícito.

### 16.4. Serviço gerenciado

Pode existir pacote com revisão humana especializada, mas isso é decisão comercial separada. Definir entregáveis, revisões, exceções, responsabilidade e custo.

Não prometer uma agência ilimitada se cada cliente exige estratégia artesanal e suporte contínuo. Medir tempo por marca, não esconder a operação no fundador.

### 16.5. Valor para a agência

Mais marcas operadas com qualidade mantida e menos coordenação repetitiva. A métrica não é apenas perfis conectados; é esforço por marca, prazo, retrabalho e valor percebido.

### 16.6. Aceite

Isolamento, aprovação correta, faturamento coerente, handoff entre agência/cliente, contexto da marca preservado e carteira que realmente reduz intervenção desnecessária.


---

<a id="apostas"></a>
## 17. Apostas novas de produto e diferenciação

As ideias abaixo foram construídas na evolução da conversa. São hipóteses, não afirmações de ineditismo mundial ou decisões já implementadas.

### 17.1. Inteligência de objeções

Com autorização, aproveitar perguntas recebidas pela empresa para descobrir o que impede a decisão de compra.

A Ekoai pode propor conteúdo e pedir prova/material para responder a essas dúvidas. Depois observa se o material foi utilizado ou ajudou nas conversas, sem atribuir causalidade automaticamente.

Primeiro piloto pode usar perguntas registradas manualmente, antes de integrar caixa de mensagens inteira.

### 17.2. Comunicação compatível com capacidade

Empresa com agenda cheia precisa de comunicação diferente de empresa com horários disponíveis. A plataforma prepara opções: relacionamento, lista de espera, serviço alternativo ou aquisição.

Começar com confirmação simples da capacidade. Integração com estoque/agenda pode vir depois. Não inventar escassez nem reduzir campanhas com base em dado não confirmado.

### 17.3. Board que entrega conceitos, não pautas avulsas

O board é também uma aposta comercial: permitir que o cliente delegue a direção criativa e avalie um conceito antes de gastar com produção.

Validar se melhora adequação, reduz tentativas e deixa a marca mais consistente. Não medir sucesso só pelo número de cards.

### 17.4. Produtor que solicita material

A plataforma toma iniciativa para pedir a pequena evidência que viabiliza uma boa comunicação. Isso pode diferenciar de geradores baseados somente em imagem sintética e tema genérico.

Validar taxa de resposta ao pedido, esforço do usuário e qualidade final.

### 17.5. Memória criativa que explica suas decisões

Mostrar por que adotou determinado estilo e quais preferências/experimentos sustentam a escolha. Usuário corrige a regra, não precisa repetir o mesmo feedback em cada peça.

### 17.6. Expansões condicionadas

Conteúdo de site e descoberta por IA, distribuição em novos canais, mídia paga com limites, conectores comerciais e interfaces para agentes externos.

Não empilhar essas expansões antes de comprovar o ciclo de comunicação no canal inicial. AirOps, mLabs e Buffer são referências de padrões, não instrução de competir em toda sua superfície agora.


---

<a id="integracao-parceiro"></a>
## 18. Indicação vinda de produto parceiro, sem acoplamento indevido

### 18.1. Primeira versão definida pela conversa

Outro produto da BEZ pode mostrar, depois de uma entrega relevante, uma indicação contextual com o botão "Conhecer a Ekoai". A tela e a regra de quando mostrar ficam no repositório daquele produto.

Do lado da Ekoai: registrar a origem do cadastro de modo apropriado (UTM ou código de indicação). Nenhum dado do cliente, contrato, foto ou contato chega automaticamente.

### 18.2. Empresa da BEZ como cliente da Ekoai

Uma empresa da própria BEZ pode usar a Ekoai na sua comunicação, como qualquer conta. Isso oferece um laboratório de marca, campanhas e sinais do funil dela.

A marca não entra no código genérico ([ADR 0010](../adr/0010-plataforma-generica-sem-pilar-no-codigo.md)).

### 18.3. Distinção indispensável

O funil comercial de quem vende um software não é o banco de clientes de quem usa esse software.

Os produtos serem da mesma holding não dispensa consentimento, finalidade, permissões ou isolamento.

### 18.4. Integração futura preservada como hipótese

Uma entrega no produto parceiro poderia gerar um pacote publicável com resumo e mídias autorizadas. Exige ação explícita, seleção, revisão de confidencialidade e associação à conta correta.

O ciclo "trabalho entregue, prova autorizada, comunicação, oportunidade" é uma visão futura. A decisão recente foi começar pela indicação, não implementar todo o circuito agora.

### 18.5. Critério comercial

Medir interesse e ativação provenientes da indicação sem tornar o software invasivo. Não usar publicidade para interromper tarefa crítica nem apresentar o produto como obrigatório.


---

<a id="arquitetura"></a>
## 19. Arquitetura de operação: conhecimento, planos e execução

### 19.1. Base observada

Plataforma Next.js, workers/jobs, Postgres por conta e infraestrutura Cloud Run documentada. Reutilizar banco, tenant scope, geração, publicador e observabilidade existentes. [E01] [E02]

Não exigir migração geral, framework de agentes novo ou modelo próprio para começar a evolução.

### 19.2. Camadas

| Camada | Dados/trabalho |
|---|---|
| Contexto de marca | Perfil, fatos, validade, regras, mídias e permissões. |
| Inteligência | Oportunidades, hipóteses, direções e critérios de escolha. |
| Plano | Campanha, sequência, materiais e autorizações. |
| Produção | Texto, imagem, design, revisão e versões. |
| Execução | Agendamento, canal, preflight, tentativa e recibo. |
| Aprendizado | Escolha/edição, qualidade, sinais e próxima decisão. |

### 19.3. Unidade de trabalho

Uma campanha/rotina possui estado, responsável, fontes, versão de política, orçamento de execução e critérios de conclusão. Uma peça pode conter várias tentativas e versões.

Mapear para `campaigns`, `briefs`, `generation_runs`, pendências, agendados e eventos existentes antes de criar tabelas paralelas.

### 19.4. Autorizações

Aprovação referencia versão de conteúdo, mídia, oferta e destino. Mandato recorrente define classe de ações, limites e revogação.

Antes de executar, reler condição material. O payload não pode mudar depois da aprovação sem regra explícita.

### 19.5. Fila e estado persistente

Reservar tarefa, checkpoint por etapa, lease, deduplicação e custo acumulado. Retry reaproveita o que já foi concluído quando seguro.

Externalização não deve depender da memória de uma única chamada de modelo. Na falha, o sistema sabe o que tentou, o que ocorreu e o que precisa conferir.

### 19.6. Modelos por tarefa

Regras/código para cálculos e restrições; modelos menores para tarefas que passam nas avaliações; modelos mais capazes para etapas que justificam diferença de qualidade.

Manter versão de modelo/prompt e comparação com baseline. Troca de modelo exige eval, não apenas alterar variável de ambiente porque surgiu novidade.

### 19.7. Compartilhamento na BEZ

Reutilizar autenticação/cobrança/telemetria e contratos operacionais quando adequado, sem misturar tenants, identidades privilegiadas e dados de produtos.

APIs para outros agentes são canal futuro. Devem executar as mesmas operações autorizadas, nunca ignorar políticas por virem de MCP.

### 19.8. Dados não são instruções

Site, documento, legenda, notícia e referência podem conter conteúdo adversarial. O contexto importado não pode acionar ferramentas fora do fluxo, ler outro tenant ou definir novos destinatários.

Fontes precisam ser rastreáveis e filtradas por permissão antes de chegar ao modelo.


---

<a id="conectores"></a>
## 20. Lições de engenharia: conectores, crawlers e agentes

### 20.1. Criar conector é diferente de rodar conector

Agentes podem ajudar a construir, testar e reparar conectores de leitura (site da marca, fontes, parser). A execução recorrente fica numa rotina testada, delimitada e observável, fora do agente.

### 20.2. Onde usar

Leitura de sites de marca, pesquisa em fontes autorizadas, descoberta de conteúdo, atualização de referências e diagnóstico de falha de parser.

Não colocar navegador autônomo genérico em toda etapa de geração. Não assumir que conta conectada ao Instagram autoriza leitura irrestrita de terceiros.

### 20.3. Contexto, memória e modelos

Biblioteca de memória e seleção de modelo por tarefa são evolução a avaliar por qualidade e custo, não tecnologia comprovada. Reutilizar conhecimento sem tratar demonstração como garantia.

### 20.4. Padrões de dados

Bruto preservado e identificado por hash, normalizado separado, incrementalidade, configuração por fonte, falhas por categoria e concorrência delimitada.

Para a Ekoai: saber que página gerou um fato, quando mudou e qual versão foi aprovada. Reprocessar a fonte não autoriza substituir a afirmação vigente sem revisão apropriada.

### 20.5. Limites

Bloqueio ou CAPTCHA é condição operacional a tratar por acesso permitido, alternativa ou intervenção humana. Evasão de bloqueio e uso de contas de terceiros não são requisitos do produto.

Os documentos do produto registram princípios, não credenciais nem detalhes operacionais privados.

### 20.6. Central de atenção

Sumarizar impacto e reduzir troca de contexto: o usuário vê as campanhas que precisam de decisão, não cada log ou microchamada do pipeline.

Autonomia que gera dezenas de notificações novas pode aumentar o trabalho em vez de reduzi-lo.


---

<a id="seguranca"></a>
## 21. Segurança, qualidade, autonomia e governança

### 21.1. Progressão de autonomia

Observar → preparar → executar ação aprovada → executar rotina expressamente autorizada → escalar exceções.

Autorizar rotina não significa remover supervisão. O usuário define limites e pode pausar. Não elevar autonomia apenas porque algumas peças foram aprovadas sem edição.

### 21.2. Ações com riscos diferentes

Rascunhar ideia é diferente de publicar, alterar oferta, criar anúncio pago ou prometer resultado. Cada ação precisa de política.

Direção de campanha pode ser aprovada em bloco; fatos sensíveis, nova oferta, imagem problemática ou gasto fora do escopo exigem revisão específica.

### 21.3. Fronteiras de dados

RLS/tenant scope, permissões por rota e marca, credenciais protegidas, links temporários e minimização de PII. Um membro de agência só acessa as marcas autorizadas.

Fatos confirmados, hipóteses e preferências têm estados diferentes. O modelo não pode promover uma extração a verdade ou uma hipótese a autorização.

### 21.4. Fontes e renderização

Leitura de URL com prevenção de SSRF e limites; conteúdo externo tratado como dado. HTML gerado sanitizado e renderizado em ambiente isolado, com recursos/rede limitados.

Não buscar ativos em endereços arbitrários por instrução do modelo. Não permitir que renderização de peça se torne execução livre de código.

### 21.5. Conteúdo e mídia

Controlar direitos, marca, ofertas, claims e validade. Conteúdo sobre temas sensíveis exige fontes e limites compatíveis. Não fabricar resultado de cliente, depoimento ou endosso.

Imagens reais com autorização revogada deixam de ser elegíveis para novas ações. A remoção de algo já publicado exige fluxo explícito e suporte do canal; não prometer apagar todo rastro da internet.

### 21.6. Avaliações e rollout

Conjunto versionado de casos: fato vencido; campanha pausada; logo ausente; referência conflitante; texto cortado; imagem sem direito; dado de outra marca; site malicioso; publicação incerta; modelo indisponível; falta de métrica; rejeição de token.

Testar qualidade, custo, retomada e permissão. Erro crítico bloqueia expansão mesmo com boa média estética.

### 21.7. Falha honesta

Mostrar o que foi concluído, o que não foi e o próximo passo. Não publicar versão de fallback como se fosse a premium solicitada. Não chamar uma consulta sem fontes de notícia pesquisada.

### 21.8. Critérios transversais propostos

Toda ação externa testada tem autorização e evidência; nenhum vazamento nos testes de isolamento; fontes usadas são elegíveis; falha parcial retomável; dados desconhecidos permanecem desconhecidos.

Metas de qualidade e latência são definidas com baseline. Não usar "zero erro no teste" como promessa de risco zero em produção.


---

<a id="economia"></a>
## 22. Modelo comercial, cobrança e economia da operação

### 22.1. Estrutura proposta

Manter assinatura como base. Considerar pacotes por marca/conta, capacidade de produção e campanha executada. Serviço gerenciado com revisão humana, se existir, precisa de escopo separado.

Não vender quantidade de robôs como unidade de valor. O cliente quer sua comunicação operando com qualidade e pouco esforço.

### 22.2. Decisões de cobrança já discutidas

A SPEC 030 registrou preço fora do fluxo de criação, consumo em Fatura e uso, cobrança associada à aprovação, primeiro ajuste incluído e fallback compatível com a entrega. Também continha revisões/perguntas abertas. [E12]

Preservar o que estiver vigente nos repositórios, conciliando SPECs 021/031/032 antes de mudar o modelo. Esta documentação não escolhe o preço por tipo de post nem decreta que todas as versões históricas da spec são finais.

### 22.3. Alertas e limites

Distinguir aviso de gasto, limite contratado e teto técnico interno. A spec antiga descreveu alerta que apenas informa; mudar para hard cap é decisão explícita, não alteração silenciosa.

Um mandato de campanha precisa ter limite compreensível. Ausência de preço em cada clique não deve significar consumo sem previsibilidade.

### 22.4. Custo completo

`custo da entrega = todas as gerações + peças descartadas + ajustes + renderização + armazenamento/tráfego + pesquisa/conectores + revisão humana + suporte variável`

Custo por peça aprovada é diferente de custo por tentativa. Cobrar só a aprovação não elimina o custo de rejeições. O tempo do fundador também entra.

Medir por nível, formato, marca e campanha. Carrossel/vídeo podem exigir unidade econômica diferente de imagem única.

### 22.5. Resultado versus unidade de trabalho

No início, não cobrar exclusivamente por venda atribuída: atribuição e controle do resultado são incompletos. Pode haver modelo híbrido de assinatura/capacidade/entrega antes de resultado financeiro.

A simulação geral da conversa, 20 clientes a R$ 1.500 = R$ 30 mil mensais, foi apenas exemplo econômico. Não é preço aprovado da Ekoai nem projeção de aquisição.

### 22.6. Risco de virar agência artesanal

Evitar personalização ilimitada por cliente, revisões sem limite e operação invisível. O ganho deve vir de repetir metodologia com contexto diferente, não recriar manualmente toda campanha.

Pilotos precisam demonstrar renovação, repetibilidade e custo decrescente/adequado por entrega antes de ampliar autonomia.


---

<a id="benchmark"></a>
## 23. Concorrentes e padrões a incorporar

### 23.1. Limite do benchmark

As análises anteriores se basearam em fontes públicas e documentação. Não houve acesso a código proprietário ou validação independente de resultados. Participar de YC ou captar investimento não comprova adequação ao Brasil.

### 23.2. Referências principais

| Empresa/referência | Padrão | Aplicação proposta | Cuidado |
|---|---|---|---|
| Native/Norn | Seleção de ideias anterior à produção e aprendizado. | Hipóteses e ranking explicável. | API/condições precisam de revalidação; não presumir acesso. [W10] [W11] [B12] |
| Native onboarding | Entrada por site e leitura da marca. | Pouco preenchimento e contexto inicial. | A decisão da Ekoai é não gerar post imediato. [B11] |
| Jasper/Jasper IQ | Contexto, voz, marca e agentes. | Conhecimento como infraestrutura do trabalho. | Não replicar toda plataforma enterprise de uma vez. [W12] [W13] |
| AirOps | Pesquisa, produção, publicação e atualização. | Ciclo fechado e governança. | Seu foco em conteúdo/descoberta não muda o canal inicial da Ekoai. [W14] |
| mLabs | IA e operação por assistentes. | Canal de integração e supervisão. | Chat e agendamento não bastam como diferencial. [W15] |
| Buffer | API/MCP para operações. | Serviço acessível por outros assistentes no futuro. | Mesmas permissões e controles. [W16] |
| Meta/Instagram | APIs, permissões e formatos. | Limites reais da execução e leitura. | Revalidar capacidade e acesso por conta. [W17] |

### 23.3. O que a análise do próprio repositório já pesquisou

PR #333 registra estudo do Native, com limitações de acesso a recursos pagos. Não reapresentar a conclusão como engenharia reversa de todo o backend nem como teste independente do Designer/ads. [E16]

### 23.4. Roteiro de comparação

Comparar o mesmo caso de marca autorizado: tempo para compreender, perguntas exigidas, qualidade das fontes, clareza do conceito, retrabalho, identidade, publicação, aprendizado e custo.

Examinar o que o fornecedor faz quando falta logo, a oferta vence, o cliente rejeita a direção ou a API falha. A demonstração feliz não descreve toda a operação.

### 23.5. Hipótese de diferenciação

Não apenas geração rápida, mas **decisão criativa + prova real + execução confiável + memória da marca + aprendizagem aplicada à próxima campanha**.

Essa combinação é o posicionamento a validar, não reivindicação de que nenhum concorrente oferece partes semelhantes.


---

<a id="roadmap"></a>
## 24. Cronograma de implementação e gates

### 24.1. Premissas

T0 = aprovação do plano. As janelas são estimativas para uma frente dedicada, com referência de um engenheiro full-stack responsável e apoio pontual de design/marketing/avaliação.

O roadmap de 20 semanas visa ciclos completos e pilotos selecionados, não autonomia universal, todos os canais ou todos os nichos. Aprovação da Meta, acesso a dados e esforço de suporte podem mudar o caminho crítico.

Se o mesmo desenvolvedor atende outros produtos da BEZ, essas semanas não são agendas paralelas garantidas.

### 24.2. Ondas propostas

| Onda | Janela | Entrega | Gate |
|---|---|---|---|
| 0: estado real e proteção | S1 a S2 | Inventário, baseline, custo, preflight e reconciliação verificados. | Não aumentar autonomia com fatos/mídia sem revalidação. |
| 1: marca compreendida | S3 a S4 | Concluir onboarding em andamento, progresso real e revisão; Instagram quando liberado. | Sem post obrigatório; falhas parciais e direitos tratados. |
| 2: direção antes da peça | S5 a S7 | Board criativo, hipóteses e seleção antes do design. | Motivo/fonte/objetivo; custo delimitado. |
| 3: campanha operada | S8 a S11 | Plano, materiais, produção, execução e exceções num ciclo. | Uma campanha completa com estado e evidência. |
| 4: aprender com o uso | S12 a S15 | Edição/feedback, memórias separadas, sinais comerciais mínimos e próxima decisão. | Sem rótulos falsos ou atribuição inventada. |
| 5: proatividade e carteira | S16 a S20 | Radar de oportunidades, pedidos de material e piloto de supervisão de marcas. | Relevância, economia e redução real de esforço. |
| Posterior | Após gates | Mais canais, agência ampliada, modelos específicos, mídia paga ou APIs externas. | Retenção, segurança, dados e unidade econômica. |

A PR já pronta não precisa ser reimplementada na semana "planejada". A onda indica validar/concluir o fluxo e medir o uso, não congelar o desenvolvimento existente.

### 24.3. Dependências decisivas

Board depende de contexto mínimo, não de brand book perfeito. Pesquisa depende de fontes/budget, não de uma API universal de notícias. Aprendizado depende de eventos consistentes, não de fine-tuning.

A campanha pode começar com registro manual de resultado. Integração completa de CRM não precisa bloquear. Modo agência avançado depende de isolamento e operação por marca.

### 24.4. Três demonstrações

**D1 (marca compreendida):** site/material e conexão opcional viram contexto confirmado, sem post no cadastro.

**D2 (direção à campanha):** o sistema propõe conceito, pede o material necessário, produz e acompanha publicação autorizada.

**D3 (aprendizado que altera a próxima ação):** edição e sinais são registrados; a Ekoai mostra o que mudou em sua recomendação e o que continua incerto.

### 24.5. Gates de expansão

G0: capacidade e custo conhecidos. G1: fontes/permissões seguras. G2: qualidade editorial/visual. G3: execução confiável. G4: uso/renovação e esforço humano adequado. G5: repetibilidade em mais de uma marca.

Expandir autonomia só quando a rotina passar pelos gates, com pausa e responsável por exceção.

### 24.6. Carteira com capacidade compartilhada

Concluir fundações próximas do estado atual, alternar blocos de foco entre os produtos e manter limite de trabalho em andamento. Não iniciar simultaneamente onboarding, 3D, procurement, ranking, WhatsApp e agência com a mesma pessoa.

A reestimativa deve usar velocidade observada e carga de suporte. Não há evidência suficiente na conversa para assumir equipe ou orçamento maiores que os informados.


---

<a id="backlog"></a>
## 25. Backlog consolidado e rastreabilidade

`EKO-*` são identificadores desta documentação, não cards criados. Natureza e prioridade são propostas; reconciliar com specs/PRs antes de abrir trabalho novo.

| ID | Prioridade | Iniciativa | Natureza | Dependência | Critério de saída |
|---|---|---|---|---|---|
| EKO-01 | P0 | Inventário de capacidades, flags e evidência | Completar | Repos/deploy | Código/spec/produção distinguidos. |
| EKO-02 | P0 | Preflight de fatos/campanha/mídia | Completar | Publicador | Revalidação em todos os caminhos de envio. |
| EKO-03 | P0 | Aprovação versionada e mandato | Estender | EKO-01 a 02 | Payload e limite explícitos. |
| EKO-04 | P0 | Custo completo e minutos humanos | Estender | Runs/eventos | Tentativas/revisão incluídas. |
| EKO-05 | P1 | Onboarding por leitura/revisão | Concluir | SPEC 033/034 | Marca confirmada; sem post obrigatório. |
| EKO-06 | P1 | Progresso e retomada honesta | Concluir | PRs 334/337 | Evento real; nova leitura não chamada de resume. |
| EKO-07 | P1 | Instagram no cadastro | Concluir/gate externo | PR 338/Meta | Conta externa real e caminho opcional. |
| EKO-08 | P1 | Briefing comercial vivo | Estender | EKO-05 | Oferta, público e limites atuais. |
| EKO-09 | P1 | Memórias separadas/versionadas | Estender | Perfil/fatos/feedback | Fato, preferência e desempenho não se misturam. |
| EKO-10 | P1 | Board de direção criativa | Criar camada | EKO-08 a 09 | Conceitos distintos e executáveis. |
| EKO-11 | P1 | Hipóteses e ranking anterior ao design | Estender | EKO-10 | Motivos/limites; não probabilidade falsa de venda. |
| EKO-12 | P1 | Campanha como unidade operacional | Estender | EKO-03,10 a 11 | Ciclo completo com estados/evidências. |
| EKO-13 | P1 | Qualidade e contrato vigente do estúdio | Concluir | SPEC 030 | Níveis, fallback, cobrança e ajuste consistentes. |
| EKO-14 | P1 | Feedback por edição e decisão | Estender | EKO-09,13 | Evidência útil sem nota obrigatória. |
| EKO-15 | P1 | Eval calibrado e holdout | Estender | Casos autorizados | Julgamento de modelo comparado a regras/humano. |
| EKO-16 | P2 | Pedido proativo de material | Criar fluxo | EKO-12 | Solicitação pequena e vinculada ao trabalho. |
| EKO-17 | P2 | Radar de oportunidades/busca | Criar fluxo | Fontes/budget/EKO-08 | Relevância e atualidade com evidência. |
| EKO-18 | P2 | Memória criativa de referências | Estender | EKO-09,14 | Atributos e direitos; não cópia. |
| EKO-19 | P1 | Eventos comerciais mínimos | Criar/estender | Campanha/publicação | Origem observada/declarada/desconhecida. |
| EKO-20 | P2 | Aprendizado muda o próximo plano | Estender | EKO-14,19 | Decisão posterior registra evidência e incerteza. |
| EKO-21 | P2 | Objeções comerciais como pauta | Experimento | Dados autorizados | Pergunta real vira comunicação útil. |
| EKO-22 | P2 | Comunicação ligada à capacidade | Experimento | Confirmação de oferta/capacidade | Sem escassez inventada. |
| EKO-23 | P2 | Supervisão de carteira | Estender | Operação por marca | Exceções úteis e isolamento. |
| EKO-24 | P2 | Agência/cliente/aprovador | Estender | EKO-23 | Papéis e cobrança coerentes. |
| EKO-25 | P2 | Indicação vinda de produto parceiro | Pequena integração | Acordo de origem | Sem transferência automática de dados. |
| EKO-26 | P3 | Novos canais/formatos | Expansão | Qualidade/economia/permissões | Capacidade real por canal. |
| EKO-27 | P3 | Rotinas com maior autonomia | Expansão | Gates/mandato | Escopo e pausa verificáveis. |
| EKO-28 | P3 | Modelo específico/ranker treinado | Experimento | Dataset/direitos/eval | Ganho fora da amostra. |
| EKO-29 | P3 | API/MCP externa | Futuro | EKO-03,27 | Mesmas políticas do app. |
| EKO-30 | P3 | Site/SEO/descoberta por IA e anúncios | Futuro | Demanda/budget/conectores | Não dispersar foco inicial. |

### 25.1. Trabalho já referenciado na conversa

SPEC 017 (rotina/coordenador), 018 (campanhas/fatos), 019 (edição/aprendizado), 020 (instruções explícitas), 021 (consumo), 022 (público/horários), 023 (carrossel), 024 (ajuste), 026 (logo), 027 (editor), 028 (pedido/redes/avaliador), 030 (estúdio), 031 (fatura/uso), 032 (preço por conta), 033 e 034 (marca/onboarding).

BEZ-275: revalidação no envio. BEZ-524/525 e BEZ-532 a 536: frentes de paleta/leitura/onboarding citadas. Esses IDs não significam status atual confirmado.

### 25.2. PRs consultadas

#326: cadastro rápido; #333: análise Native/SPEC 034; #334: tempo por etapa; #337: progresso ao vivo; #338: Instagram no cadastro. Todas mergeadas na `staging` até 03/11, junto com #335 (eventos por etapa), #336 (site inteiro por sitemap), #339 (passo do Instagram sempre visível) e #340 (logo e cores antes das páginas). Preservar verificação declarada e "não verificado" de cada PR. [E15] [E16] [E17] [E18] [E19]

### 25.3. Relação com backlog anterior

`PROP-E01` preflight → EKO-02; `E02` ranking → EKO-11; `E03` pacote de campanha → EKO-12; `E04` sinais comerciais → EKO-19; `E05` aprendizado → EKO-09/14/20; `E06` carteira → EKO-23/24; `E07` autonomia/canais → EKO-26/27/29.

Fundamentos `PROP-X01 a X04`: inventário, autorização, custos e avaliações continuam em EKO-01 a 04/15.

### 25.4. Modelo de card

Evidência do problema → trabalho humano removido → entrada/saída → escopo/não escopo → estados UX → dados/permissões → custo → aceite → teste real → telemetria → rollout/rollback → vínculo com decisão.

Não transformar "adicionar agente" em critério de aceite. O aceite é o trabalho entregue e verificado.


### 25.5. Reconciliação com a staging (03/11/2026)

Feita sobre a `staging` no commit `cf1aeac` (a `main`, produção, está 10 commits atrás: tudo da SPEC 034 ainda não foi para produção). Fonte: código, migrations, specs, PRs mergeadas e a lista Platform do ClickUp. Não houve execução do produto nesta etapa: "existe" quer dizer código ou tabela presente, não uso medido.

| ID | Estado na staging | Evidência | Card |
|---|---|---|---|
| EKO-01 | Feito nesta seção, menos flags e produção | Esta tabela. Falta conferir flag e deploy por capacidade | BEZ-540 |
| EKO-02 | **Lacuna confirmada** | `publish.ts` só confere pausa da conta (`publishing_controls.paused`) e lease. Não reavalia `company_facts.valid_until`/`status`, campanha pausada ou encerrada, nem `media_assets.people_consent` | BEZ-275 (backlog, escopo menor que o EKO-02) |
| EKO-03 | Parcial | `scheduled_posts` congela `caption_final`, `image_url`, `slide_urls` e `approved_at` na aprovação. Não guarda quais fatos e oferta a peça usou. Mandato: só existe a pausa | Sem card |
| EKO-04 | Parcial | `cost_usd` em `generation_runs`, `vision_calls` e `planning_runs`. Minutos humanos não são medidos | BEZ-459, BEZ-490 |
| EKO-05 | Na staging, parte em produção | PRs #323, #325, #326, #328, #330, #336 | BEZ-525, BEZ-534 |
| EKO-06 | Na staging | PRs #334, #335, #337, #340 e ADR 0031. Na queda, nova leitura (não há `Last-Event-ID`) | BEZ-532, BEZ-533, BEZ-535 |
| EKO-07 | Na staging; produção depende da Meta | PRs #338, #339. App Review enviado em 02/11; token do Instagram recusado em prod | BEZ-536, BEZ-538, BEZ-528 |
| EKO-08 | Parcial | `company_profiles` e fatos. Capacidade de atender, objeções e "o que quer vender agora" não existem | BEZ-207 |
| EKO-09 | Base existe | Fatos em `company_facts` (fonte, status, validade, quem aprovou); preferência em `style_rules` (aspecto, origem edição/feedback/manual, evidência); desempenho em `metrics_snapshots` e `audience_snapshots`. Falta escopo (campanha ou marca) e versão da regra | Sem card |
| EKO-10 | Não existe | O mais perto é `content_suggestions` (ideia, motivo, objetivo, horário) do coordenador da SPEC 017 | Sem card |
| EKO-11 | Não existe | `content_suggestions.reason` é o embrião do motivo | Sem card (BEZ-483 é vizinho) |
| EKO-12 | Parcial | `campaigns` com status e cotas no coordenador (SPEC 018). Não há estado da campanha por peça | BEZ-278 |
| EKO-13 | Em andamento | Níveis `instantaneo` (Rápido), `refinado`, `autoral` em `studio/levels.ts`; F4 a F6 abertas | BEZ-467, BEZ-468, BEZ-469, BEZ-503 |
| EKO-14 | Parcial | `style_rules.source = 'edicao'` (`learning.ts`) | BEZ-201, BEZ-337 |
| EKO-15 | Parcial | `evals/` com casos, juiz e baselines. Eval ao vivo só com orçamento aprovado | BEZ-329 |
| EKO-16 | Não existe | O coordenador usa o banco de imagens, mas não pede material | Sem card |
| EKO-17 | Não existe | Nenhuma busca, notícia ou grounding no código | Sem card |
| EKO-18 | Parcial | Territórios e títulos recentes em `studio/context.ts` | BEZ-404, BEZ-473 |
| EKO-19 | Parcial | `scheduled_posts.utm`; `funnel_daily` é legado do piloto. Origem observada ou declarada não existe | BEZ-276 |
| EKO-20 a 22 | Não existem | Dependem de EKO-14 e EKO-19 | Sem card |
| EKO-23, 24 | Parcial | Várias contas por pessoa, troca de conta e papéis (SPEC 029). Sem visão por exceção nem aprovador do cliente | BEZ-265 |
| EKO-25 | Fora deste repositório | Do lado da Ekoai, só registrar a origem do cadastro | Sem card |
| EKO-26 | Parcial | `GENERATED_CHANNELS` = Instagram e LinkedIn | BEZ-426, BEZ-210, BEZ-421 |
| EKO-27 a 30 | Futuro, de propósito | Esperam os gates G3 a G5 | Sem card |

### 25.6. O que a reconciliação muda no plano

1. **A onda 1 já está quase pronta.** Onboarding por leitura, progresso real e Instagram no cadastro estão na `staging`. Falta a release e o App Review da Meta, não código. As SPECs 033 e 034 ainda dizem "protótipo em andamento" e "rascunho": atualizar o status.
2. **O EKO-02 é o risco mais concreto e é pequeno.** O BEZ-275 cobre só o fato vencido; o gate certo também confere campanha pausada ou encerrada e consentimento da mídia, e vale no caminho da reconciliação que publica um container pronto.
3. **Duas das três memórias já têm tabela.** O EKO-09 é organizar (escopo e versão), não criar memória paralela.
4. **As camadas novas de verdade são board (EKO-10), hipóteses (EKO-11), pedido de material (EKO-16), radar (EKO-17) e eventos comerciais (EKO-19).** Nada disso existe no código; são as que precisam de spec e protótipo.
5. **Custo por tentativa existe; tempo humano não.** Sem minutos humanos não dá para medir a North Star da seção 2.5.


---

<a id="pilotos"></a>
## 26. Pilotos, cenários de teste e perguntas abertas

### 26.1. Casos propostos

**Marca com site bom:** onboarding extrai e a pessoa corrige poucas lacunas. Não gera post.

**Marca com pouco material:** contexto parcial é preservado; sistema pede somente o necessário para a próxima etapa.

**Confeitaria:** testar relevância de assuntos e capacidade, sem alegações de saúde não confirmadas.

**SaaS da própria BEZ como marca:** testar portfólio/prova, objeções de software e sinais do funil da própria empresa.

**Agência pequena:** medir se supervisão por exceção reduz esforço por marca, com permissões separadas.

### 26.2. Testes de mudança

Oferta vence depois da aprovação; imagem é revogada; cliente muda o tom; site é atualizado com preço diferente; campanha é pausada durante a geração; modelo falha no nível caro; canal aceita publicação mas resposta se perde; usuário muda de agência.

Em todos: manter evidência, aplicar política e explicar o próximo passo.

### 26.3. Validação comercial

Buscar piloto pago com escopo claro e critérios combinados. Medir se o cliente quer renovar, quantas intervenções exige e se a metodologia se repete.

Entusiasmo com uma imagem não comprova disposição a pagar por operação contínua.

### 26.4. Perguntas abertas

Primeiro ICP e canal? Qual responsabilidade a Ekoai assume no pacote? Quem revisa exceções editoriais? Qual orçamento de produção/pesquisa? Quem aprova fatos? Qual nível de autonomia? Que evento comercial pode ser observado? Qual taxa real de rejeição? Quais integrações exigem revisão externa?

Não presumir respostas porque o produto tem campos no banco.

### 26.5. O que adiar

Modelo fundacional próprio, treinamento com todas as marcas por padrão, campanha totalmente autônoma sem mandato, promessa de ROI garantido, agência ilimitada, todas as redes e vídeo de uma vez, scraping irrestrito e "score de viralização" não calibrado.

### 26.6. Manutenção

Atualizar por decisão datada, com fonte e itens superados. Revisar specs/PRs antes de criar nova verdade concorrente. O roadmap é vivo, mas decisões não devem mudar silenciosamente.

A próxima recomendação do sistema precisa poder ser explicada: contexto utilizado, evidência, hipótese, limite e ação proposta.


---

<a id="contexto-historico"></a>
## 27. Apêndice: tendências, números e alternativas do início da conversa

### Contexto preservado, não premissa validada

A primeira resposta da conversa citou números de mercado, rodadas e previsões para sustentar a transformação de software em execução de trabalho. Para não perder esse contexto, o registro abaixo os preserva **como afirmações daquela resposta**, não como fatos rechecados nesta consolidação.

Antes de usar qualquer número em landing page, pitch, planejamento financeiro ou comunicação externa, conferir o relatório original, data, população, método e condições. Os links disponíveis foram mantidos; onde não há uma fonte portátil exata no material recebido, isso é indicado em vez de inventar uma.

| Afirmação citada no início | Status nesta documentação |
|---|---|
| Menlo 2025: US$ 37 bilhões de gasto empresarial com IA generativa, +222%; US$ 19 bilhões em aplicações; 76% das soluções compradas e 63% da receita de aplicações capturada por startups. | Registro histórico atribuído ao relatório; números/metodologia não revalidados nesta etapa. [M01] |
| Sequoia, "Services: The New Software", citado com data de 5/3/2026 e proporção de seis dólares de serviços para cada dólar de software. | Tese de investimento; proporção não deve ser aplicada automaticamente ao Brasil ou a cada nicho. Data e número requerem conferência antes de uso externo. [M02] |
| Gartner: cerca de 40% dos projetos de IA agêntica cancelados até o fim de 2027. | Previsão citada, não resultado observado; a fonte exata não foi recuperada nesta consolidação. |
| Empresa de serviços de IA anunciada por Anthropic e investidores em maio de 2026. | Exemplo mencionado; anúncio e termos não foram revalidados nem usados como dependência. |
| Trunk Tools: rodada de US$ 40 milhões em 2025. | Valor histórico citado; não sustenta avaliação de capacidade ou ROI. |
| Rillet: US$ 100 milhões e valuation de US$ 1 bilhão em agosto de 2026. | Afirmação citada, sem revalidação nesta documentação. |
| GovWell: rodada de US$ 25 milhões em maio de 2026. | Afirmação citada, sem revalidação nesta documentação. |
| Tidemark: pesquisa com mais de 200 empresas de SaaS vertical e associação entre expansão/IA e crescimento. | Não confundir correlação, seleção da amostra e causalidade; não implica lançar vários produtos simultaneamente. |
| Recomendações de a16z sobre cobrar por trabalho/resultado e Bessemer sobre margens de empresas de IA. | Referências temáticas citadas; não foram usadas como benchmark numérico nem regra de precificação. |

A estratégia deste documento **não depende de esses números estarem corretos**. Ela precisa ser comprovada por tarefas concluídas, tempo humano, qualidade, retenção e economia dos próprios pilotos.

### Horizontes discutidos

| Horizonte de cenário | Tendência discutida | Uso no planejamento |
|---|---|---|
| 2027 | Sistemas executando processos, não apenas respondendo. | Fechar ciclos delimitados agora. |
| 2027 a 2028 | Identidade, permissões, auditoria e avaliação de agentes. | Construir fundação de confiança junto da execução. |
| 2028 a 2029 | Software operado por outros softwares/agentes. | Ferramentas tipadas; API/MCP quando houver demanda. |
| 2028 a 2030 | IA ligada ao mundo físico. | Fora do escopo da Ekoai; não apostar a execução em hardware. |
| 2028 a 2030 | Comércio assistido ou entre agentes. | Observar autorização, compromisso e verificação; não pressupor padrão dominante. |

Os rótulos de confiança usados na conversa eram julgamento estratégico, não probabilidade estatística. Datas não são compromissos de maturidade do mercado.

### Outras empresas e categorias citadas

Rillet (contabilidade), HappyRobot (logística), Grantable/Instrumentl (captação), Native (marketing), Sidekick (operações industriais), PermitFlow/GovWell (licenciamento/governo), Trunk Tools/PLAN0 AI (construção/documentação/custos) apareceram como exemplos de execução vertical.

No Brasil, Prosas e ENTI/iAFRO foram citadas para mostrar que captação já tinha concorrentes; Sienge e Vobi para lembrar que a construção não é um espaço vazio. Isso é contexto da exploração inicial, não evidência de integração ou decisão de entrar em todos esses mercados.

### Hipóteses comerciais que não viraram decisão

Foram propostos entrevistas, pilotos pagos, serviço inicialmente assistido e automação das etapas repetidas. A ilustração de R$ 500 a R$ 2.500 por processo de licenciamento era hipótese para outro possível negócio, não preço de nenhum produto da BEZ. A simulação de R$ 1.500 por cliente/mês e 20 clientes não era previsão de receita.

A ideia de captação/prestação de contas, back-office vertical, compliance e industrial AI permaneceu fora do escopo de implementação dos dois documentos.


---

<a id="cobertura"></a>
## 28. Matriz de cobertura da conversa e memória de contexto

| Tema solicitado/discutido | Onde foi consolidado |
|---|---|
| Futuro de SaaS, serviços AI-native e sistemas de ação | 1 a 2 e 27. |
| Comunicação conduzida pela plataforma, não por prompts do usuário | 2 e 5. |
| Público de empresa, time e agência | 2 e 16. |
| Onboarding por site/material/Instagram | 6. |
| Decisão de não gerar post imediatamente | 3 e 6. |
| Paleta, hex, variantes e enriquecimento posterior | 6.5. |
| PRs atuais e diferença entre streaming e retomada | 4, 6 e 25.2. |
| Fatos, marca e desempenho como memórias distintas | 7 e 11. |
| Board mais criativo, conceitos e hipóteses | 8. |
| Native/Norn e seleção antes da produção | 8 e 23. |
| Qualidade visual, estúdio, modelos, níveis e ajustes | 10. |
| Aprendizado por post, notas, edição e limites de ML | 11. |
| Notícias genéricas versus busca de nicho por modelo barato | 12. |
| GDELT, RSS, NewsAPI e Google Search grounding | 12. |
| Pedir material real e produzir a partir de evidências da empresa | 13. |
| Campanhas, calendário, publicação e proatividade | 9 e 14. |
| Resultado comercial, CRM/UTM e atribuição honesta | 15. |
| Agência e carteira por exceção | 16. |
| Novas ideias: objeções, capacidade e memória explicável | 17. |
| Indicação vinda de produto parceiro e limites de compartilhamento | 18. |
| Conectores, crawlers e redução de troca de contexto | 20. |
| Autonomia, riscos, permissões, revisão e custo | 19, 21 e 22. |
| Concorrentes e metodologia de comparação | 23. |
| Cronograma, backlog, pilotos e critérios | 24 a 26. |
| Propostas históricas e valores não aprovados | 3, 22 e 27. |

### Como usar

Partir da direção e das decisões recentes. Conferir specs/PRs antes de criar trabalho novo. Escolher uma unidade de trabalho, especificar seu fluxo completo e verificar o resultado com uma marca real autorizada.

Não reintroduzir "post imediato no cadastro" como requisito só porque uma proposta antiga ou concorrente o faz. Não tratar todas as preferências como regras permanentes. Não apresentar nota de design como previsão de receita.

A documentação deve alimentar produto, design, engenharia e validação comercial, não ser apenas um catálogo de agentes.


---

<a id="fontes"></a>
## 29. Fontes, referências e limites de evidência

As fontes abaixo foram consultadas ou citadas durante a conversa e recuperadas dos materiais disponíveis para esta consolidação. **Não houve nova pesquisa de mercado nesta geração dos arquivos.** Links de branches móveis e páginas comerciais podem mudar.

Referências de repositório indicam arquivos/trechos lidos, não execução independente. Referências de fornecedores indicam documentação/oferta pública, não comprovação de desempenho. Mensagens do fundador são a base para as diretrizes de produto e restrições registradas nos capítulos de decisões.

<a id="fonte-e01"></a>
### E01: Ekoai, CLAUDE.md

**Fonte:** [abrir referência](https://github.com/bez-company/ekoai-platform/blob/5d6210a2ea5300ae18026bc9be63caa857d8ac5f/CLAUDE.md).
**Registro:** 2026-11-02.
**Contexto:** Produto genérico, isolamento por conta, padrões de desenvolvimento e infraestrutura; não reintroduzir dependência de uma marca.
**Limite:** Arquivo ou trecho lido; execução não verificada

<a id="fonte-e02"></a>
### E02: Ekoai, README.md

**Fonte:** [abrir referência](https://github.com/bez-company/ekoai-platform/blob/5d6210a2ea5300ae18026bc9be63caa857d8ac5f/README.md).
**Registro:** 2026-11-02.
**Contexto:** A descrição de fase inicial está atrasada em relação ao código de geração observado.
**Limite:** Arquivo ou trecho lido; execução não verificada

<a id="fonte-e03"></a>
### E03: Ekoai, platform/src/lib/agents.ts

**Fonte:** [abrir referência](https://github.com/bez-company/ekoai-platform/blob/5d6210a2ea5300ae18026bc9be63caa857d8ac5f/platform/src/lib/agents.ts).
**Registro:** 2026-11-02.
**Contexto:** Contexto de marca, fatos, restrições, campanha, diretivas e saídas estruturadas já existem.
**Limite:** Arquivo ou trecho lido; execução não verificada

<a id="fonte-e04"></a>
### E04: Ekoai, platform/src/lib/generation.ts

**Fonte:** [abrir referência](https://github.com/bez-company/ekoai-platform/blob/5d6210a2ea5300ae18026bc9be63caa857d8ac5f/platform/src/lib/generation.ts).
**Registro:** 2026-11-02.
**Contexto:** Orquestração assíncrona, reserva de chamadas, mídia autorizada, formatos, revisão e geração até aprovação.
**Limite:** Arquivo ou trecho lido; execução não verificada

<a id="fonte-e05"></a>
### E05: Ekoai, platform/src/lib/studio/context.ts

**Fonte:** [abrir referência](https://github.com/bez-company/ekoai-platform/blob/5d6210a2ea5300ae18026bc9be63caa857d8ac5f/platform/src/lib/studio/context.ts).
**Registro:** 2026-11-02.
**Contexto:** Contexto de marca e memória curta de territórios/títulos recentes; não é evidência de predição de conversão.
**Limite:** Arquivo ou trecho lido; execução não verificada

<a id="fonte-e06"></a>
### E06: Ekoai, platform/src/lib/feedback.ts

**Fonte:** [abrir referência](https://github.com/bez-company/ekoai-platform/blob/5d6210a2ea5300ae18026bc9be63caa857d8ac5f/platform/src/lib/feedback.ts).
**Registro:** 2026-11-02.
**Contexto:** Feedback e regras de estilo por conta, editáveis e com evidência; regra editada passa a ser manual.
**Limite:** Arquivo ou trecho lido; execução não verificada

<a id="fonte-e07"></a>
### E07: Ekoai, platform/src/lib/content-plan-model.ts

**Fonte:** [abrir referência](https://github.com/bez-company/ekoai-platform/blob/5d6210a2ea5300ae18026bc9be63caa857d8ac5f/platform/src/lib/content-plan-model.ts).
**Registro:** 2026-11-02.
**Contexto:** Planejamento determinístico por rotação, datas, fotos, campanha e engajamento médio; não demonstra modelo causal de resultados comerciais.
**Limite:** Arquivo ou trecho lido; execução não verificada

<a id="fonte-e08"></a>
### E08: Ekoai, platform/src/lib/analysis-view.ts

**Fonte:** [abrir referência](https://github.com/bez-company/ekoai-platform/blob/5d6210a2ea5300ae18026bc9be63caa857d8ac5f/platform/src/lib/analysis-view.ts).
**Registro:** 2026-11-02.
**Contexto:** Estados explícitos de insuficiência/ausência de métricas e recomendação por horários; preservar esses estados honestos.
**Limite:** Arquivo ou trecho lido; execução não verificada

<a id="fonte-e09"></a>
### E09: Ekoai, platform/src/lib/publish.ts

**Fonte:** [abrir referência](https://github.com/bez-company/ekoai-platform/blob/5d6210a2ea5300ae18026bc9be63caa857d8ac5f/platform/src/lib/publish.ts).
**Registro:** 2026-11-02.
**Contexto:** Lease, tentativa, registro do container, reconciliação e separação de ensaio; não foi encontrada revalidação de fatos no caminho de envio lido.
**Limite:** Arquivo ou trecho lido; execução não verificada

<a id="fonte-e10"></a>
### E10: Ekoai, platform/src/app/api/cron/publish-due/route.ts

**Fonte:** [abrir referência](https://github.com/bez-company/ekoai-platform/blob/5d6210a2ea5300ae18026bc9be63caa857d8ac5f/platform/src/app/api/cron/publish-due/route.ts).
**Registro:** 2026-11-02.
**Contexto:** Reconciliação antes de novas publicações e separação de falhas de avisos/aprovações.
**Limite:** Arquivo ou trecho lido; execução não verificada

<a id="fonte-e11"></a>
### E11: Ekoai, docs/specs/018-objetivos-campanhas-e-fatos.md

**Fonte:** [abrir referência](https://github.com/bez-company/ekoai-platform/blob/5d6210a2ea5300ae18026bc9be63caa857d8ac5f/docs/specs/018-objetivos-campanhas-e-fatos.md).
**Registro:** 2026-11-02.
**Contexto:** Campanhas e fatos confirmados/vigentes já implementados segundo a spec; BEZ-275 registra revalidação no envio como pendência.
**Limite:** Arquivo ou trecho lido; execução não verificada

<a id="fonte-e12"></a>
### E12: Ekoai, docs/specs/030-estudio-de-posts-multiagente.md

**Fonte:** [abrir referência](https://github.com/bez-company/ekoai-platform/blob/5d6210a2ea5300ae18026bc9be63caa857d8ac5f/docs/specs/030-estudio-de-posts-multiagente.md).
**Registro:** 2026-11-02.
**Contexto:** Estúdio autoral, avaliações pequenas, custo e fallback; revisões de níveis/preço tornam importante definir o contrato vigente; não comprova resultado comercial.
**Limite:** Arquivo ou trecho lido; execução não verificada

<a id="fonte-e13"></a>
### E13: Ekoai, SPEC 033: paleta e leitura do site

**Fonte:** [abrir referência](https://github.com/bez-company/ekoai-platform/blob/staging/docs/specs/033-paleta-da-marca-e-leitura-do-site.md).
**Registro:** 2026-11-03.
**Contexto:** Extração de marca e fatos, revisão, paleta e leitura do Instagram conectado.
**Limite:** Fonte citada nas análises da conversa; não houve nova consulta nesta consolidação.

<a id="fonte-e14"></a>
### E14: Ekoai, SPEC 034: leitura da marca em tempo real

**Fonte:** [abrir referência](https://github.com/bez-company/ekoai-platform/blob/staging/docs/specs/034-onboarding-leitura-em-tempo-real.md).
**Registro:** 2026-11-03.
**Contexto:** Eventos reais de progresso, leitura por orçamento de páginas, sitemap e Instagram no onboarding; algumas intenções da spec divergem da implementação descrita nas PRs.
**Limite:** Fonte citada nas análises da conversa; não houve nova consulta nesta consolidação.

<a id="fonte-e15"></a>
### E15: Ekoai, PR #326

**Fonte:** [abrir referência](https://github.com/bez-company/ekoai-platform/pull/326).
**Registro:** 2026-11-03.
**Contexto:** Cadastro rápido com site, leitura e confirmação. Corpo da PR declara testes executados e limites de verificação.
**Limite:** Corpo da PR consultado na conversa. Testes declarados pelo autor, sem execução independente nesta consolidação.

<a id="fonte-e16"></a>
### E16: Ekoai, PR #333

**Fonte:** [abrir referência](https://github.com/bez-company/ekoai-platform/pull/333).
**Registro:** 2026-11-03.
**Contexto:** Análise do Native e SPEC 034; recursos pagos não foram testados segundo a própria PR.
**Limite:** Corpo da PR consultado na conversa. Testes declarados pelo autor, sem execução independente nesta consolidação.

<a id="fonte-e17"></a>
### E17: Ekoai, PR #334

**Fonte:** [abrir referência](https://github.com/bez-company/ekoai-platform/pull/334).
**Registro:** 2026-11-03.
**Contexto:** Instrumentação de tempo por etapa; medições reais dependem da execução em staging.
**Limite:** Corpo da PR consultado na conversa. Testes declarados pelo autor, sem execução independente nesta consolidação.

<a id="fonte-e18"></a>
### E18: Ekoai, PR #337

**Fonte:** [abrir referência](https://github.com/bez-company/ekoai-platform/pull/337).
**Registro:** 2026-11-03.
**Contexto:** Leitura em tempo real. Na queda, a implementação descrita reinicia uma leitura, não retoma execução server-side pelo ponto exato.
**Limite:** Corpo da PR consultado na conversa. Testes declarados pelo autor, sem execução independente nesta consolidação.

<a id="fonte-e19"></a>
### E19: Ekoai, PR #338

**Fonte:** [abrir referência](https://github.com/bez-company/ekoai-platform/pull/338).
**Registro:** 2026-11-03.
**Contexto:** Instagram dentro do cadastro, retorno ao onboarding e feature flag; produção condicionada ao App Review; leitura visual das fotos não deve ser prometida só porque legendas são lidas.
**Limite:** Corpo da PR consultado na conversa. Testes declarados pelo autor, sem execução independente nesta consolidação.

<a id="fonte-w10"></a>
### W10: Native, Y Combinator

**Fonte:** [abrir referência](https://www.ycombinator.com/companies/native).
**Registro:** 2026-11-02.
**Contexto:** YC Fall 2026; proposta de inteligência de escolha anterior à produção. Dados de tração são declarações da empresa.
**Limite:** Descrição pública do fornecedor/diretório; não testamos o produto concorrente

<a id="fonte-w11"></a>
### W11: Native, Norn API

**Fonte:** [abrir referência](https://native.no/norn).
**Registro:** 2026-11-02.
**Contexto:** Ranking de ideias, decisões e resultados como aprendizado; API em lista de espera e sem preço definido na página consultada.
**Limite:** Descrição pública do fornecedor/diretório; não testamos o produto concorrente

<a id="fonte-w12"></a>
### W12: Jasper, Agents

**Fonte:** [abrir referência](https://www.jasper.ai/agents).
**Registro:** 2026-11-02.
**Contexto:** Agentes de marketing com contexto e governança de marca.
**Limite:** Descrição pública do fornecedor/diretório; não testamos o produto concorrente

<a id="fonte-w13"></a>
### W13: Jasper IQ

**Fonte:** [abrir referência](https://www.jasper.ai/jasper-iq).
**Registro:** 2026-11-02.
**Contexto:** Contexto persistente de voz, identidade, público e material aprovado.
**Limite:** Descrição pública do fornecedor/diretório; não testamos o produto concorrente

<a id="fonte-w14"></a>
### W14: AirOps

**Fonte:** [abrir referência](https://www.airops.com/).
**Registro:** 2026-11-02.
**Contexto:** Pesquisa, produção, publicação e atualização com governança e acompanhamento; foco em descoberta por IA, não substitui foco inicial da Ekoai.
**Limite:** Descrição pública do fornecedor/diretório; não testamos o produto concorrente

<a id="fonte-w15"></a>
### W15: mLabs, IA e MCP

**Fonte:** [abrir referência](https://www.mlabs.com.br/funcionalidades/ia-mcp/).
**Registro:** 2026-11-02.
**Contexto:** Criação, agenda, insights e operações por assistentes externos; chatbot e MCP isolados não criam diferenciação defensável.
**Limite:** Descrição pública do fornecedor/diretório; não testamos o produto concorrente

<a id="fonte-w16"></a>
### W16: Buffer, MCP

**Fonte:** [abrir referência](https://developers.buffer.com/guides/integrations/mcp).
**Registro:** 2026-11-02.
**Contexto:** Integrações com assistentes para leitura e ações; referência de canal futuro com controles, não prioridade inicial.
**Limite:** Descrição pública do fornecedor/diretório; não testamos o produto concorrente

<a id="fonte-w17"></a>
### W17: Meta, Instagram API (coleção oficial no Postman)

**Fonte:** [abrir referência](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api).
**Registro:** 2026-11-02.
**Contexto:** Disponibilidade depende de conta profissional, fluxo de login e permissões; validar capacidade específica antes de prometer integrações.
**Limite:** Descrição pública do fornecedor/diretório; não testamos o produto concorrente

<a id="fonte-b11"></a>
### B11: Native, entrada pela marca

**Fonte:** [abrir referência](https://native.no/pt).
**Registro:** 2026-11-03.
**Contexto:** Referência de experiência iniciada pelo site; não decisão de obrigar um post no onboarding da Ekoai.
**Limite:** Fonte citada nas análises da conversa; não houve nova consulta nesta consolidação.

<a id="fonte-b12"></a>
### B12: Native, introducing Norn

**Fonte:** [abrir referência](https://native.no/blog/introducing-norn).
**Registro:** 2026-11-03.
**Contexto:** Seleção de ideias e aprendizado declarados pelo fornecedor; sem validação independente nesta conversa.
**Limite:** Fonte citada nas análises da conversa; não houve nova consulta nesta consolidação.

<a id="fonte-t08"></a>
### T08: Google Cloud, Grounding with Google Search

**Fonte:** [abrir referência](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/grounding/grounding-with-google-search).
**Registro:** 2026-11-03.
**Contexto:** Busca real integrada a modelos compatíveis; checar disponibilidade, preço e requisitos de exibição.
**Limite:** Fonte citada nas análises da conversa; não houve nova consulta nesta consolidação.

<a id="fonte-t10"></a>
### T10: GDELT

**Fonte:** [abrir referência](https://www.gdeltproject.org/).
**Registro:** 2026-11-03.
**Contexto:** Descoberta e monitoramento de notícias; não fornece automaticamente estratégia de marca ou licença para republicar artigos.
**Limite:** Fonte citada nas análises da conversa; não houve nova consulta nesta consolidação.

<a id="fonte-t11"></a>
### T11: NewsAPI, pricing

**Fonte:** [abrir referência](https://newsapi.org/pricing).
**Registro:** 2026-11-03.
**Contexto:** Na pesquisa anterior, o plano Developer era restrito a desenvolvimento/teste; confirmar condições atuais.
**Limite:** Fonte citada nas análises da conversa; não houve nova consulta nesta consolidação.

<a id="fonte-t12"></a>
### T12: Anthropic, avaliações de agentes

**Fonte:** [abrir referência](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents).
**Registro:** 2026-11-03.
**Contexto:** Combinar verificações por código, modelos e humanos; medir resultado da tarefa.
**Limite:** Fonte citada nas análises da conversa; não houve nova consulta nesta consolidação.

<a id="fonte-m01"></a>
### M01: Menlo Ventures, State of Generative AI 2025

**Fonte:** [abrir referência](https://menlovc.com/perspective/2025-the-state-of-generative-ai-in-the-enterprise/).
**Registro:** 2026-11-03.
**Contexto:** Números citados na abertura da conversa; preservados no registro histórico, não revalidados nesta consolidação.
**Limite:** Fonte citada nas análises da conversa; não houve nova consulta nesta consolidação.

<a id="fonte-m02"></a>
### M02: Sequoia, Services: The New Software

**Fonte:** [abrir referência](https://sequoiacap.com/article/services-the-new-software).
**Registro:** 2026-11-03.
**Contexto:** Tese de capturar trabalho/serviços, usada como inspiração; proporções citadas exigem checagem antes de uso comercial.
**Limite:** Fonte citada nas análises da conversa; não houve nova consulta nesta consolidação.


---

<!-- Referências portáteis de Markdown. -->

[E01]: https://github.com/bez-company/ekoai-platform/blob/5d6210a2ea5300ae18026bc9be63caa857d8ac5f/CLAUDE.md
[E02]: https://github.com/bez-company/ekoai-platform/blob/5d6210a2ea5300ae18026bc9be63caa857d8ac5f/README.md
[E03]: https://github.com/bez-company/ekoai-platform/blob/5d6210a2ea5300ae18026bc9be63caa857d8ac5f/platform/src/lib/agents.ts
[E04]: https://github.com/bez-company/ekoai-platform/blob/5d6210a2ea5300ae18026bc9be63caa857d8ac5f/platform/src/lib/generation.ts
[E05]: https://github.com/bez-company/ekoai-platform/blob/5d6210a2ea5300ae18026bc9be63caa857d8ac5f/platform/src/lib/studio/context.ts
[E06]: https://github.com/bez-company/ekoai-platform/blob/5d6210a2ea5300ae18026bc9be63caa857d8ac5f/platform/src/lib/feedback.ts
[E07]: https://github.com/bez-company/ekoai-platform/blob/5d6210a2ea5300ae18026bc9be63caa857d8ac5f/platform/src/lib/content-plan-model.ts
[E08]: https://github.com/bez-company/ekoai-platform/blob/5d6210a2ea5300ae18026bc9be63caa857d8ac5f/platform/src/lib/analysis-view.ts
[E09]: https://github.com/bez-company/ekoai-platform/blob/5d6210a2ea5300ae18026bc9be63caa857d8ac5f/platform/src/lib/publish.ts
[E10]: https://github.com/bez-company/ekoai-platform/blob/5d6210a2ea5300ae18026bc9be63caa857d8ac5f/platform/src/app/api/cron/publish-due/route.ts
[E11]: https://github.com/bez-company/ekoai-platform/blob/5d6210a2ea5300ae18026bc9be63caa857d8ac5f/docs/specs/018-objetivos-campanhas-e-fatos.md
[E12]: https://github.com/bez-company/ekoai-platform/blob/5d6210a2ea5300ae18026bc9be63caa857d8ac5f/docs/specs/030-estudio-de-posts-multiagente.md
[E13]: https://github.com/bez-company/ekoai-platform/blob/staging/docs/specs/033-paleta-da-marca-e-leitura-do-site.md
[E14]: https://github.com/bez-company/ekoai-platform/blob/staging/docs/specs/034-onboarding-leitura-em-tempo-real.md
[E15]: https://github.com/bez-company/ekoai-platform/pull/326
[E16]: https://github.com/bez-company/ekoai-platform/pull/333
[E17]: https://github.com/bez-company/ekoai-platform/pull/334
[E18]: https://github.com/bez-company/ekoai-platform/pull/337
[E19]: https://github.com/bez-company/ekoai-platform/pull/338
[W10]: https://www.ycombinator.com/companies/native
[W11]: https://native.no/norn
[W12]: https://www.jasper.ai/agents
[W13]: https://www.jasper.ai/jasper-iq
[W14]: https://www.airops.com/
[W15]: https://www.mlabs.com.br/funcionalidades/ia-mcp/
[W16]: https://developers.buffer.com/guides/integrations/mcp
[W17]: https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api
[B11]: https://native.no/pt
[B12]: https://native.no/blog/introducing-norn
[T08]: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/grounding/grounding-with-google-search
[T10]: https://www.gdeltproject.org/
[T11]: https://newsapi.org/pricing
[T12]: https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents
[M01]: https://menlovc.com/perspective/2025-the-state-of-generative-ai-in-the-enterprise/
[M02]: https://sequoiacap.com/article/services-the-new-software
