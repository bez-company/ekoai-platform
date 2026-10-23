# SPEC 020: instruções explícitas do pedido (logo, fundo, texto exato, quantidade, posição)

- **Status:** proposta (23/10/2026). Aguarda o protótipo no Claude Design e as 8 decisões abaixo; nenhum código de tela antes disso
- **Data:** 2026-10-23
- **Cards:** CU-1dfhfaq7kft (esta spec e as entregas)
- **Depende de:** [SPEC 012](012-agentes-instagram-fase-2.md) (motor híbrido e revisor por regra),
  [SPEC 019](019-estudio-incremental-e-aprendizado-com-a-edicao.md) (`logoCorner`, `logoHidden`, regra de marca,
  revisão imutável), [ADR 0017](../adr/0017-motor-de-design-hibrido-com-biblioteca-de-layouts.md) (famílias de layout),
  [ADR 0022](../adr/0022-instrucao-do-pedido-lida-em-contrato-fechado-e-obedecida-por-codigo.md) (decisão desta spec)
- **Reaproveita:** o leitor de instruções serve ao card "Pedir ajuste em texto livre" (BEZ-193), que continua em card
  próprio: o mesmo contrato vale para o pedido e para o ajuste depois do post pronto
- **Protótipo:** pendente (seção "Telas")

## Problema

Medido no eval da geração (`npm run eval`, baseline de 23/10/2026): o pedido que a pessoa escreve vira só um
**tema**. O redator preenche selo, título, subtítulo e itens, e o layout sai da contagem de itens
(`defaultLayout`). Não existe lugar para o que a pessoa realmente disse:

| Pedido | O que sai hoje |
| --- | --- |
| "Fundo escuro, logo bem centralizado, o nome da empresa e em um canto o @" | logo pequeno no canto, frase de efeito inventada, foto de pão (3 de 6 exigências) |
| "A frase exata X em destaque e mais nada na imagem" | título, subtítulo e lista a mais (1 de 2) |
| "Três dicas para o pão não endurecer" | 4 dicas (3 de 4) |

Causa comum: o pedido não tem estrutura. O modelo de imagem é proibido de desenhar logo e texto (de propósito, ADR
0017), então a única forma de cumprir o pedido é o **código** saber o que foi pedido. E a pessoa deve poder tirar
ou mudar de lugar qualquer elemento do post pelo pedido, e o sistema segue.

## Resultado esperado

1. O pedido é lido uma vez em **instruções estruturadas** (contrato fechado, validado em código), guardado no
   pedido e visível em Aprovar ("o que você pediu" e se foi aplicado).
2. O código obedece: fundo, posição de cada elemento (logo, nome, @, título), texto literal, "mais nada na
   imagem", quantidade de itens e o que não colocar. O modelo escreve só o que a pessoa não ditou.
3. Instrução que não dá para cumprir **nunca some em silêncio**: o post sai com o que coube e Aprovar diz o que
   não foi aplicado e por quê.
4. No eval: `primeira-imagem-da-marca` 6/6, `frase-exata` 2/2, `dicas-em-lista` 4/4, sem piorar os outros casos.

## Decisões (recomendação em negrito)

1. **Leitor separado do redator.** Uma chamada curta de texto (JSON) lê as instruções do pedido; o redator só
   recebe o que sobrou. Alternativa: o redator devolver as instruções junto com o texto. **Separado**: a
   saída é pequena e auditável, e quem obedece é o código, não o modelo que já falhou em obedecer.
2. **Leitor falhou (resposta inválida depois de uma nova tentativa):** **o post segue sem instruções e Aprovar
   avisa "Não consegui ler as instruções do pedido"**, com a ideia original à vista. Alternativa: falhar o pedido.
3. **As instruções valem só para o post.** Elas não viram regra da marca por conta própria; a regra continua
   nascendo da repetição com aceite (SPEC 019). Precedência: instrução do pedido, depois regra de marca, depois padrão.
4. **Nova família `marca`** (fundo liso, logo grande, nome, @) como base do pedido de "imagem da marca", em vez de
   forçar `titulo-destaque`. Ela também aceita as posições do item 5.
5. **Posição em grade 3x3** (`tl tc tr ml c mr bl bc br`), não coordenada livre. O revisor de layout (margem,
   sobreposição, contraste) continua valendo. Arrastar na tela é o BEZ-194, fora desta spec.
6. **Instrução impossível ou em conflito** (logo pedido sem logo cadastrado, logo e nome no mesmo ponto, 5 itens
   quando o máximo é 4): aplica o que cabe, não aplica o resto e diz qual e por quê em Aprovar.
7. **Fundo só pela paleta da marca** (`dark` = tom mais escuro da marca, `light` = papel, `brand` = cor primária),
   nunca hex livre: o contraste fica garantido pela mesma conta de hoje.
8. **Custo.** Uma chamada de texto a mais por pedido (frações de centavo), registrada em `generation_runs`
   (passo `directives`, idempotente por hash do pedido). Não conta no limite mensal do plano, que só conta imagem.

## Contrato das instruções

```ts
type Place = 'tl' | 'tc' | 'tr' | 'ml' | 'c' | 'mr' | 'bl' | 'bc' | 'br';
type Directives = {
  background?: 'dark' | 'light' | 'brand';            // fundo liso, sem foto
  elements?: Partial<Record<'logo' | 'name' | 'handle' | 'title', Place | 'off'>>; // 'off' = tirar
  exactTexts?: string[];     // frases que saem como estão, na ordem: título, subtítulo, itens
  textOnly?: boolean;        // "mais nada na imagem": sem selo, subtítulo, itens nem frase extra
  itemsCount?: 2 | 3 | 4;    // "três dicas"
  noPhoto?: boolean;         // "sem foto": não gera visual por IA
  avoid?: string[];          // o que não colocar, até 5 itens de 80 caracteres
};
```

Parser puro em `platform/src/lib/directives.ts`: aceita só essas chaves, descarta o resto, corta tamanhos e
nunca lança; devolve `{ directives, dropped }` para o log. O texto do pedido é dado, não instrução ao sistema:
nada do que a pessoa escreve muda o contrato (ADR 0022).

## Requisitos

- **R1.** O pedido é lido antes do redator. Resultado guardado em `briefs.directives` (jsonb, migration aditiva e
  reaplicável) e no `design` do post (`placements`, `background`), para o ajuste rápido e o desfazer enxergarem.
- **R2.** `exactTexts` entra no design sem passar pelo modelo e sem corte. Se não couber no slot, o revisor
  reprova (`text_too_long`) e o pedido volta com o motivo, nunca com o texto cortado.
- **R3.** `textOnly` apaga selo, subtítulo e itens do que o redator devolver; a legenda segue normal.
- **R4.** `itemsCount` vai ao prompt como número exato e o revisor reprova se o redator devolver outro (`directive_count`).
- **R5.** `elements` posiciona ou tira logo, nome, @ e título nas famílias que têm o slot. `logo: 'off'` é o
  `logoHidden` da SPEC 019. A posição vale na renderização, então ajuste rápido e versões continuam iguais.
- **R6.** `background` e `noPhoto` escolhem a família `marca` (ou o fundo da família) e não chamam o modelo de
  imagem; `avoid` vai ao prompt e ao revisor de palavra proibida.
- **R7.** Aprovar mostra "O que você pediu": cada instrução com selo "Aplicado" ou "Não aplicado" e o motivo.
- **R8.** Revisor novo, bloqueante: `directive_text_missing` (texto literal ausente), `directive_extra_text`
  (`textOnly` com texto a mais), `directive_count` (quantidade errada).
- **R9.** Dado externo na fronteira: o JSON do leitor passa pelo parser puro antes de qualquer I/O; chave
  desconhecida ou tipo errado é descartado e registrado.

## Telas (protótipo no Claude Design, antes de qualquer código)

Mesmo artifact das fases anteriores, no mesmo `file_path`, a partir da versão ao vivo. Desktop e celular.

- **Posts da família `marca`** em 1:1 e 4:5: logo central + nome + @ no canto (o pedido real do eval), logo
  tirado, logo no canto superior direito, fundo claro, só a frase exata.
- **Aprovar com "O que você pediu":** tudo aplicado, parcial (uma instrução não aplicada com o motivo), leitor
  falhou (aviso e ideia original), carregando ("Lendo o pedido"), erro.
- **Criar post:** uma linha de dica sob o campo ("Pode pedir fundo, posição do logo, texto exato e quantidade").

## Verificação

- **Eval** (`npm run eval`, ~US$ 0,15): casos `primeira-imagem-da-marca`, `frase-exata` e `dicas-em-lista` com todas as
  exigências; casos novos `logo-removido`, `logo-no-canto-superior-direito` e `so-o-nome-e-o-arroba`. Escritos
  à mão a partir do pedido, não pelo modelo medido.
- **Unitários:** parser (formas válidas, tipos errados, chave desconhecida, texto tentando mudar o contrato),
  `directive_*` do revisor, posições na grade, família `marca` nas duas proporções.
- **Banco:** migration aplicada duas vezes; RLS do `briefs` já cobre a coluna nova.
- **Navegador (E2E):** pedido com instruções até Aprovar, com o painel "O que você pediu".

## Entregas

1. **a.** Parser, passo `directives` no `generatePost`, migration e `evals/` com os casos novos (sem tela).
2. **b.** Família `marca` e posições em grade nas famílias existentes.
3. **c.** Obediência: `exactTexts`, `textOnly`, `itemsCount`, `noPhoto` e os revisores `directive_*`.
4. **d.** Aprovar: painel "O que você pediu" e a dica no Criar post (depende do protótipo aprovado).

## Fora desta spec

Arrastar elementos na tela (BEZ-194), pedir ajuste em texto livre depois do post pronto (BEZ-193, reaproveita o
contrato), cor de texto livre fora da paleta, vários posts por pedido (carrossel, BEZ-199).
