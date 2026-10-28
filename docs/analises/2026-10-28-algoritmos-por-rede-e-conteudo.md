# Algoritmos por rede e o que isso muda nos agentes da Ekoai (28/10/2026)

> Pesquisa, não decisão. Parte de um vídeo (transcrição e 5 prints) que compara Instagram, X, LinkedIn e
> TikTok, e de uma rodada própria de pesquisa em fontes primárias (repositórios e blogs de engenharia das
> redes) e secundárias (blogs de marketing). Toda afirmação traz o grau de confiança na seção 8. Onde só
> achei blog de marketing, está escrito.
>
> Contexto do produto: [SPEC 012](../specs/012-agentes-instagram-fase-2.md) (agentes),
> [SPEC 022](../specs/022-analise-do-publico-e-horarios.md) (análise), [SPEC 005](../specs/005-linkedin-formatos-e-engajamento.md)
> e [SPEC 002](../specs/002-canal-x.md) (LinkedIn e X), [concorrentes](2026-10-16-concorrentes-e-insights.md).

## 1. Resumo

1. **O vídeo acerta a direção, mas dois números estão velhos.** Os pesos do X (0,5, 13,5, 75, -74, -369) são
   de abril de 2023 e valem para a *probabilidade prevista* de cada ação, não para a contagem. Em janeiro de
   2026 o X publicou outro algoritmo (modelo Grok, sem pesos numéricos no README). O print do LinkedIn é de 2020;
   em março de 2026 a rede trocou a recuperação e o ranking por modelos de linguagem. A lição de conteúdo
   continua valendo. O número exato, não.
2. **As quatro redes fazem a mesma coisa por baixo:** preveem, para cada pessoa, a chance de ela fazer cada ação
   com o post, e somam com pesos. Ação que custa esforço social (enviar a um amigo, responder, terminar o
   vídeo) pesa mais que ação barata (curtir). Ação negativa existe e pesa muito.
3. **O que o motor da Ekoai faz hoje só serve ao Instagram**, e mesmo lá otimiza por uma taxa única
   (interações ÷ alcance) em que curtida e envio valem o mesmo. Faltam: intenção de sinal por post, a nota
   por sinal (envio por alcance, curtida por alcance, salvamento por alcance), um critério de "alguém
   mandaria isso?" e um perfil de rede que mude o prompt para LinkedIn e X.
4. **Maior alavanca barata:** fazer o estrategista declarar, em cada post, *quem manda isso para quem e por
   quê* (campo novo no JSON, sem chamada extra de modelo), medir envio por alcance e usar o eval para
   comparar antes e depois.
5. **Maior risco de qualidade:** texto genérico de IA. LinkedIn e Instagram estão endurecendo contra
   conteúdo sem originalidade. O revisor por regra e a base de fatos da Ekoai já são uma vantagem; falta
   explorá-la como posicionamento e exigir detalhe específico da empresa em cada post.

## 2. O que o vídeo diz, conferido

| Afirmação | Situação | Detalhe |
| --- | --- | --- |
| Instagram: os três sinais são tempo de visualização, curtidas e envios | **Confirmado** | Mosseri, jan/2025 (print do Social Media Today): "watch time, likes and sends", e para olhar nos insights "average watch time, likes per reach, sends per reach". |
| Envio é o mais forte para quem não te segue | **Meia verdade** | Mosseri disse que curtida pesa "um pouco mais" para conteúdo conectado e envio "um pouco mais" para não conectado. "Mais forte" e os multiplicadores de 3 a 5 vezes circulam em blogs, sem fonte oficial. |
| X: curtida 0,5, resposta 13,5, conversa 75, silenciar ou bloquear -74, denúncia -369 | **Número de 2023** | A tabela é do `the-algorithm-ml`, datada de 5/4/2023. O modelo devolve uma probabilidade por ação e a nota é a soma ponderada. O README avisa que os pesos vêm de arquivo de configuração e mudam. "Conversa com quem comentou" é `reply_engaged_by_author`: a chance de o **autor** interagir com uma resposta ao post dele. |
| X ficou transparente com a abertura do código | **Desatualizado** | Em 19/1/2026 saiu `xai-org/x-algorithm` (Apache 2.0): um transformer derivado do Grok faz o ranking, e o README diz que removeu features manuais e a maioria das heurísticas. A fórmula é `Σ peso × P(ação)`, mas os valores numéricos não estão no README. |
| LinkedIn: a nota vem do tempo de permanência | **Simplificação de um texto de 2020** | O blog de engenharia (2020) diz que o *dwell time* **complementa** clique e ação viral, e que permanência abaixo de um limiar conta como "pulou" (negativo). Em 12/3/2026 o blog descreve recuperação por embeddings de LLM e um ranqueador sequencial (mais de 1.000 interações passadas por membro). Permanência longa é uma ação passiva entre outras; comentário, curtida e compartilhamento são ações ativas. Nenhum peso publicado. |
| TikTok: seguidor não é fator direto, assistir até o fim pesa | **Confirmado** | Newsroom: "neither follower count nor whether the account has had previous high-performing videos are direct factors". O exemplo de sinal forte é terminar um vídeo mais longo. Sem peso numérico. |

## 3. O que as quatro redes têm em comum

1. **Previsão por pessoa, não nota única do post.** Dois seguidores veem o mesmo post com notas diferentes. No
   LinkedIn, relatos de praticantes falam em "grafo de interesse": a rede aprende sobre o que você fala.
   Consequência: nicho e público claros no perfil da empresa pesam mais que "post viral".
2. **Esforço social vale mais que clique.** Enviar, responder, terminar e salvar sinalizam utilidade
   ou vínculo. Curtir sinaliza pouco.
3. **Sinal negativo é explícito e forte** (X: não tenho interesse, silenciar, bloquear, denunciar; LinkedIn:
   pulou rápido; Instagram: "não tenho interesse").
4. **Originalidade e confiança estão subindo.** Abril de 2026: o Instagram estendeu a todos os formatos a
   regra de não recomendar a não seguidores contas que só republicam o que não criaram (Mosseri; confirmado
   por duas matérias, o texto original não abriu). No LinkedIn, uma análise da Pangram (jul/2026) estimou
   mais de 40% dos posts longos como escritos por máquina, e circula (sem fonte primária) que a rede reduz
   o alcance de post classificado como IA.
5. **O algoritmo muda, e rápido.** O X trocou de modelo em 2026; o LinkedIn trocou em março. Qualquer regra
   de conteúdo precisa de data de revisão (ver R1).

## 4. Por rede: o sinal, o conteúdo, o que evitar

### 4.1 Instagram: conteúdo que a pessoa vai mandar

**O que a rede mede** (Mosseri e a página oficial "Instagram ranking explained"):

- Reels: chance de reenviar, assistir até o fim, curtir e ir à página do áudio.
- Feed: chance de a pessoa passar alguns segundos no post, comentar, curtir, compartilhar e tocar no perfil.
- Explore: curtidas, salvamentos e compartilhamentos, e **a velocidade** com que acontecem.
- Para conectados, curtida pesa um pouco mais; para não conectados, envio.

**O que o conteúdo precisa fazer:** ser algo que a pessoa encaminha a *uma* pessoa específica, com uma frase
tipo "lembrei de você" ou "olha isso". Os tipos que blogs de marketing repetem (sem estudo controlado) e que
fazem sentido para o pequeno negócio brasileiro da Ekoai:

| Tipo | Por que se envia | Exemplo (negócio da Ekoai) |
| --- | --- | --- |
| Utilidade guardável | "Manda para quem precisa disso" | Padaria: "3 jeitos de conservar o bolo" |
| Aviso para um grupo | Combina algo entre amigos | "Abrimos domingo", "Leve 3, pague 2 até sexta" (a pessoa chama o grupo) |
| Identificação | "Isso é a sua cara" | Oficina: "Quando foi a última vez que você olhou o pneu?" |
| Local | Vizinho manda para vizinho | Bairro, cidade, evento da região |
| Prova concreta | Recomendar a quem tem a mesma dor | Resultado real e fato da empresa, nunca depoimento inventado |

**Teste do envio** (proposta para o prompt e para o eval): "Quem manda isso para quem, e o que escreve junto?"
Se a resposta é "ninguém", o post serve só a curtida.

**Formato:** carrossel lidera em engajamento e salvamento nos benchmarks. Socialinsider (2025): carrossel 0,55%,
Reels 0,52%, imagem 0,37%. Buffer (2026, por alcance): carrossel 6,9%, imagem 4,4%, Reels 3,3%. As bases
diferem (seguidores x alcance), então **use a ordem, não o valor**: carrossel e Reels acima da imagem única.
A Socialinsider ignora salvamento e envio na fórmula dela, o que subestima o carrossel.

**Texto e busca:** Mosseri chama hashtag de ferramenta de categorização, não de impulso (via blogs; sem
fonte primária). A busca lê legenda e comentário como texto, e posts de conta profissional são indexáveis
pelo Google desde jul/2025 (Kontentino, secundário). Vale pôr a palavra que o cliente digita (ramo + cidade)
na legenda e no texto alternativo.

**Evitar:** reposte sem transformar; pedido forçado de curtida ou envio em todo post (não achei regra do
Instagram sobre isso, então trate como risco, não como fato); imagem única como padrão.

### 4.2 LinkedIn: resposta e tempo de leitura

**O que a rede mede:** o ranqueador de 2026 usa texto do post, formato, histórico da pessoa e contagens de
engajamento em faixas. Ações **ativas** (comentar, curtir, compartilhar) e **passivas** (clicar, pular,
ficar muito tempo) têm cabeças próprias de previsão. O texto de 2020 dá a definição de permanência: metade
do post visível na tela; abaixo de um limiar (não publicado) vira "pulou", negativo.

**O que o conteúdo precisa fazer:**

1. **Parar o scroll nas primeiras linhas.** Quem passa rápido gera "pulou". O gancho vem antes do corte do
   "ver mais" e promete algo específico (como o título do post do Instagram).
2. **Merecer a leitura inteira.** Permanência é tempo de tela, então o texto precisa ter o que ler: uma
   situação concreta, um número que está nos fatos, um aprendizado. Encher linha para esticar a permanência
   é o caminho do "pulou" na segunda tela. Não achei tamanho ótimo confirmado: medir.
3. **Convidar resposta de quem sabe do assunto.** Pergunta que um colega de profissão responde com a
   experiência dele ("Como você cobra visita técnica?"), não "o que vocês acham?". Comentário vale como
   ação ativa (o post do LinkedIn não publica o peso).
4. **O autor responde.** Relatos de praticantes falam em "hora de ouro" (respostas nos primeiros 15 a 60
   minutos). Não há confirmação oficial; o custo de testar é baixo, então vale como experimento.
5. **Documento (carrossel em PDF)** aparece nos relatos de praticantes como o formato de maior permanência.
   É observação de desempenho, não regra declarada.

**Evitar:** comentário em massa e *pods* (a rede combate); voz genérica de IA (alvo de detecção, ver
seção 3); post sem especificidade. A SPEC 005 já exige aprovação humana em cada comentário publicado.

### 4.3 X: interações dentro do post

**O que a rede mede** (README de `xai-org/x-algorithm`, 2026): o modelo prevê, por pessoa e por post, estas
ações, e cada uma tem um peso (positivo ou negativo):

| Grupo | Ações |
| --- | --- |
| Engajamento | curtir, responder, repostar, citar, compartilhar, compartilhar por DM, copiar o link |
| Clique | no post, no perfil, no link, ampliar a foto, abrir o vídeo, no post citado |
| Atenção | leu (dwell), tempo de leitura, tempo após o clique, segundos de vídeo, segundos no perfil |
| Autor | seguir o autor |
| Negativo | não tenho interesse, silenciar, bloquear, denunciar, não leu |

**Regras de pipeline que mudam o jeito de postar** (mesmo README):

- Post com **mais de 48 horas** sai da disputa: o post precisa render nas primeiras horas, e cada um é
  autossuficiente.
- **Diversidade de autor:** do segundo post do mesmo autor na mesma passada em diante, a nota cai por um
  fator decrescente com piso. Postar três seguidos não triplica o alcance.
- **Fora da rede** (quem não te segue) recebe fator abaixo de 1: o X é mais "seguidores primeiro" que o TikTok.
- **Autor novo** com poucas impressões recebe impulso de posição: conta nova tem chance.
- Filtros removem palavra silenciada, autor bloqueado e conversa duplicada.

**O que o conteúdo precisa fazer** (a direção dos pesos de 2023 segue plausível, o valor não):

1. **Dar motivo concreto para responder**: pergunta com escolha, opinião específica do nicho. Resposta
   também alimenta a chance de o **autor** responder de volta, o peso mais alto da tabela de 2023.
2. **O autor responde de volta, rápido.** É a ação mais valiosa e hoje o motor não ajuda: depois de
   publicar, ninguém avisa nem sugere resposta (ver R6).
3. **Dar motivo para tocar no perfil e seguir**: perfil e post fixado coerentes com o assunto.
4. **Evitar o negativo**: nada hostil, repetitivo, fora do assunto ou que pareça spam.
5. **Link:** em 28/7/2026 o chefe de produto do X e Musk disseram que não há penalidade de link há mais de
   um ano; uma análise independente de 60 contas viu 1,05 vez mais impressões em post com link. Fica
   como "provavelmente sem penalidade", com o custo da API (US$ 0,20 por post com URL, SPEC 002).

**Limite:** a leitura de métricas do X é paga (SPEC 002), então a Ekoai **não aprende com os posts do X**.
Sem dado, qualquer regra de X é opinião.

### 4.4 TikTok (fora do escopo hoje, útil para Reels)

Seguidores não entram direto. Interesse forte (terminar um vídeo longo) pesa mais que sinal fraco (país em
comum). Para o Reels da Ekoai (`planned` em `channel-capabilities.json`): vídeo curto, gancho nos primeiros
segundos, pagamento no fim (quem chega ao fim vê a resposta), e o Instagram também prevê "assistir até o
fim" e "reenviar". TikTok como canal: 131 milhões de adultos alcançáveis no Brasil (DataReportal, alcance
de anúncios, conta perfis, não pessoas). Não pesquisei a API de publicação. Só faz sentido depois de Reels.

## 5. O que a Ekoai tem hoje

| Peça | Estado | Arquivo |
| --- | --- | --- |
| Agentes (estrategista, redator, diretor de arte) | Uma chamada só, JSON, só **Instagram** | `platform/src/lib/agents.ts:58` abre com "no Instagram" |
| Revisor | Por regra, sem modelo: texto, acento, número fora dos fatos, promessa, layout | `platform/src/lib/design/review.ts` |
| Objetivos do post | 9 (ensinar, produto, bastidores, novidade, promoção, prova social, data, conversa, auto), mapeados a *tipo*, não a sinal | `post-goals.ts` |
| Chamada no fim | `link_bio`, `whatsapp`, `dm`: todas levam a pessoa **para fora** do post | `agents.ts` (`CTA_TEXT`) |
| Hashtags | 3 a 8 | `agents.ts:126` |
| Métrica de decisão | `interações ÷ alcance`, curtida = comentário = salvamento = envio | `instagram-metrics-model.ts:71` |
| Insights coletados | `reach`, `saved`, `shares`, `views`, `total_interactions` | `instagram-metrics-model.ts:11` |
| Análise de conteúdo | Compara por tipo, formato e objetivo; mínimo de 4 por grupo e 12 posts | `content-analysis-model.ts:11` |
| Eval | 23 casos, juiz com visão, régua de ofício (gancho, clichê, voz) | `evals/` |
| LinkedIn e X | Adaptadores de **publicação** prontos; geração e menu fora (SPEC 011) | `channels/linkedin.ts`, `channels/x.ts` |
| Reels | `planned`, sem render nem publicação | `channel-capabilities.json` |
| Pontuação antiga com pesos | salvamento 4, envio 4, comentário 3, curtida 1; saiu com o pipeline legado | `src/utils/score.js` |

## 6. Lacunas

| # | Lacuna | Efeito |
| --- | --- | --- |
| L1 | Nenhum campo diz **por que o post seria enviado, salvo ou respondido** | O redator otimiza clareza e marca, não o sinal que a rede pesa |
| L2 | Decisão por taxa única; envio, salvamento e curtida misturados | A tela de análise não responde "o que as pessoas mandam" |
| L3 | Todas as chamadas de ação levam para fora (bio, WhatsApp, DM) | Nenhuma pede salvar ou enviar, os sinais que o Instagram diz pesar |
| L4 | Prompt e eval só de Instagram; LinkedIn e X sem prompt de rede | Não dá para entregar a promessa de "conteúdo por rede" |
| L5 | Sem laço de resposta depois de publicar (LinkedIn e X) | Perde o sinal de resposta do autor |
| L6 | Sem dado do X (leitura paga) e do LinkedIn pessoal (só CSV) | Impossível aprender com o resultado nessas redes |
| L7 | Eval mede cumprimento do pedido e ofício, não "mandaria?" | Mudança no prompt não tem como provar ganho de sinal |
| L8 | Sem posicionamento de originalidade nas telas e no prompt | Perde diferença contra gerador genérico, justo quando as redes endurecem |
| L9 | Reels não existe | O Instagram dá ao vídeo o sinal de "assistir até o fim" e a Ekoai fica só em imagem e carrossel |

## 7. Recomendações

Ordenadas por ganho sobre custo. Cada uma cabe numa PR e nenhuma muda o que o revisor por regra barra.

**R1. Perfil de sinais por rede, como dado datado** (L4). Arquivo `platform/src/lib/channel-signals.json`, no
molde de `channel-capabilities.json`: por rede, `signals` (o que a rede mede), `content_must` (o que o
post faz), `avoid`, `confidence`, `sources` e `reviewed_at`. Os construtores de prompt leem dele. Quando o
algoritmo mudar, muda um arquivo e uma data, não um prompt espalhado. Teste de CI reprova `reviewed_at`
com mais de 120 dias.

**R2. Intenção de sinal por post** (L1, L3). Campo novo no JSON do estrategista: `signal` (`enviar`, `salvar`,
`responder`, `assistir`) e `share_reason` (uma frase: quem manda a quem, e o que escreve junto). Sem chamada
extra de modelo. Validação em `parseCopy`: `share_reason` obrigatória e curta; a intenção padrão vem do
objetivo (ensinar e novidade: salvar e enviar; produto e bastidores: assistir e curtir; conversa:
responder; promoção: enviar). A chamada no fim passa a ter um tipo que serve ao sinal: "Salve para
consultar" e "Mande para quem..." ao lado de bio, WhatsApp e DM. A decisão de pôr ou não fica no objetivo,
para não virar pedido forçado em todo post.

**R3. Nota por sinal** (L2). A coleta já guarda `likes`, `comments`, `saves`, `shares` e `reach`. Em
`content-analysis-model.ts`, calcular por grupo (tipo, formato, objetivo, e agora `signal`): envio por
alcance, salvamento por alcance, curtida por alcance e a taxa atual. A tela diz "nos seus posts, o
carrossel foi enviado 2x mais que a imagem". A mesma regra de mínimo (4 por grupo, 12 no total) vale.
**Verificar antes:** se a métrica `shares` da Graph API conta só envio por DM ou todo compartilhamento. Se
não separar, o rótulo é "compartilhamentos", não "envios".

**R4. Critério "mandaria?" no eval** (L7). Cada caso ganha `sendTarget` escrito à mão (quem receberia) e o
juiz recebe a pergunta do teste do envio como exigência de ofício. Regra do README do eval mantida: quem
escreve a exigência é uma pessoa, não o modelo medido. Meta: baseline-3 com o placar de envio e o
`eval:compare` na PR.

**R5. Prompt e revisão de LinkedIn** (L4), quando o canal voltar ao menu. Prompt próprio: gancho nas duas
primeiras linhas, uma situação ou número **dos fatos** da empresa, pergunta que um colega responde, sem
enchimento. Revisor por regra: primeira linha específica (sem rótulo de tema), tamanho do gancho, número
fora dos fatos (já existe). Formatos: texto e documento (PDF). A SPEC 005 já tem o rodízio de formato.

**R6. Laço de resposta depois de publicar** (L5). No LinkedIn e no X, o aviso de "post publicado" leva um
botão "Responder comentários" que abre o rascunho de resposta (o módulo de engajamento da SPEC 005 existia
e saiu do menu). Aprovação humana em cada resposta, limite diário e intervalo, como na SPEC 005. No
Instagram, o mesmo para comentários, só com a permissão que a Meta liberar.

**R7. Prompt e revisão de X** (L4, L6). Um post, uma ideia, até 280 caracteres, com motivo para responder.
Thread só quando o conteúdo precisa. Slots com espaçamento (a diversidade de autor derruba posts em
sequência). Como não há métrica, a primeira versão aprende por **nota manual** da pessoa (útil ou não) em
vez de número.

**R8. Originalidade como diferença de produto** (L8). Dois pontos: (1) todo post leva ao menos **um fato
da empresa** (base de fatos, foto do banco ou campanha), com o revisor reprovando post que serviria a
qualquer empresa (o prompt já pede título específico; conferir se o revisor por regra cobre isso);
(2) o texto de venda da Ekoai deixa de falar em "IA que escreve" e fala em "post com o fato da sua empresa".

**R9. Reels** (L9). Antes de construir, decidir se entra. Se entrar: roteiro com gancho nos primeiros
segundos, fim com recompensa, e coleta de `ig_reels_avg_watch_time` e do total de tempo (nomes a
confirmar na documentação de insights; não verifiquei).

**R10. Experimento de "primeira hora"** (hipótese). O Explore pesa a **velocidade** das interações. Depois
de publicar, a Ekoai sugere ao dono: "Mande para 3 clientes pelo Instagram". Envios reais de clientes
reais são o sinal mais limpo. **Cuidado:** compartilhar por WhatsApp provavelmente não conta como envio no
Instagram (não achei a regra), então o texto manda por DM do Instagram. Medir com R3 antes de transformar em
recurso.

### Fases

| Fase | Entrega | Prova |
| --- | --- | --- |
| 1 | R1, R2, R4 | `eval:compare` com baseline-3 (envio por caso) |
| 2 | R3 | Tela de análise mostrando envio por alcance, com a regra de mínimo |
| 3 | R5, R6 | LinkedIn gerado e publicado em conta de teste, com resposta aprovada |
| 4 | R7, R8 | Eval de X; fato da empresa em 100% dos casos do eval |
| 5 | R9, R10 | Decisão de Reels; experimento de primeira hora com 10 contas |

## 8. Confiança das fontes

| Afirmação | Fonte | Confiança |
| --- | --- | --- |
| 3 sinais do Instagram, envio mais para não conectado | Mosseri, jan/2025, via Social Media Today (print) e vários blogs | Alta |
| Sinais por superfície do Instagram (Reels, Feed, Explore) | about.instagram.com, "Instagram ranking explained" | Alta (texto antigo, ainda no ar) |
| Pesos do X de 2023 e uso como `Σ peso × P(ação)` | `twitter/the-algorithm-ml`, README de 5/4/2023 | Alta para 2023 |
| Algoritmo do X de 2026, lista de ações e regras de pipeline | `xai-org/x-algorithm`, README (lido por mim) | Alta; pesos numéricos ausentes |
| Mudança do LinkedIn em março de 2026 | blog de engenharia do LinkedIn, 12/3/2026 (lido por mim) | Alta |
| "360Brew" como sistema em produção | blogs de marketing | Baixa (disputado) |
| Dwell time do LinkedIn | blog de engenharia, 2020 | Alta para 2020; atual é menos claro |
| TikTok, seguidores não são fator direto | newsroom.tiktok.com (lido por mim) | Alta |
| Regra de originalidade do Instagram em abril de 2026 | PetaPixel e Sociallyin, citando Mosseri (PetaPixel deu 403, não li) | Média |
| Carrossel lidera engajamento | Socialinsider e Buffer, métricas incompatíveis entre si | Média (ordem sim, valor não) |
| Envio vale de 3 a 5 vezes a curtida | blogs de marketing | **Baixa, não usar** |
| Redução de alcance de post com IA no LinkedIn, até 80% | blogs, sem fonte primária | **Baixa, não usar** |
| "Hora de ouro" de 15 a 60 minutos no LinkedIn | blogs de praticantes | Baixa, só como experimento |
| Sem penalidade de link no X | declaração pública de produto do X, jul/2026, e 1 análise de 60 contas | Média |
| 40% dos posts longos do LinkedIn são de máquina | Pangram, via cobertura de imprensa | Média |
| Hashtag é categorização, não impulso | blogs que citam Mosseri, jul/2026 | Baixa a média |

## 9. Perguntas para o Matheus (respondidas em 28/10/2026)

Respostas: (1) LinkedIn e X entram já; (2) Reels depois; (3) chamada de enviar ou salvar só nos objetivos certos. O plano está na
[SPEC 028](../specs/028-um-pedido-um-post-por-rede-e-avaliador.md).

1. **LinkedIn e X voltam ao menu agora ou depois de Reels?** A SPEC 011 deixou os dois fora. R5 a R7 só andam
   se voltarem.
2. **Reels entra no roteiro?** É o formato com o sinal "assistir até o fim" e o mais caro de construir.
3. **Chamada para enviar e salvar em todo post ou só nos objetivos certos?** Recomendo só nos objetivos
   certos, por causa do risco de pedido forçado.
4. **TikTok como canal futuro?** Só com Reels pronto.

## Fontes

Primárias, lidas por mim:

- Mosseri, sinais de ranking, jan/2025: o trecho vem do print do Social Media Today no vídeo (a URL direta do artigo deu 404 e não o li inteiro)
- [Instagram ranking explained](https://about.instagram.com/blog/announcements/instagram-ranking-explained)
- [X: xai-org/x-algorithm](https://github.com/xai-org/x-algorithm)
- [X: pesos de 2023 (the-algorithm-ml)](https://github.com/twitter/the-algorithm-ml/blob/main/projects/home/recap/README.md)
- [LinkedIn Engineering: dwell time (2020)](https://www.linkedin.com/blog/engineering/feed/understanding-feed-dwell-time)
- [LinkedIn Engineering: a próxima geração do feed (12/3/2026)](https://www.linkedin.com/blog/engineering/feed/engineering-the-next-generation-of-linkedins-feed)
- [TikTok Newsroom: como o TikTok recomenda vídeos](https://newsroom.tiktok.com/en-us/how-tiktok-recommends-videos-for-you)

Secundárias (pesquisa, não li a página inteira):

- [PetaPixel: política do Instagram contra republicação (30/4/2026)](https://petapixel.com/2026/04/30/new-instagram-policies-target-reposted-content/)
- [Socialinsider: benchmarks do Instagram 2026](https://www.socialinsider.io/instagram-benchmarks)
- [Influencer Marketing Hub: playbook de envios por alcance](https://influencermarketinghub.com/instagram-sends-per-reach-playbook/)
- [Search Engine Journal: por que envios importam](https://searchenginejournal.com/instagram-algorithm-shift-why-sends-matter-more-than-ever/521389)
- [ppc.land: X e a penalidade de link](https://ppc.land/x-drops-year-old-link-penalty-musk-tells-zuckerberg-on-platform/)
- [OpenTweet: o X penaliza links em 2026?](https://opentweet.io/answers/does-x-penalize-links-2026)
- [Pangram via WebProNews: LinkedIn e texto de máquina](https://www.webpronews.com/linkedins-ai-slop-crisis-new-data-shows-over-40-of-long-posts-machine-written-as-platform-fights-back/)
- [Creator Science: Richard van der Blom, estado do LinkedIn em 2026](https://podcast.creatorscience.com/richard-van-der-blom-2/)
- [Kontentino: Instagram SEO](https://www.kontentino.com/q-and-a/instagram-search-seo/)
- [DataReportal (via notícia): alcance por plataforma no Brasil](https://dplnews.com/brasil-159-milhoes-usam-redes-sociais-diariamente-youtube-e-campeao/)
