# 0024. Corpo de PR curto e visual

Status: aceita (23/10/2026). Vale para todos os repositórios da BEZ.

## Contexto

O corpo da PR crescia em parágrafos (por que, o que muda, fluxo, tabelas, verificação, risco), e quem
revisava lia texto em vez de ver a mudança. Na PR 185 os prints existiam, mas os links eram de blob
do GitHub sem `?raw=true`: o corpo mostrava imagem quebrada e a mudança visual ficou sem registro.
O antes e o depois vinham em imagens separadas, e comparar pedia abrir duas.

## Decisão

1. Título e corpo bastam para entender a mudança. Texto até 2500 caracteres; a explicação vai na imagem.
2. Mudança visual leva UMA imagem com antes e depois lado a lado (`pr-visual compare`); tela nova leva
   uma folha de capturas (`pr-visual sheet`).
3. Mudança de lógica, dado ou fluxo leva UM infográfico (`pr-visual render`). Mermaid só quando a imagem
   seria exagero.
4. A regra é checada: o workflow `PR body` reprova imagem sem `?raw=true`, arquivo de tela sem imagem e
   comentário do modelo esquecido, e avisa lógica grande sem infográfico e corpo longo.
5. O mesmo padrão vale nos outros repositórios da BEZ: modelo de PR padrão no repositório
   `bez-company/.github` e a ferramenta `pr-visual` na configuração de quem mantém os repositórios.

## Consequências

- Revisão mais rápida: a imagem mostra o antes e o depois sem abrir o diff.
- Custo por PR: gerar a imagem (segundos com `pr-visual`; o infográfico é um HTML curto).
- O check é um workflow à parte, não entra no `CI ok`: o CI pesado não roda a cada edição do corpo.
  Torná-lo obrigatório é uma configuração de proteção da branch, decisão do dono do repositório.
