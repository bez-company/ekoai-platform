# SPEC 028: um pedido, um post por rede e o avaliador de sinais

- **Status:** proposta (28/10/2026). Protótipo v22 publicado, aguarda a aprovação do Matheus: nenhum código de tela antes dela
- **Data:** 2026-10-28
- **Cards:** BEZ-413 (pai) e filhos; os novos estão na seção "Entregas"
- **Protótipo:** versão 23 (`version_id` 1793213671-4d6e) do artifact https://claude.ai/artifact/55avs7vhgtwKFn9HMAR9Fz, grupo "Fase 9: uma ideia, um post por rede (SPEC 028)", em desktop e celular: Criar post: onde publicar (7 estados), Gerando um post por rede (3), Aprovar: uma aba por rede (11) e Redes sociais: LinkedIn e X (8). O Matheus aprovou o protótipo em 28/10/2026 com a regra de que nenhuma tela mostra custo (ver "Custo e cobrança"). Fonte em `.context/proto-028` (`phase9.js`, `phase9.css`, `build.py` sobre a v21)
- **Origem:** análise de algoritmos ([2026-10-28](../analises/2026-10-28-algoritmos-por-rede-e-conteudo.md)) e decisão do Matheus de conectar LinkedIn e X ao sistema
- **Depende de:** [SPEC 003](003-ideia-reaproveitamento-e-feedback.md) (uma ideia, versão por rede; esta spec a retoma na plataforma),
  [SPEC 011](011-plataforma-generica-fase-1.md) R5 (conexão por conta), [SPEC 012](012-agentes-instagram-fase-2.md) (agentes),
  [SPEC 005](005-linkedin-formatos-e-engajamento.md) e [SPEC 002](002-canal-x.md) (adaptadores), [SPEC 021](021-planos-e-cobranca-por-consumo.md) (planos),
  `platform/src/lib/channel-capabilities.json`

## Problema

1. **A geração só conhece o Instagram.** `generatePost` grava uma pendência com `channel: 'instagram'` fixo
   (`generation.ts`) e o prompt abre com "no Instagram" (`agents.ts:58`). LinkedIn e X têm adaptador de publicação, mas
   sem geração e sem menu (SPEC 011).
2. **Só o Instagram tem conexão por conta.** `social-accounts.ts` e `instagram-oauth` cobrem só ele. Os adaptadores de
   LinkedIn e X leem credencial de variável de ambiente (`LINKEDIN_ACCESS_TOKEN`, `X_API_KEY`...), ou seja, uma conta só, a do
   Matheus. Para um cliente conectar a própria conta falta OAuth por conta, token cifrado e status.
3. **Nada avalia o potencial do post na rede.** O revisor por regra barra erro (acento, número fora dos fatos, layout),
   mas não diz se o post serve ao sinal que a rede pesa (envio, resposta, leitura inteira).

## Resultado esperado

1. Em Criar post, a pessoa escolhe **onde publicar** (uma, duas ou três redes conectadas) e descreve a ideia uma vez.
2. A Ekoai devolve **um post por rede**, cada um escrito para o sinal daquela rede, com o mesmo assunto e os mesmos fatos.
   Em Aprovar, uma tela por ideia com uma aba por rede: ver, editar, aprovar, escolher horário e desligar cada uma.
3. Cada post vem com **avaliação por rede**: o que está forte, o que está fraco e uma sugestão por ponto, que a pessoa
   aplica com um clique.
4. Conectar LinkedIn e X em Configurações › Redes, como o Instagram.

**Fora de escopo:** Reels (depois, BEZ-421), página da empresa no LinkedIn, métricas do X (leitura é paga), TikTok.

## A pergunta central: posts separados ou o mesmo post?

**Nenhum dos dois puros.** O que se compartilha e o que se escreve de novo:

| | Compartilhado entre as redes | Escrito para cada rede |
| --- | --- | --- |
| Assunto | a ideia, o objetivo, a campanha | |
| Substância | o **núcleo**: ângulo, 2 a 4 pontos, o fato que prova, a pergunta | |
| Fatos | os mesmos da base (o revisor barra número fora dela, em todas) | |
| Visual | a arte ou os slides, quando a rede aceita imagem | |
| Texto | | abertura, tamanho, tom, chamada, hashtags |
| Formato | | imagem ou carrossel (IG), texto ou PDF (LinkedIn), post ou thread (X) |
| Horário | | cada rede tem os seus slots |

Por quê:

- O texto que cada algoritmo premia é diferente (envio e salvamento no Instagram, permanência e resposta no LinkedIn,
  resposta e resposta do autor no X). Copiar a legenda do Instagram para o LinkedIn gera o post que ninguém lê até o fim.
- O visual é o item caro (imagem por IA, render) e quase sempre serve às duas redes visuais. O carrossel do Instagram já
  são os slides do PDF do LinkedIn.
- O texto é barato (uma chamada de modelo de texto). Escrever uma vez por rede custa centavos.
- Uma ideia, uma aprovação, uma campanha: coerência de marca e menos trabalho para quem aprova.

**Quanto cada par se parece (padrão, por regra, editável na aprovação):**

| Rede | Texto | Visual |
| --- | --- | --- |
| Instagram | próprio: legenda curta com gancho e a chamada do sinal (salvar ou enviar) | imagem ou carrossel |
| LinkedIn | próprio: primeira pessoa, situação ou número dos fatos, pergunta que um colega responde | **os mesmos slides em PDF**, ou a imagem, ou só texto |
| X | próprio e totalmente distinto: uma ideia em até 280 caracteres, motivo para responder | opcional (a capa); por padrão sem imagem |

Instagram e LinkedIn se parecem no visual e na ideia; o X só compartilha a ideia e os fatos. O texto nunca é reescrita da
legenda de outra rede: **todos partem do núcleo**, não de uma "rede-mãe". Assim o X não herda hashtag nem o tom de legenda.

**Redes escolhidas:** uma só é válida (só LinkedIn, só Instagram). Rede não conectada aparece travada com o próximo passo
("Conecte o X em Configurações › Redes"). Desligar uma rede na aprovação registra `skip` (sinal de preferência, como na SPEC 003).

## Decisões propostas

1. **Unidade = o pedido (`briefs`), uma variante por rede.** A pendência (`pending_approvals`) já tem `channel` e `brief_id`:
   uma linha por rede e por ideia. O agendamento (`scheduled_posts`) já é por rede. A mudança é gerar mais de uma linha.
2. **Núcleo na mesma chamada do primeiro post.** O JSON do estrategista ganha `core` (`angle`, `points`, `proof`, `question`).
   As outras redes recebem o núcleo, não a legenda. Alternativa: chamada própria para o núcleo (mais limpa, uma chamada a mais).
3. **Redator por rede, em chamadas separadas e baratas.** Cada rede lê um perfil de sinais (`channel-signals.json`, BEZ-414).
   O visual é gerado uma vez e reaproveitado.
4. **Avaliador por rede, em 3 camadas** (próxima seção), com no máximo uma volta de conserto.
5. **Uma ideia conta como um post no plano (decisão do Matheus, 28/10/2026), e todo o custo é registrado.** Hoje o gatilho
   `check_post_limit` conta a reserva do passo `visual`; variante só de texto não gasta o limite. Cada chamada (legenda,
   núcleo, redator de cada rede, avaliador, conserto, imagem, render) grava tokens e `cost_usd` em `generation_runs`, com
   `channel` e `step`. Ver "Custo e cobrança".
6. **Mesmo formato de saída dos adaptadores.** A variante grava o `Variation` que `publish.ts` e `scheduling.ts` já leem
   (`hook`, `body`, `format`, `slideUrls`, `documentUrl`), então a publicação não muda.

## O avaliador de sinais

Importante: **a Ekoai não conhece a nota real da rede.** Nenhuma delas publica a nota de um post, e o X e o LinkedIn não
publicam os pesos atuais. O avaliador prevê o **potencial** com uma rubrica baseada no que as redes dizem medir. Por isso a tela
mostra faixa (forte, médio, fraco) e checklist, nunca "nota do Instagram: 8,4".

**Camada 1, regras por código (grátis).** O revisor atual e regras novas por rede: tamanho, gancho, `share_reason` presente,
número fora dos fatos, palavra proibida, travessão. O que o código pode afirmar, ele afirma sem modelo.

**Camada 2, rubrica avaliada por modelo (uma chamada por rede).** Cada critério vale 0, 1 ou 2, e o modelo **cita o trecho**
que prova a nota (sem citação, vale 0). O avaliador vê só a saída e a rubrica, não o raciocínio do redator. Critérios iniciais:

| Rede | Critérios |
| --- | --- |
| Instagram | **envio** (quem manda a quem, e o texto sustenta?), **salvamento** (dá para consultar depois?), **gancho** da capa (até 12 palavras, promessa específica), **fato próprio** da empresa, **chamada** coerente com o objetivo |
| LinkedIn | **gancho** nas duas primeiras linhas, **especificidade** (situação ou número dos fatos), **vale ler tudo** (sem enchimento), **pergunta que um colega responde**, **voz humana** (sem clichê de IA) |
| X | **uma ideia** em até 280 caracteres, **motivo para responder**, **risco negativo** (hostil, repetitivo, fora de assunto), **fala por si** (sem depender de contexto), **tom** |

**Camada 3, conserto.** Critério com 0 ou 1 volta ao redator com a frase "corrija SÓ isto", como o revisor atual (uma volta
no máximo, para limitar custo). O que não fecha vira sugestão na tela.

**Na tela (Aprovar):** por aba, o checklist e, nos pontos fracos, a sugestão em uma frase com o botão "Aplicar" (reescreve só aquilo,
no mesmo caminho do "pedir ajuste" da SPEC 024) e "Reavaliar" depois de uma edição à mão. A avaliação fica em
`generation.critic` (campo que o tipo `Generation` já tem), sem tabela nova.

**Calibração (hipótese, não promessa).** Com métricas (Instagram já; LinkedIn por CSV; X nenhuma), comparar a faixa de cada
critério com envio, salvamento e curtida por alcance (BEZ-416). Critério sem relação com o resultado em 30 posts ou mais é
revisto ou sai. Sem isso a rubrica é opinião bem organizada.

**Riscos conhecidos:**

- Modelo que avalia o que o próprio modelo escreveu tende a ser leniente. Mitigação: citação obrigatória, verificação por código
  que derruba juiz otimista (o eval já faz isso) e casos rotulados à mão no eval.
- A rubrica reflete a leitura das fontes (confiança média ou baixa em vários pontos, ver a análise, seção 8). Ela precisa de
  `reviewed_at` e de revisão quando uma rede mudar.
- Custo: uma chamada de texto por rede, mais no máximo uma de conserto. Medir no eval e pôr teto por conta e por rodada.

## Custo e cobrança

Regras (decisões do Matheus, 28/10/2026):

1. **Uma ideia conta como 1 post no plano**, qualquer que seja o número de redes.
2. **Todo custo é registrado**: legenda, núcleo, texto de cada rede, avaliador, conserto, imagem, render e o custo de publicar.
   Nada de custo sem linha de registro, para poder dividir depois por post, por etapa e por rede.
3. **O custo da API do X entra no motor de cobrança, não na tela do post.** A Ekoai paga a API do X e o valor vai para a fatura do
   usuário à medida que ele publica (cobrança por consumo, [ADR 0023](../adr/0023-cobranca-por-consumo-com-cartao-obrigatorio.md)).
   **Nenhuma tela do fluxo de post ou de conexão mostra o custo do X**, e não há variação de "post com link" na interface.
4. **O custo do X acontece na publicação**, não na geração. É registrado como uma linha própria (`step = publish`, `channel = twitter`)
   quando o post sai, uma vez só mesmo se a publicação repetir, e soma na fatura do mês.

Dados: `generation_runs` já tem `input_tokens`, `output_tokens`, `images`, `cost_usd` e `duration_ms`. Ganha `channel` e os passos
`core`, `adapt`, `critic`, `fix` e `publish`. O valor do X vem de uma tabela de preço em arquivo de configuração datado, como
`channel-capabilities.json`, porque o preço da API muda. Antes de construir, conferir o que o BEZ-409 e o BEZ-410 (alerta de post
caro) já medem, para não duplicar.

**Fora desta spec:** onde o usuário vê a cobrança. A seção **Configurações › Fatura e uso** (gasto do mês, uso por tipo e, depois, a
divisão por post, legenda, alteração e rede) e a visão financeira do Matheus ficam para uma spec própria, junto da cobrança real
(SPEC 021, BEZ-301). Esta spec só garante que o dado existe e está completo.

## Conexão do LinkedIn e do X

| | LinkedIn | X |
| --- | --- | --- |
| Autorização | OAuth por conta, perfil pessoal, permissão de publicar | OAuth 1.0a por conta (SPEC 002: o token não expira) |
| Token | cifrado (KMS) em `social_account_secrets`, como o Instagram | idem |
| Validade | **verificar:** o token do LinkedIn tende a durar cerca de 60 dias e renovar só para parceiros; não confirmei na documentação atual. Falhou, vira `reauth_required` e avisa | não expira |
| Custo | sem custo por post | pago pela Ekoai e repassado na fatura (seção "Custo e cobrança"); a tela de conexão não mostra valor |
| Métricas | perfil pessoal só por CSV (`channel-capabilities.json`) | leitura paga, fora |
| Revisão da rede | verificar se o produto de publicação exige aprovação | verificar o nível de acesso da API |

Os adaptadores passam a receber a credencial da conta (hoje leem do ambiente). Teste de CI reprova `process.env.LINKEDIN_*` e
`X_*` fora do script de ensaio.

## Dados (aditivo e reaplicável)

- `briefs.channels text[] not null default '{instagram}'`, com restrição: pelo menos 1 e só `instagram`, `linkedin`, `twitter`.
- `briefs.core jsonb null` (limite de tamanho): o núcleo do pedido.
- `pending_approvals.visual_mode text` (`shared`, `own`, `none`): se a variante usa a arte do pedido, uma própria ou nenhuma. Reaproveita `post_design_id`.
- `generation_runs`: coluna `channel` e os passos `adapt` e `critic` na restrição de `step` (recriar a restrição de forma reaplicável).
- Sem tabela nova para a avaliação (`generation.critic`). Toda tabela com `tenant_id` segue com RLS e em `TENANT_TABLES`.

## Telas (protótipo v23 aprovado)

1. **Criar post:** novo passo "Onde publicar" (chips por rede, travadas as não conectadas), antes do formato.
2. **Aprovar:** uma ideia, uma aba por rede com prévia no formato da rede, avaliação, horário e liga e desliga.
3. **Configurações › Redes:** conectar, status e desconectar LinkedIn e X.
4. **Análise (SPEC 022):** comparação por rede, e por sinal quando houver.

Estados a mostrar, em desktop e celular: vazio, carregando, erro, cheio, rede travada, avaliação com ponto fraco,
conserto aplicado e conexão vencida (`reauth_required`).

## Entregas

Em ordem, cada uma numa PR. Instagram e LinkedIn primeiro porque dividem o visual; o X depois, porque tem custo de API por post (que vai para a fatura) e não tem métrica.

| Fase | Entrega | Prova |
| --- | --- | --- |
| 0 | Esta spec, protótipo no Claude Design e aprovação | link do protótipo aprovado |
| 1 | Conexão do LinkedIn (OAuth, token cifrado, status, renovação) | conectar e publicar em conta de teste, ensaio de publicação |
| 2 | Motor multi-rede: `channel-signals.json`, núcleo, redator por rede, dados, Aprovar com abas, Instagram + LinkedIn | eval por rede (baseline-3); E2E do pedido ao agendado em duas redes |
| 3 | Avaliador: camadas 1 a 3 e painel | eval com casos rotulados; custo por rede registrado em `generation_runs` |
| 4 | Conexão do X e variante do X, com a linha de custo de publicação | ensaio de publicação; linha `publish` gravada uma vez por post |
| 5 | Calibração com métricas e laço de resposta (LinkedIn e X) | relatório de correlação por critério |

## Perguntas em aberto

Resolvidas em 28/10/2026: limite do plano (uma ideia = um post, com todo o custo registrado), custo do X (vai para a fatura, sem aparecer no fluxo do post) e aprovação do protótipo.

2. **Núcleo na mesma chamada do primeiro post (recomendado) ou em chamada própria?**
3. **LinkedIn só perfil pessoal na primeira versão?** Recomendação: sim; a página da empresa precisa de produto e aprovação próprios.
5. **Mostrar faixa e checklist (recomendado) ou nota numérica?**
6. **O avaliador roda em toda geração ou só quando a pessoa pede?** Recomendação: sempre na geração (o conserto melhora a saída), "Reavaliar" sob demanda.

## Como verificar

- Eval: casos com `channels` e `sendTarget`; juiz por rede com a rubrica; antes e depois com `eval:compare` anexado na PR.
- Ensaio de publicação (o `publish.ts` já tem modo ensaio) em LinkedIn e X antes de qualquer publicação real.
- E2E: pedido em duas redes até dois agendamentos, com o mesmo `brief_id`.
- Teste de unidade: núcleo e variante validados na entrada (parser puro), restrições do banco, nenhuma credencial lida do ambiente.
