# SPEC 026: logo com variações para fundo claro, fundo escuro e símbolo

- **Status:** protótipo v20 aprovado pelo Matheus em 27/10/2026; implementada na PR do BEZ-369
- **Data:** 2026-10-27
- **Cards:** BEZ-369 (logo: caixa única, ampliar e variações); pai BEZ-354
- **Origem:** teste do Matheus em produção: "quero subir variações da logo aqui também"
- **Depende de:** [SPEC 011](011-plataforma-generica-fase-1.md) R3 e [ADR 0014](../adr/0014-logo-da-empresa-por-rota-autenticada.md) (o logo no bucket privado,
  só por rota com sessão), `lib/design/logo-blend.ts` (a conta de contraste entre o logo e o fundo)
- **Protótipo:** artifact https://claude.ai/artifact/55avs7vhgtwKFn9HMAR9Fz, versão 20 (`version_id` 1793120759-07c8), tela **Visual: logo e variações** no grupo "Fase 7"
  (estados: só a principal, com variações, ampliar, enviar arquivo, arquivo recusado, sem logo), desktop e celular. Fonte em
  `.context/proto-025` (`phase9.js`, `phase9.css`)

## Problema

Hoje a conta tem uma logo só. Quando o post tem fundo escuro (a cor da marca é grafite, por exemplo) e a logo é escura, ela some e o
motor põe uma placa clara atrás, que vira uma moldura que ninguém pediu. Marcas reais têm versões para fundo claro e escuro e uma
versão só com o símbolo, e hoje não há onde enviá-las.

## Decisões propostas

1. **Quatro lugares, um obrigatório:** Principal (obrigatória), Para fundo escuro, Para fundo claro e Só o símbolo. As três
   variações são opcionais. PNG ou SVG, até 2 MB cada; as mesmas regras de inspeção do envio atual.
2. **A Ekoai escolhe a variação pelo fundo do post**, com a conta de contraste que o motor já usa: fundo escuro usa "Para fundo
   escuro" se existir; fundo claro usa "Para fundo claro"; canto pequeno e lâminas de carrossel usam "Só o símbolo". Sem a variação
   certa, usa a Principal e, se ela some no fundo, a placa clara de sempre. Nunca piora o que existe hoje.
3. **Ampliar** abre a logo em tamanho grande, com fundo claro ou escuro à escolha (já entregue para a Principal no BEZ-371).
4. **Trocar e Tirar valem por variação.** Tirar a Principal não tira as variações; o post sai sem logo até enviar outra.
5. Só quem tem `brand.manage` altera; os outros papéis veem em leitura.

## Dados e rotas (a confirmar na implementação)

| Item | Mudança |
|---|---|
| `brand_assets` | coluna `variant text not null default 'main' check (variant in ('main','dark','light','symbol'))`; índice único por conta e variante só para as variações (a principal é uma só pelo ponteiro do perfil). Migration 0048, aditiva e reaplicável |
| `company_profiles.logo_asset_id` | segue apontando para a Principal |
| `GET/POST/DELETE /api/brand/logo?variant=` | `variant` opcional, padrão `main`; mesma permissão de hoje (`profile.view`, `brand.manage`) |
| `lib/design/logo-pick.ts` (novo, puro) | `pickLogo(logo, background, small)` escolhe a variante; o `compose` a aplica antes de desenhar. O "espaço pequeno" é a lâmina de carrossel (`lamina-item`); o canto de um post comum segue a regra de fundo |
| Exportação (LGPD) e exclusão da conta | passam a incluir e apagar as quatro |

## Como verificar

Teste puro do `pickLogo` (fundo claro, escuro, pequeno, variação faltando, nenhuma variante), teste de rota (permissão, tipo,
tamanho, `variant` inválido), teste de banco (único por variante, exportação e exclusão), render de um post com cada fundo e a
tela nos estados do protótipo (desktop e celular).
