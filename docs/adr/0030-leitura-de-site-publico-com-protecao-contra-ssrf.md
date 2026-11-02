# 0030. Leitura de site público com proteção contra SSRF

Status: aceita (02/11/2026). Vale para a [SPEC 033](../specs/033-paleta-da-marca-e-leitura-do-site.md) e para qualquer busca futura de URL
que uma pessoa indicar.

## Contexto

A Ekoai passa a ler o site que a pessoa informa (cores, fontes, textos) para sugerir o perfil da marca. O servidor busca uma URL escolhida
por quem usa o produto: o risco é SSRF, ou seja, o endereço levar a rede interna, aos metadados da nuvem (`169.254.169.254`) ou à própria
máquina. Conferir o nome antes e conectar depois não basta: um nome pode responder um IP público na conferência e um interno na conexão
(DNS rebinding), e um redirecionamento pode apontar para dentro.

## Decisão

1. **Só `https`, porta 443, nome de domínio.** Sem IP (nem o escrito em hexa ou decimal, que o parser de URL normaliza), sem usuário e senha, sem
   nome interno (`localhost`, `.local`, `.internal` e parecidos). `http://` sobe para `https://`.
2. **O IP é conferido na conexão.** O transporte usa `node:https` com um `lookup` próprio: o endereço que o DNS devolve é validado ali, na hora
   de conectar, e basta um endereço não público entre os devolvidos para recusar. Recusados: privado, loopback, link-local, CGNAT, multicast,
   reservado, e o IPv6 que embrulha um IPv4 interno (mapeado, NAT64, 6to4). Do IPv6 só passa o unicast global.
3. **Cada redirecionamento volta pelas mesmas regras**, até 3.
4. **Limites:** 2 MB por resposta, 10 s por pedido e 25 s por leitura, sem cookie, sem compressão (`Accept-Encoding: identity`, nada de arquivo
   que explode). Página e até 3 folhas de estilo; o resto é ignorado.
5. **Respeita o `robots.txt`** (grupo `EkoaiBot`, senão `*`). Sem o arquivo, vale como liberado.
6. **O texto lido é dado.** Cor, fonte, nome e descrição saem por parser puro, com tamanho limitado; nada do que foi lido é executado nem
   entra como instrução num prompt sem passar por contrato fechado (SPEC 020).
7. **Nada é gravado sem a pessoa revisar.** A leitura devolve sugestões; quem grava é o formulário de sempre, com `brand.manage`.

## Consequências

- Site que só desenha a página por JavaScript devolve pouco (a leitura é do HTML e do CSS). A tela diz "achamos pouco" e leva ao preenchimento à mão.
- Cloud Run sai para a internet pública sem proxy de saída; a defesa é toda no código. Se o egress passar por um proxy, ele vira a segunda barreira, não a primeira.
- A regra de IP e de URL é pura e testada (`tests/site-read-guard.test.js`); o `lookup` é testado com DNS simulado (`tests/site-read-fetch.test.js`).
