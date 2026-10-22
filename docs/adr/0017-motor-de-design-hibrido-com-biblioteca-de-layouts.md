# ADR 0017: motor de design híbrido, com biblioteca de famílias de layout

- **Status:** aceito
- **Data:** 2026-10-21
- **Specs que dependem:** [SPEC 012](../specs/012-agentes-instagram-fase-2.md) (decisões 1, 3 e 4)
- **Prova:** BEZ-74, rodadas 1 a 5 (nota de 0 a 5, um avaliador, fora do repositório)

## Contexto

A SPEC 012 deixou aberto se o post sai como imagem inteira gerada por IA ou como visual de IA com
texto, logo e grade desenhados por código. A prova de conceito comparou as duas saídas em cinco
rodadas, com marcas diferentes:

| Rodada | O que foi testado | Média |
|---|---|---|
| R3 | híbrido simples (B) contra imagem inteira por IA | B 3,60 |
| R4 | três marcas, 18 posts compostos à mão como designer sênior | 4,50 |
| R5 | marca nunca vista, texto do agente, biblioteca de layouts, três direções de design | 4,42 |

Na R5, 10 de 12 posts tiveram nota 4 ou mais e "postaria sem editar" (83%). O avaliador foi um só e a
marca nova foi uma só. Alguns defeitos visuais ainda foram corrigidos à mão.

## Decisão

1. **A IA gera só o visual** (foto, fundo, ilustração, sem texto nem logo). Texto, logo e grade são
   desenhados por código (HTML para PNG) com os tokens da marca do perfil.
2. **Biblioteca de famílias de layout**, cada uma parametrizada por tokens da marca (cor, fonte, logo,
   rodapé). O diretor de arte escolhe a família e preenche os campos de texto; não desenha do zero.
   Famílias iniciais: as da prova (nativa, de pôster esportivo e de produto com tela de exemplo).
3. **Texto do post vem de um agente que devolve JSON** com um campo por slot, com limite de palavras,
   validado na entrada (formato e fatos da base) e com até 3 tentativas devolvendo o motivo da recusa.
4. **Revisor por regra** sobre o PNG e o texto: contraste mínimo, fonte mínima (título 56 px, corpo
   26 px, meta 22 px), margem (56 px, 40 px em pôster), número fora da base de fatos, palavra proibida
   da marca, regras de criança, travessão e emoji. Regra que a prova mostrou faltar entra na lista.
5. **Revisão visual ainda é necessária** antes de dar o motor como pronto: erros que a regra não vê
   (texto cobrindo forma, seta cruzando texto, rótulo sem contexto). Ver Consequências.
6. **Ajuste por slot.** Como o visual fica em cache e o resto é código, pedir ajuste de texto, rodapé
   ou layout re-renderiza sem chamar o modelo de imagem. Só visual novo chama o modelo e conta no limite.

## Consequências

- Custo de imagem só no visual novo (gemini-3.1-flash-image, cerca de US$ 0,067 por imagem); texto
  e re-render custam centavos ou nada.
- **Modelo de imagem (BEZ-220, 22/10/2026):** num torneio de 5 prompts e 8 modelos, 65 imagens, com notas do
  Matheus, o `gemini-3.1-flash-lite-image` aprovou 100% das fotos por cerca de US$ 0,034 por imagem (metade do
  3.1 Flash) e em 4 s contra 11 s. A staging usa o Flash Lite; a produção segue no 3.1 Flash até uma rodada com 20 briefs
  reais. Claude (SVG) não serve para foto. Limites: 2 amostras por célula e um avaliador.
- Texto sempre com acento e fonte certos, e editável por slot (base para o "Pedir ajuste", BEZ-193).
- A biblioteca é trabalho de manutenção: família nova exige teste de render nos formatos e nos tamanhos
  de texto extremos.
- **A decisão vale com ressalvas.** Antes de confiar no motor sem revisão humana: mais 2 avaliadores
  (um de fora da BEZ), taxa de aprovação de primeira medida numa marca nova (meta acima de 50%) e um
  revisor visual automático (por modelo ou por captura comparada) para os defeitos que a regra não pega.
- Se a aprovação de primeira ficar abaixo da meta, a fase 2 sai com menos famílias e revisão humana
  obrigatória, sem trocar de motor.
