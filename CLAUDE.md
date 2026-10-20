# Regras do repositório (Ekoai)

Repo público da BEZ (`bez-company/ekoai-platform`): nunca commitar e-mail, token, ID de projeto
sensível ou dado de cliente. Plano e decisões: `docs/specs/` e `docs/adr/`. Operação: `docs/runbook.md`.

## Pull request

- Título e corpo em inglês; commit em Conventional Commits, em inglês. `gh pr create --assignee @me`.
  Sem ID de card (contexto BEZ).
- O corpo segue `.github/pull_request_template.md`. Apague a seção que não se aplica; não deixe
  seção vazia nem comentário do modelo.
- **Mudança visual: prints no corpo da PR, sempre.** Antes e depois quando muda uma tela que já
  existe; só depois quando a tela é nova. Desktop e mobile. Claro e escuro quando mexe no tema. Os
  estados que importam: vazio, carregando, erro e cheio. Dado fictício: este repo é público.
  Para subir: `scripts/pr-assets.sh <pasta> <png>...` e colar o markdown que ele imprime.
- **Mudança sem tela:** esqueleto do modelo e, quando o fluxo, os dados ou a arquitetura mudam, um
  diagrama pequeno (até uns 10 nós). O GitHub renderiza Mermaid no corpo:
  - passos entre sistemas ou pessoas (login, convite, webhook, job): `sequenceDiagram`
  - regra de decisão: `flowchart TD`; estados de um registro: `stateDiagram-v2`
  - tabela nova ou alterada: `erDiagram` só das tabelas tocadas, mais a lista das restrições novas
  - rota: tabela Rota, Permissão, Corpo, Respostas; variável de ambiente: Variável, Onde se define, Padrão
  - sem diagrama que esclareça, não force um: uma tabela antes e depois resolve.
- **Verificação honesta:** diga o que foi exercitado de verdade (teste, navegador real, banco real) e o
  que NÃO foi. Aprovação de UI com dublê não vale como teste do serviço real.
- PR com conflito não roda o CI. A `main` anda sozinha (deploy e infra): rebasear antes de abrir.
  Depois do merge, apagar a branch e o worktree.

## Código

- Cor, fonte, raio e sombra só por token do design system (`platform/src/app/globals.css` e
  `tailwind.config.ts`). Cor crua do Tailwind ou hex em `className` reprova (`tests/design-tokens.test.js`).
- Migration é aditiva e reaplicável (o CI aplica duas vezes). Apagar coluna ou tabela exige
  `-- allow-destructive` com o motivo. Toda tabela com `tenant_id` tem RLS e entra em `TENANT_TABLES`.
- Acesso ao banco: `tenantDb` por conta; `db()` cru só nos arquivos da lista de `tests/tenant-scope.test.js`.
- Rota de API declara a permissão que exige (`tests/route-permissions.test.js`). Rota pública só pelo
  caminho exato no middleware, e só quando a prova é outra (ID token, segredo do cron).
- Validar dado externo na entrada (parser puro em `platform/src/lib`), antes de qualquer I/O.
- Nada da Pilar nem de outro cliente no código (`tests/no-client-brand.test.js`).
- Variável pública do navegador não usa `NEXT_PUBLIC_`: a imagem é construída no CI sem a chave; o
  servidor lê em runtime e passa por props.

## Marcas

A Ekoai usa o design system 06 (ameixa e pêssego, Sora, gotas em formação). A asa, o coral e a Geist
são da BEZ (outro repo). Não misturar.
