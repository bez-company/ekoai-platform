# Posicionamento da Ekoai

> Proposta de 05/11/2026 para o Matheus aprovar. Fontes: [concorrentes](../analises/2026-10-16-concorrentes-e-insights.md),
> [algoritmos por rede](../analises/2026-10-28-algoritmos-por-rede-e-conteudo.md),
> [documentação mestra](../analises/2026-11-03-documentacao-mestra-ai-native.md), [SPEC 021](../specs/021-planos-e-cobranca-por-consumo.md),
> [SPEC 030](../specs/030-estudio-de-posts-multiagente.md), landing em `ekoai.com.br`.

## 1. Em uma página

| | |
| --- | --- |
| **Para quem** | Dono de pequeno negócio que vende pelo Instagram e não tem tempo nem designer. Depois, agências e freelancers com várias marcas |
| **Categoria** | Gerente de Instagram com IA. Não é agendador, não é gerador de arte, não é chat |
| **Promessa** | O Instagram da sua empresa, pronto para você aprovar |
| **Como cumpre** | Lê a marca uma vez, cria imagem e legenda na voz da empresa, espera a aprovação, agenda e publica, aprende com o resultado |
| **Prova** | A tela: marca lida do site, 16 estilos, agentes com diretor de arte, até 3 opções, fato com validade, aprovação por papel |
| **Contra quem** | Fazer sozinho no Canva, agendadores (mLabs, Metricool, Buffer, Hootsuite), geradores de anúncio (Predis), IA genérica, agência |
| **Tom** | Direto, concreto, sem jargão. Fala de padaria, clínica e oficina, não de "transformação digital" |
| **Não promete** | Venda, seguidor ou alcance. Promete post pronto, na marca, sem inventar fato, com aprovação |

## 2. Ponto de partida (o que é fato hoje)

| Fato | Fonte | Consequência para o marketing |
| --- | --- | --- |
| Publica no Instagram. LinkedIn e X têm código, mas estão fora do menu | README, SPEC 028 | Vender Instagram. LinkedIn e X entram como "em breve" e como canais da própria Ekoai |
| Conta de fora só conecta Instagram depois do App Review da Meta (enviado em 02/11, previsão de cerca de 20 dias) | `docs/arquitetura/meta-app-review.md` | Até lá, o acesso é por piloto com conta que tem papel no app. A abertura pública espera a aprovação |
| Landing no ar desde 21/10, indexação desligada, preço "R$ XX" | SPEC 015 | A landing é o destino do vídeo, mas o CTA precisa de decisão (D1 e D2) |
| Planos: Individual 1 rede, Individual 3 redes, Time, Agência, com créditos | SPEC 021 | Preço entra na comunicação só depois da D2 |
| Não existe vídeo, só foto e carrossel | pedido do Matheus | Os 4 vídeos desta pasta resolvem o buraco |
| Concorrentes cobram R$ 30 por marca (mLabs) ou US$ 29 fixo (Blotato) | análise de 16/10 | Não competir em preço de agendador. Competir em post pronto e marca conhecida |

## 3. Quem são as alternativas

| Alternativa | O que a pessoa ganha | Onde falha | Resposta da Ekoai |
| --- | --- | --- | --- |
| Fazer sozinho (Canva, celular, ChatGPT) | Custo zero em dinheiro | Custa a noite de domingo, cada post sai com uma cara, a rotina morre em 3 semanas | "Conte uma vez. A cara é sempre a da sua marca" |
| Agência ou freelancer | Gente de verdade e criatividade | Preço, prazo de ida e volta, pouco volume | Não substitui: serve a agência com várias marcas e ao dono que não paga agência |
| Agendador com IA (mLabs, Metricool, Buffer, Hootsuite) | Agenda e legenda | A IA escreve legenda, a arte continua com você; pouca memória da marca | "O post chega pronto, com arte, e você só aprova" |
| Gerador de anúncio (Predis) | Volume de criativo | Foco em anúncio e ROAS, não em rotina orgânica | Rotina orgânica semanal com campanha e meta |
| IA genérica | Rápida e barata | Não conhece a marca, inventa preço e prazo, não publica | "Fato com validade: a Ekoai não afirma o que venceu" |
| Native e ferramentas "AI-native" | Entrada pela marca, agente | Em fase de produto, mercado em formação | Foco em pequeno negócio brasileiro, PT-BR, Pix, aprovação por papel |

## 4. Público

**Primário: dono de pequeno negócio que vende pelo Instagram** (doceria, clínica de estética, engenharia, pet shop,
salão, loja de roupa, academia, os nichos da landing). Posta quando dá, perde semanas, copia o formato do vizinho.
Compra por dor imediata: "preciso postar e não sei o quê". Está no Instagram, no WhatsApp e em grupo de empreendedor.

**Secundário: agência pequena e social media freelancer** com 3 a 10 marcas. Dor: volume e retrabalho de aprovação.
Compra por margem: mais marcas por pessoa. Está no LinkedIn. O plano Agência (5 marcas, 3 pessoas) é para ele.

**Terciário: time com aprovador** (sócio, gerente, cliente que precisa dizer "pode postar"). Dor: o post fica parado
esperando alguém olhar. A tela de Aprovar com papéis (administrador, criador, leitor) é a prova.

Começar pelo primário no Instagram. O secundário entra pelo LinkedIn a partir da semana 6.

## 5. Declaração de posicionamento

> Para o dono de pequeno negócio que vende pelo Instagram e não tem tempo nem designer, a Ekoai é o gerente de Instagram
> que lê a sua marca uma vez, cria o post pronto na sua voz e espera a sua aprovação. Diferente de agendadores e
> geradores de arte, a Ekoai conhece a marca, não afirma fato vencido e aprende com o que funcionou.

**Frase âncora:** "O Instagram da sua empresa, pronto para você aprovar." (já na landing, manter.)

**Três hooks para testar nas semanas 1 a 3** (um por semana, medir salvamento e envio):

1. "Seu Instagram parou de novo?" (dor e identificação, usada no vídeo 1)
2. "Quanto custa um Instagram parado?" (provocação, usada no vídeo 2)
3. "Post de IA não precisa ter cara de IA." (tese do estúdio, usada no vídeo 3)

## 6. Quatro pilares de mensagem

| # | Pilar | Frase | Prova na tela | Vídeo |
| --- | --- | --- | --- | --- |
| 1 | Conte uma vez | Cole o site. A Ekoai lê cores, logo, jeito de falar e fatos. Você confere | Cadastro rápido, leitura da marca, tela de confirmação (SPEC 033 e 034) | 1 |
| 2 | Post com direção de arte | 16 estilos, agentes que criam, criticam e refinam, até 3 opções, editor livre | Vitrine de modelos, "Agentes trabalhando", Aprovar com 3 opções, Studio (SPEC 027 e 030) | 3 |
| 3 | Você no controle | Nada sai sem aprovação. Fato vencido não entra. O revisor trava contraste ruim e palavra proibida | Aprovar, Fatos da empresa, aviso do revisor, papéis da equipe | 1, 2, 4 |
| 4 | Aprende com o resultado | Regras da conta, feedback por post, leitura do público e horários, campanha com meta | Aprendizado, Analytics, Campanhas, Agenda (SPEC 018, 019, 022) | 1, 4 |

## 7. Tom de voz

| Faça | Evite |
| --- | --- |
| Frase curta, verbo no começo, exemplo de negócio local | "Solução inovadora", "transforme", "revolucione", "próximo nível" |
| Falar do trabalho que some ("você não precisa abrir o Canva") | Falar do modelo de IA, de parâmetro ou de tecnologia como atração |
| Admitir limite ("a Ekoai cria, quem aprova é você") | Prometer venda, seguidor ou alcance |
| Número só com fonte e data | Número redondo sem origem |
| Provocar a rotina ruim | Atacar agência, concorrente ou pessoa |

Regras de escrita do Matheus: sem travessão, sem clichê de IA, voz ativa,
sentence case, botão com verbo. Texto de UI e de post em português do Brasil.

## 7.1 Ângulos de conteúdo

| Ângulo | Exemplo | Onde rende mais |
| --- | --- | --- |
| Educativo | "3 sinais de que o seu bolo está pronto" aplicado a "3 sinais de que o seu Instagram parou" | Instagram, carrossel |
| Provocativo | "Seu Instagram não precisa de mais ideias, precisa de rotina" | X, LinkedIn, Reels |
| Técnico | Como o revisor mede margem, contraste e texto cortado por código antes do post chegar a você | LinkedIn, X (thread) |
| Demonstração | A tela do produto fazendo o trabalho em 30 segundos | Instagram Reels, LinkedIn vídeo |
| Prova | Antes e depois de um post de cliente piloto, com autorização | Todos |
| Bastidor | Decisões de produto, o que errou, o que mudou | X, LinkedIn |

Cada rede pede uma coisa diferente ([análise de algoritmos](../analises/2026-10-28-algoritmos-por-rede-e-conteudo.md)):
Instagram premia o que a pessoa manda para outra (utilidade guardável, identificação, local); LinkedIn premia o gancho
antes do "ver mais" e a pergunta que um colega de profissão responde; X premia o motivo concreto para responder e o autor
responder de volta rápido. Por isso cada peça do calendário vira três textos, não um texto copiado.

## 8. Objeções e respostas

| Objeção | Resposta curta |
| --- | --- |
| "Post de IA parece post de IA" | O estúdio parte de estilo e de direção de arte, tem crítica e revisão por regra, e você ainda edita. Mostre o vídeo 3 |
| "E se inventar preço ou prazo?" | Só entra fato confirmado e dentro da validade. Fato vencido não entra no post |
| "Perco o controle da minha marca" | Nada sai sem aprovação. Cores, fonte, logo e voz são os seus |
| "Já tenho agendador" | O agendador agenda o que você cria. A Ekoai cria e agenda |
| "Quanto custa?" | Responder com o plano certo para o caso. Hoje: depende da decisão D2 |
| "Funciona para o meu nicho?" | A landing lista 7 nichos. Oferecer um teste com a marca da pessoa |
| "E meus dados?" | Dado da conta fica isolado por conta e pode ser exportado e excluído (Configurações, Dados e privacidade) |
| "Vai me dar mais venda?" | Não prometemos venda. A Ekoai tira o gargalo de produzir e mede o que o público respondeu |

## 9. O que pode e o que não pode afirmar

| Pode (com a tela como prova) | Não pode |
| --- | --- |
| "Cola o site e a Ekoai lê a marca" | "Aumenta suas vendas", "dobra o alcance" |
| "Nada sai sem a sua aprovação" | "100% automático" sem ressalva de aprovação |
| "Fato vencido não entra no post" | "Nunca erra" |
| "Publica no Instagram" | "Publica no LinkedIn e no X" (ainda fora do menu) |
| "Até 3 opções de design" (nível Autoral) | Nota de design do eval interno (8,4 contra 5,8) como fato público. É juiz de IA em 6 pedidos |
| "Pix ou cartão" só se a cobrança confirmar (ADR 0023 pede cartão obrigatório) | Qualquer preço antes da D2 |

## 10. Como saber se o posicionamento funciona

1. Semanas 1 a 3: qual dos 3 hooks gera mais salvamento e envio por alcance.
2. Semana 4: ler 10 comentários e DMs e anotar com que palavra a pessoa descreve o produto. Se ela diz "agendador",
   a categoria está errada; se diz "gerente de Instagram" ou "alguém que faz o meu post", está certa.
3. Piloto: perguntar "o que você usava antes?". A resposta ordena a lista de alternativas da seção 3.
4. Revisar esta página na semana 6 e na semana 12.
