# SPEC 033: paleta da marca com seletor de cor e leitura do site ou Instagram

- **Status:** decisões do Matheus de 02/11/2026 aplicadas; protótipo no Claude Design em andamento
- **Data:** 2026-11-02
- **Cards:** BEZ-524 (paleta e seletor), BEZ-525 (leitura do site ou Instagram); pai BEZ-522
- **Origem:** feedback do Matheus ao testar o cadastro e o perfil (31/10/2026)
- **Depende de:** `company_profiles` (migration 0017), `lib/company-profile-model.ts`, seção Visual do perfil, `lib/design/model.ts` (`Brand`)

## Problema

1. O perfil só guarda duas cores (principal e destaque), digitadas em hex. Marcas reais têm mais de duas, e quem não sabe o hex não tem
   como escolher.
2. Quem cria a conta digita tudo à mão. A marca já existe no site e no Instagram (cores, logo, tom, preços e números como "R$ 36 por
   criança"), e a Ekoai pode ler isso para preencher o perfil.

## Decisões (Matheus, 02/11/2026)

### A. Paleta (BEZ-524)

1. **Começa com 3 cores** (principal, destaque e apoio) e a pessoa **adiciona mais** quando quiser, até 8. Principal e destaque seguem
   com o papel de hoje; as demais são de apoio.
2. **Escala por cor:** de cada cor a Ekoai deriva uma escala de 9 tons (do mais claro ao mais escuro), como "escalas de verde". A pessoa
   pode usar um tom como a cor daquela posição. O motor usa a escala para fundos, faixas e textos, sempre com a conta de contraste atual.
3. **Seletor de cor** em cada cor: amostra clicável que abre o seletor nativo (`input type="color"`), mais o campo hex. Quem cola o hex segue podendo.
4. **Dado:** `color_palette text[] not null default '{}'` em `company_profiles`: até 6 cores de apoio `#RRGGBB`, sem repetir a principal, o
   destaque nem entre si (migration 0061, aditiva e reaplicável). Validação na fronteira em `company-profile-model.ts`; o erro de uma cor
   volta como `color_palette.<n>`. Corpo sem o campo não mexe nas cores de apoio. Escolher um tom da escala troca a cor daquela posição pelo
   tom (a escala é recalculada dela); nenhum tom fica guardado à parte.
5. **Estúdio:** as cores de apoio entram na lista "Cores da marca" do editor e na paleta que o modelo pode usar nos modelos de post. O motor
   de design dos posts comuns segue com principal e destaque; a escala nos fundos e faixas desses posts fica para uma PR própria.

### B. Logo no cadastro (decisão nova)

O passo "Visual" do cadastro da empresa já aceita as **variações da logo** (principal, fundo escuro, fundo claro, só o símbolo), as
mesmas da SPEC 026, não só a principal.

### C. Leitura do site e do Instagram (BEZ-525)

1. **O site público é lido sempre**, sem conta conectada: cores, logo, nome, descrição, textos, linguagem, visual e fatos
   (preço, número, prazo), cada fato com a origem (URL). Serve para sugerir posts alinhados à marca.
2. **Instagram depois de conectar**: com a conta Business conectada a leitura fica mais precisa (legendas, hashtags, estilo das imagens),
   e a tela diz isso ("com o Instagram conectado a leitura fica mais precisa"). Perfil público de terceiros não é raspado.
3. **Já no cadastro, rápido:** o 2º passo pede o site (e o @ do Instagram), a Ekoai lê e **preenche os passos seguintes**; a pessoa só
   confirma ou edita. "Preencher sem ler" continua existindo, e o perfil ganha "Ler de novo".
4. **A pessoa revisa antes de salvar.** Nada entra no perfil sozinho: marcar ou desmarcar por item, editar, ver a origem. Fato lido
   entra como rascunho em `company_facts` (fluxo de confirmação da SPEC 018).
5. **Leitura segura de URL:** só `https`, resolve o DNS e recusa IP privado, loopback e link-local (SSRF), no máximo 3
   redirecionamentos, 2 MB e 10 s, sem cookie, respeita `robots.txt`.
6. **Modelo:** contrato fechado (JSON validado por parser puro em `platform/src/lib`), como a SPEC 020; o texto lido é dado, nunca
   instrução ao modelo. O custo entra no consumo da conta como uma geração.
7. **Falha diz o que houve e o próximo passo** (site fora do ar, bloqueado, sem cores achadas), sem travar o cadastro.

## Fora do escopo

Raspagem de Instagram de terceiros, login em site da pessoa, leitura de mais páginas além da inicial e das 3 primeiras do menu.

## Como verificar

Testes puros: validação da paleta (limite, formato, duplicadas), parser da resposta do modelo, bloqueio de SSRF (IP privado, redirecionamento
para IP privado, porta, esquema), extração de cor de HTML/CSS de exemplo. Teste de rota (permissão `brand.manage`, URL inválida,
tempo esgotado). Tela nos estados do protótipo (desktop e celular): vazio, lendo, resultado para revisar, falha, paleta cheia.

## Divisão em PRs

1. BEZ-524: seletor de cor, paleta e escalas (migration, modelo, tela, Estúdio) e logo com variações no passo Visual do cadastro.
2. BEZ-525a: leitor seguro de URL e extração de cores e logo, com revisão na tela.
3. BEZ-525b: texto e fatos pelo modelo, rascunho em `company_facts`, e o cadastro rápido que preenche os passos.
4. BEZ-525c: Instagram conectado melhora a leitura.
