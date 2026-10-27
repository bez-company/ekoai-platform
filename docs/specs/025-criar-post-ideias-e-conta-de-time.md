# SPEC 025: criar post mais simples, ideias para quem começa e conta de time

- **Status:** rascunho. Falta o protótipo no Claude Design e a aprovação do Matheus antes de qualquer código de tela
- **Data:** 2026-10-27
- **Cards:** BEZ-372 (formato primeiro), BEZ-373 (quantas lâminas), BEZ-374 (foto e objetivo), BEZ-375 (ideias), BEZ-376 (upgrade); pai BEZ-354
- **Origem:** teste do Matheus em produção, 27/10/2026

## Problema

1. O tipo do post (imagem única ou carrossel) vem no meio do formulário. Quem cria precisa dele primeiro.
2. Ao subir uma foto, a Ekoai mostra um bloco "o que vi na imagem" e depois três opções ("como está", "só a legenda",
   "foto de fundo"). O bloco e as opções pesam e confundem; o Matheus não gostou.
3. O objetivo do post tem nove caixas e exemplos longos ("Dia das Crianças" como data comemorativa). Ocupa a tela e engessa.
4. O carrossel aceitava de 2 a 6 lâminas e a Ekoai escolhia quantas. A pessoa quer escolher. (O teto técnico passou a
   10, o do Instagram, no BEZ-373; falta a escolha na tela.)
5. Quem começa um Instagram do zero (o caso Best Company) não sabe que linha de design seguir nem o que postar.
6. Conta individual não vira conta de time ou de agência.

## Decisões propostas (a confirmar no protótipo)

1. **Primeira escolha do formulário: imagem única ou carrossel**, em dois botões lado a lado. Com carrossel, aparece um
   passo de quantidade (2 a 10, padrão "a Ekoai decide").
2. **Foto:** subiu a foto, ela já é o visual. Sem bloco de descrição e sem as três opções. Uma linha: "A Ekoai escreve a
   legenda a partir da foto." O que hoje o bloco decide (usar como está, só legenda, fundo) vira ajuste no Aprovar.
3. **Objetivo do post:** um dropdown (`components/ui/Select`) com poucas opções genéricas (vender, divulgar novidade,
   explicar, engajar, relacionamento), sem exemplos. Data comemorativa vira texto livre do pedido, não opção.
4. **Ideias para quem começa:** em Campanhas e em Criar post, um botão "Sugerir ideias" que, com o perfil da empresa
   (nicho, o que vende, para quem, jeito de falar, cores), devolve 6 ideias de post e uma linha de design (cores, fonte,
   layout). Uma chamada de texto, conta no limite do mês como uma geração. Primeira versão sem imagem.
5. **Conta de time ou agência:** botão "Fazer upgrade" em Perfil › Conta, que leva ao plano de time (SPEC 021). Depende de
   cobrança por consumo (ADR 0023) e de o plano de time existir com preço; até lá o botão pede contato.

## Perguntas em aberto

- A quantidade de lâminas escolhida é exata ou um teto para a Ekoai? (Recomendação: exata; a Ekoai ajusta o texto.)
- Upgrade de pessoa para empresa troca o tipo da conta (`tenants.kind`) e o plano na hora, ou só depois do pagamento?
- As ideias entram no corpo da campanha ou ficam só em Criar post na primeira versão?

## Como verificar

Teste do parser do pedido (formato, quantidade, objetivo), teste de rota das ideias com modelo simulado, E2E do fluxo
criar > aprovar com carrossel de 8 lâminas, e as telas nos estados vazio, carregando, erro e cheio (desktop e celular).
