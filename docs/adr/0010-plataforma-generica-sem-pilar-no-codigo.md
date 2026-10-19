# ADR 0010: plataforma genérica, a Pilar vira conta e a geração sai até a fase 2

- **Status:** aceito
- **Data:** 2026-10-19
- **Revisa:** [ADR 0004](0004-construir-o-saas-sem-cnpj-validando-com-a-pilar.md), itens 2 (posicionamento
  só para escritório de projeto) e 4 (cadastro fora do escopo); [ADR 0002](0002-plataforma-como-produto-proprio.md)
  (a Pilar como tenant padrão)
- **Spec:** [SPEC 011](../specs/011-plataforma-generica-fase-1.md)

## Contexto

O repo nasceu como fábrica de marketing da Pilar. Mesmo com tenant no banco (ADR 0005), a Pilar
continuava no código: nicho, voz, persona e guardrails em `src/tenant.js`, prompts e docs de ICP,
estilo de imagem e cenas de engenheiro em `src/utils/image-gen.js`, templates com a paleta da
Pilar, funil e UTM apontando para `pilarsoft.com.br`, e `TENANT_ID || 'pilar'` como queda padrão.
Uma conta nova de outro nicho receberia post de escritório de engenharia.

O Matheus decidiu em 19/10/2026 que o produto (Ekoai) é uma plataforma genérica onde empresas
criam conta e usam. A fase 1 estrutura a plataforma; a geração de conteúdo volta na fase 2 como
agentes de imagem para o Instagram.

## Decisão

1. **Nenhuma marca de cliente no código.** A Pilar passa a ser uma conta como outra qualquer: dado
   no banco, criado e configurado pela plataforma. Um teste de CI reprova o retorno de referência à
   Pilar fora do histórico (migrations já aplicadas e docs de decisão).
2. **O pipeline de geração sai do código**, e não fica desligado por flag. Ele é todo moldado na
   Pilar (prompts, pilares, templates, croquis, funil); mantê-lo exigiria deixar genérico um código
   que a fase 2 vai reescrever. O estado completo fica na tag `pilar-v1`, de onde a fase 2 tira o
   que servir (render HTML para PNG, bandit, crítica e juiz, regras de estilo).
3. **Fica o que é plataforma:** publicação agendada, contas e papéis, login por pessoa, avisos,
   métricas e renovação de token das redes, mídia, pausa, horários e exportação.
4. **Tenant sem queda padrão.** Job sem `TENANT_ID` e instalação de senha única sem `TENANT_ID`
   falham na hora, com mensagem clara.
5. **Cadastro self-service é construído, mas atrás de flag** (`SIGNUP_MODE=invite` por padrão).
   Abrir para o público é decisão separada, depois dos gates que restam do ADR 0004 e do App Review
   da Meta.
6. **Foco no Instagram.** LinkedIn e X ficam no código de publicação, fora do menu e do onboarding
   até a vez deles.

## Consequências

- **Ganha:** o produto deixa de pressupor um nicho; menos código para manter (sai o Chromium da
  imagem dos jobs, junto com `puppeteer`, `js-yaml` e o SDK do Gemini).
- **Custa:** a plataforma fica sem gerar post até a fase 2. A inbox mostra estado vazio. Os jobs
  `post`, `resolve`, `reflect`, `funnel`, `engage`, `repurpose` e `reel` deixam de existir; a
  infraestrutura da SPEC 010 não deve agendá-los.
- **Dado existente:** a linha `pilar` em `tenants` e o histórico dela continuam no banco. Nenhuma
  migration apaga dado.
- **Reverter:** `git checkout pilar-v1 -- <caminho>` traz qualquer arquivo de volta.
