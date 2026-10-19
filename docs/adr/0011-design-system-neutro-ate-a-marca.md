# ADR 0011: design system neutro até a marca existir

- **Status:** aceito
- **Data:** 2026-10-19
- **Spec:** [SPEC 011](../specs/011-plataforma-generica-fase-1.md)

## Contexto

A Ekoai ainda não tem logo nem design system. A plataforma usa hoje um acento índigo (`#6366f1`)
direto no `tailwind.config.ts` e classes de cor crua nos componentes (`bg-indigo-500`,
`text-amber-100`). As telas da fase 1 (cadastro, empresa, equipe, redes) precisam de protótipo no
Claude Design antes do código, e o protótipo precisa de uma base visual.

## Decisão

1. **Tokens semânticos, não cor crua.** Os componentes usam só nomes de papel: `surface`,
   `surface-raised`, `text`, `text-muted`, `border`, `accent`, `accent-contrast`, `success`,
   `warning`, `danger`, `focus`. Os valores moram num lugar só (variáveis CSS mapeadas no Tailwind).
2. **Primeira versão neutra:** cinzas, um acento e os estados, proposta pelo próprio Claude Design
   no protótipo, com contraste AA verificado.
3. **O nome "Ekoai" em texto** faz o papel do logo até a marca existir.
4. **Trocar a marca = trocar os valores dos tokens**, sem tocar em componente.

## Consequências

- Quando a marca chegar, a troca é de um arquivo, desde que nenhuma cor crua volte aos componentes.
- As telas já existentes migram para os tokens junto com o porte das telas novas, não antes.
- A marca do cliente (logo, cores, fontes) é outro assunto: é dado do perfil da empresa e só vira
  visual na fase 2, nas artes.

## Atualização (2026-10-19): marca escolhida

- **Ekoai = design system 06, "Ameixa e pêssego"**: tinta #22122B, papel #F7F1EF, pêssego #FF8A65;
  Sora e DM Mono; cartões com raio 28, campos 20, botões e etiquetas em pílula; barra lateral em
  ameixa mesmo no tema claro; grafismo de arcos de eco. Logo: cinco gotas em formação em V, a da
  frente em pêssego (`platform/src/components/Logo.tsx`, `platform/src/app/icon.svg`).
- **BEZ (a holding) = design system 01, "Grafite e sinal"**, com a asa. Mora no repositório
  `bez-company/bez-website`. As duas marcas não se misturam: a Ekoai não usa coral, Geist nem a
  asa; a BEZ não usa ameixa, pêssego, Sora nem as gotas.
- **Onde estão os tokens:** `platform/src/app/globals.css` (canais RGB, claro e escuro por
  `data-theme`) mapeados em `platform/tailwind.config.ts` (`bg-page`, `bg-raised`, `text-fg`,
  `text-muted`, `border-line`, `bg-accent`, `text-on-accent`, `text-accent-text`, `text-danger`...).
  Contraste AA calculado nos dois temas; texto sobre o pêssego é a tinta, nunca branco.
- **Catraca:** `tests/design-tokens.test.js` reprova cor crua do Tailwind ou hex em `className`.
- **Protótipo:** https://claude.ai/artifact/55avs7vhgtwKFn9HMAR9Fz (versão 3).
