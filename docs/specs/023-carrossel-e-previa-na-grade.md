# SPEC 023: carrossel e prévia do post na grade do perfil

- **Status:** proposta (23/10/2026). Aguarda o protótipo no Claude Design e as 12 decisões abaixo; nenhum código de tela antes disso
- **Data:** 2026-10-23
- **Cards:** [BEZ-199](https://app.clickup.com/t/1dfhfaq7jmn) (carrossel), [BEZ-200](https://app.clickup.com/t/1dfhfaq7jmp) (grade) e as entregas BEZ-308 a BEZ-313
- **Depende de:** [SPEC 012](012-agentes-instagram-fase-2.md) (agentes e revisor por regra),
  [SPEC 019](019-estudio-incremental-e-aprendizado-com-a-edicao.md) (ajuste rápido e revisão imutável),
  [ADR 0017](../adr/0017-motor-de-design-hibrido-com-biblioteca-de-layouts.md) (motor híbrido),
  [ADR 0021](../adr/0021-revisao-imutavel-com-diff-por-campo.md) (revisão), [ADR 0025](../adr/0025-carrossel-como-lista-de-laminas-dentro-do-design.md) (decisão desta spec)
- **Em paralelo (conflito provável):** SPEC 020 (PRs #184 e #185) mexe em `generation.ts` e em `families.ts`
- **Protótipo:** [v17 no Claude Design](https://claude.ai/artifact/55avs7vhgtwKFn9HMAR9Fz) (grupo "Fase 6: carrossel e grade")

## Problema

1. **Carrossel.** O Instagram entrega mais tempo de atenção no carrossel, e o motor híbrido já tem o que ele
   pede: o visual fica em cache e o resto é código. Hoje todo post sai como imagem única. O envio já existe
   (`scheduled_posts.slide_urls` e `publishCarousel`, herdados do fluxo antigo), mas nada gera, mostra ou edita
   lâminas.
2. **Grade.** Aprovar mostra o post dentro da moldura do feed (`FeedFrame`). Não mostra o que a pessoa vê no
   perfil: o post novo ao lado dos últimos. É lá que a pessoa nota corte ruim do 4:5, cor repetida e três posts
   do mesmo tipo em seguida.

## Resultado esperado

1. **A pessoa escolhe** entre imagem única e carrossel ao criar o post (decisão do Matheus, 26/10/2026); a Ekoai não
   escolhe o tipo. Dá para trocar depois, em Aprovar.
2. Carrossel de 2 a 6 lâminas: gancho, conteúdo (um item por lâmina) e chamada com o logo. Todas desenhadas pelo
   mesmo código, na mesma família e com a mesma marca.
3. Aprovar mostra as lâminas (setas, pontos, miniaturas); o ajuste rápido edita lâmina a lâmina; a publicação sai
   como carrossel pela API da Meta.
4. Só a lâmina com visual novo chama o modelo de imagem. Gerar um carrossel custa o mesmo que uma imagem única
   em modelo de imagem.
5. Aprovar e o ajuste rápido têm a aba **Grade**: o post novo no lugar certo, ao lado dos 8 últimos posts reais
   da conta (os da Ekoai e os publicados à mão), com o corte do Instagram. Sem chamada ao modelo.

## Decisões (recomendação em negrito)

### Carrossel

1. **O carrossel é um post só, com uma lista de lâminas dentro do design** (`post_designs.design.slides`), não uma
   tabela nova nem vários posts. **Lista no design**: a revisão imutável (ADR 0021), o conflito por versão e o
   diff por campo continuam valendo sem migration. `post_designs.png_key` guarda a capa, então agenda, publicados
   e miniaturas seguem funcionando. Alternativa: tabela `post_design_slides`, mais limpa para consulta e mais cara
   (migration, RLS, revisão por lâmina). Ver [ADR 0025](../adr/0025-carrossel-como-lista-de-laminas-dentro-do-design.md).
2. **2 a 6 lâminas** (o Instagram aceita até 10). Seis é o teto do card e mantém o gancho forte; o contrato recusa
   fora da faixa. Papéis: `cover` (primeira), `content` (do meio) e `cta` (última). Carrossel de 2 lâminas é
   capa e chamada.
3. **Contrato do redator.** A mesma chamada de texto (estrategista, redator e diretor de arte) recebe o formato escolhido
   no pedido (`single` ou `carousel`) e, no carrossel, devolve `slides` com `role`, `title`, e `kicker`, `sub` ou `items`
   conforme o papel. Os limites de palavras de hoje valem por lâmina e a legenda é uma só. Resposta inválida entra
   nas 3 voltas de hoje, com o motivo devolvido ao modelo.
4. **Famílias.** Reaproveita a capa e a chamada nas famílias atuais (`titulo-destaque` ou `foto-titulo` para a
   capa; `titulo-destaque` com logo e @ para a chamada) e cria uma família nova, **`lamina-item`**: número grande
   ("2 de 4"), título e subtítulo, sobre o fundo da marca. É a lâmina em que "os 3 sinais" viram 3 lâminas. Nenhum
   layout novo para quem não pediu carrossel.
5. **Visual.** **Um visual só, na capa** (atmosfera). As outras lâminas usam a cor da marca. Pedir visual novo para
   uma lâmina é do Estúdio completo (BEZ-196, fase 3) e conta no limite como hoje. Alternativa: o mesmo visual
   em todas as lâminas com recortes diferentes, bonito mas repete a foto.
6. **Revisor por lâmina.** O revisor roda em cada lâmina (contraste, fonte mínima, margem, fato fora da base,
   palavra proibida) e o aviso diz a lâmina ("Lâmina 3: ..."). Regra nova: **a lâmina não repete o título de outra**
   e **a capa tem no máximo 12 palavras**. Lâmina que não coube tira o subtítulo e tenta uma vez, como hoje.
7. **Aprovar.** `FeedFrame` ganha o modo carrossel: setas, pontos, contador "1/4" e tira de miniaturas fora da
   moldura. A pendência guarda uma imagem por lâmina (`pending_approvals.images`, que já é lista) e
   `variations[0].format = 'carousel'` com `slideUrls`, que é o que `scheduling.ts` e `publish.ts` já leem.
8. **Ajuste rápido por lâmina.** Seletor de lâmina com miniaturas; o diff ganha o prefixo `slides.<n>.` no campo e
   a revisão guarda o design inteiro, como hoje. **Trocar layout vale para a lâmina selecionada** dentro das
   famílias compatíveis com o papel dela. Reordenar, apagar e acrescentar lâmina fica para depois (ver "Fora").
9. **Formato escolhido pela pessoa.** Criar post ganha o campo "Imagens do post" ("Formato" já é a proporção 4:5
   ou 1:1), com duas opções e **Uma imagem** já marcada: Uma imagem ou Carrossel. A Ekoai decide só o número de lâminas (2 a 6). Em Aprovar, **trocar o formato custa uma chamada de texto e nenhuma imagem**: de imagem única
   para carrossel o redator escreve as lâminas e o visual existente vira a capa; de carrossel para imagem única
   fica a capa (a legenda não muda). A troca cria uma revisão nova, então desfaz.
10. **Publicação.** Já existe; esta spec só a valida de ponta a ponta. O texto alternativo (BEZ-203) passa a ir
    em cada lâmina (a Meta aceita `alt_text` em imagem de carrossel; se recusar, segue sem, como hoje).
    Verificação real em ensaio (`PUBLISH_MODE=rehearsal`: cria os containers na Meta e para antes do
    `media_publish`), nunca publicando de verdade na conta de um cliente.

### Grade

11. **A grade lê a Meta**, não só os posts da Ekoai: `GET /{conta}/media?fields=id,media_type,media_url,thumbnail_url,permalink,timestamp&limit=9`
    com o escopo `instagram_business_basic`, que a conexão já exige (nenhuma permissão nova, nenhuma revisão
    nova da Meta). Vídeo e Reel usam `thumbnail_url`; carrossel usa a primeira imagem (`media_url`) e ganha o
    ícone de carrossel. As URLs são da CDN da Meta e expiram, então **não guardamos a imagem**: lê ao abrir a
    aba, cache de servidor de 10 minutos por conta (em memória) para não bater no limite, e `img` com
    `referrerPolicy="no-referrer"`. O parser é puro (`instagram-grid-model.ts`) e valida o formato e o host
    (`https` e domínio da Meta) antes de qualquer uso; resposta fora do contrato vira "não consegui ler".
    **Sem conexão ou com falha da Meta**: a grade mostra o post novo e os publicados pela Ekoai (que temos em
    `listPublished`), com o aviso "Mostrando só os posts feitos pela Ekoai. Reconecte o Instagram para ver a
    grade completa" e o botão para reconectar. Conta sem posts: só o post novo, com "Primeiro post da conta".
12. **Corte da grade: só 3:4.** O card pedia 1:1, mas o perfil do Matheus mostra miniaturas verticais 3:4 (confirmado
    em 26/10/2026), então não há chave. O corte é centralizado, como o Instagram faz; a razão fica numa constante
    (`GRID_THUMB_RATIO`) caso o Instagram mude de novo. No Feed, uma guia opcional ("Mostrar o corte da grade")
    desenha a área cortada sobre o post (3,13% de cada lado no 4:5), para a pessoa manter o título dentro dela
    (as margens de segurança do BEZ-196).

## Telas (a prototipar no Claude Design, desktop e mobile)

Parte da v13 aprovada; a v14 acrescenta a fase 6 no mesmo artifact. Telas: Aprovar carrossel (7 estados), Aprovar aba Grade (8),
Ajuste rápido do carrossel (5), Agenda e Publicados e Criar post (2). Estados em todas: vazio, carregando, erro e cheio.

- **Criar post**: campo Imagens do post (2 opções, Uma imagem marcada), abaixo do objetivo.
- **Aprovar, carrossel**: visualizador com setas e pontos, miniaturas, avisos do revisor por lâmina, botão "Trocar
  para imagem única".
- **Aprovar, aba Grade**: 9 células em 3 colunas (o novo no topo à esquerda), corte 3:4, aviso de
  leitura parcial, carrossel com ícone.
- **Ajuste rápido, carrossel**: seletor de lâminas e a guia do corte da grade.
- **Agenda e Publicados**: capa com a marca de carrossel e "4 lâminas".

## Verificação

| O que | Como |
| --- | --- |
| Contrato `format` e `slides` (faixa, papéis, limites) | teste puro do parser, incluindo resposta inválida e 7 lâminas |
| Render das 3 famílias de lâmina nos extremos de texto | teste de render (como `design-contrast.test.js`) |
| Revisor por lâmina e as 2 regras novas | teste puro |
| Carrossel de ponta a ponta: pedido, pendência com N imagens, aprovar, agendar | `tests/db` com modelo falso; um visual e N PNG |
| Custo: um carrossel reserva 1 visual | assert nas reservas de `generation_runs` |
| Revisão e diff com `slides.<n>.` e conflito de versão | `tests/db/post-design-revisions` ampliado |
| Publicação do carrossel na Meta | ensaio na conta de staging conectada; sem conta, **não verificado** e dito na PR |
| Parser da grade (mídia vídeo, carrossel, campo ausente, host estranho) | teste puro |
| Grade com e sem conexão, e falha da Meta | teste da rota com `fetch` falso e teste de tela |
| Corte 3:4 fiel ao Instagram | conferido no perfil do Matheus (26/10/2026); teste garante a conta do corte |

## Entregas

| Card | Entrega | Depende de |
| --- | --- | --- |
| BEZ-308 | esta spec, o ADR 0025 e o protótipo | |
| BEZ-309 | grade: leitura da Meta, parser, rota e a aba Grade em Aprovar | protótipo aprovado |
| BEZ-310 | carrossel: contrato, famílias, render, revisor e `design.slides` | protótipo aprovado; SPEC 020 mergeada |
| BEZ-311 | carrossel: Aprovar com lâminas, agenda e publicação (ensaio) | 310 |
| BEZ-312 | carrossel: ajuste rápido por lâmina | 310 e 311 |
| BEZ-313 | carrossel: escolher e trocar o formato | 310 e 311 |

A grade (309) não depende do carrossel e pode ir primeiro; mostra a capa quando o post for carrossel.

## Fora desta spec

Reordenar, apagar e acrescentar lâmina; visual novo por lâmina (Estúdio, BEZ-196); arrastar elementos (BEZ-194);
análise automática de harmonia da grade (cores, alternância entre informativo e atmosfera): a pessoa vê, a
Ekoai não opina; Reels e vídeo; carrossel com foto da pessoa em cada lâmina; LinkedIn e X.

## Riscos

- **Meta recusa o `alt_text` ou o container de carrossel na conta de staging**: o ensaio mostra antes de
  chegar ao cliente; a lâmina sai sem texto alternativo e o aviso diz isso.
- **Grade sem os posts fixados**: a API da Meta não diz quais estão fixados, então a ordem é por data. A aba avisa.
- **Conflito com a SPEC 020** em `generation.ts` e `families.ts`: a entrega 310 só começa depois do merge das
  PRs #184, #185 e #193, e rebaseia sobre elas.
- **O corte do Instagram muda sem aviso**: a razão fica numa constante só, fácil de trocar.
