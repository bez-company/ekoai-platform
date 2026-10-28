# SPEC 027: Studio como editor livre, no estilo do Canva

- **Status:** protótipo v21 aprovado pelo Matheus em 28/10/2026 (artifact `55avs7v…`, `version_id` 1793153886-3da7, grupo "Fase 8"); F1 a F3 e o download implementados na PR do BEZ-381. Decisão técnica: [ADR 0026](../adr/0026-studio-em-camadas-sobre-o-fundo-do-layout.md)
- **Data:** 2026-10-27
- **Card:** BEZ-381 (pai); filhos criados quando o protótipo for aprovado
- **Origem:** feedback do Matheus em 27/10/2026: "quero editar tudo por aqui, como no Canva, para o usuário não levar a imagem para o Canva". Hoje o Studio
  ([SPEC 024](024-pedir-ajuste-em-texto-livre-e-estudio.md)) troca texto, cor, canto do logo e layout, e o botão "Preciso de mais controle" só conta o desejo.
- **Depende de:** [ADR 0017](../adr/0017-motor-de-design-hibrido-com-biblioteca-de-layouts.md) (o motor de layouts em SVG), [ADR 0025](../adr/0025-carrossel-como-lista-de-laminas-dentro-do-design.md)
  (carrossel), [SPEC 026](026-logo-e-variacoes.md) (logo exatamente como enviada)

## Problema

O design é um `DesignSpec` (layout + textos + canto do logo). O motor decide onde cada coisa fica, e a pessoa só escolhe entre alguns layouts. Quem quer
mover o título, mudar o tamanho, pôr um segundo texto ou uma forma precisa sair da Ekoai. Não há como guardar a posição de um elemento.

## Decisões propostas

1. **Documento de camadas.** O design ganha `scene`: uma lista ordenada de camadas (`text`, `image`, `shape`, `logo`), cada uma com `x, y, w, h`, rotação,
   opacidade e o estilo do tipo (texto: fonte, tamanho, peso, alinhamento, cor; forma: preenchimento e raio; imagem: recorte). Coordenadas no tamanho do post
   (1080 de largura). Post sem `scene` segue como hoje; abrir no Studio converte o layout em camadas (cada família passa a devolver as camadas que já calcula).
2. **O mesmo desenho no navegador e no servidor.** Um módulo puro `scene-svg` gera o SVG de uma `scene`; o servidor o renderiza com o resvg (o PNG final,
   igual ao de hoje) e o navegador o mostra no canvas, com as mesmas fontes. Arrastar e redimensionar não chama o servidor.
3. **Edição no canvas.** Selecionar, mover, redimensionar pelas alças, girar, editar o texto no lugar, guias de alinhamento e encaixe, setas para ajuste fino, duplicar,
   apagar, ordem das camadas, travar e esconder. Desfazer e Refazer como hoje.
4. **Inserir.** Texto, forma (retângulo, círculo, linha), imagem do Banco de imagens, e o logo da conta (qualquer variação), sempre exatamente como enviado.
5. **Carrossel.** Cada lâmina tem a sua `scene`; copiar um elemento para todas as lâminas; o fundo e a paleta seguem a cara do post (BEZ-380).
6. **Revisor continua valendo.** Margem de segurança, tamanho mínimo e contraste viram avisos na camada; o que reprova no revisor atual continua travando o Confirmar.
7. **Download.** Fase 1: PNG exatamente como vai para o Instagram (a logo sem placa nem moldura). Fase 2: SVG com texto editável e PDF com camadas, para abrir no Canva ou no
   Figma. Aviso honesto: o Canva importa PDF e SVG, mas pode substituir fonte que não tenha; vale testar com a conta do Matheus antes de prometer.

## Entregue na PR do BEZ-381

Cena e conversão de todas as famílias (pixel a pixel), canvas (selecionar, mover com guias, redimensionar, girar, escrever no lugar, alinhar, distribuir, desfazer), inserir texto, retângulo,
círculo e linha, camadas (ordem, travar, ocultar, duplicar), trocar a versão da logo, carrossel lâmina a lâmina, versões e "Pedir à Ekoai" embaixo do editor, baixar PNG e SVG.
Fica para depois: imagem do banco de imagens como camada, copiar elemento para todas as lâminas, PDF com camadas e ver no Canva.

## Fases

| Fase | Entrega | Verifica |
|---|---|---|
| F0 | Protótipo no Claude Design (desktop e mobile; estados vazio, carregando, erro, cheio, texto em edição, múltiplas seleções) | aprovação do Matheus |
| F1 | `scene` e `scene-svg` puros; família atual convertida em camadas; PNG idêntico ao de hoje | teste de igualdade do PNG por família |
| F2 | Canvas: selecionar, mover, redimensionar, girar, texto no lugar, desfazer | E2E de arrastar e confirmar, teste puro das guias |
| F3 | Inserir texto, forma, imagem do banco e logo; ordem e duplicar | E2E + teste de rota de gravação (valida o shape da `scene`) |
| F4 | Carrossel por lâmina (a cena é por lâmina; copiar um elemento para todas fica em aberto) | teste de continuidade e de cópia entre lâminas |
| F5 | Download PNG fiel, depois SVG e PDF com camadas | abrir o arquivo no Canva e no Figma (manual, registrado na PR) |

## Dados e rotas (a confirmar)

| Item | Mudança |
|---|---|
| `post_designs.design` | campo opcional `scene` (JSON validado na fronteira por parser puro; limite de camadas e de tamanho) |
| `POST /api/posts/[id]/design/revisions` | aceita `scene` além dos campos de hoje; mesma conferência de versão (409 se outra pessoa salvou) |
| `GET /api/posts/[id]/design/export?format=png\|svg\|pdf` | `content.view`; PNG da versão atual; SVG e PDF a partir da `scene` |
| Fontes | as mesmas de `platform/fonts`, servidas também ao navegador (`@font-face`) |

## Riscos

- Fonte diferente entre navegador e resvg muda a quebra de linha: o canvas mede com as mesmas métricas do motor (`text.ts`) e o PNG do servidor é a verdade.
- O motor de famílias hoje devolve SVG pronto: converter em camadas é o maior trabalho da F1; começa pelas famílias mais usadas.
- Texto em SVG exportado depende da fonte instalada no destino: o PDF embute as fontes.

## Como verificar

Igualdade do PNG antes e depois da conversão em camadas, teste puro do parser da `scene` (formato inválido, camadas demais, coordenada fora do post), E2E de
mover e redimensionar com o PNG confirmado no servidor, e a abertura do SVG e do PDF exportados no Canva.
