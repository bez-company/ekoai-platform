# Gerador dos vídeos de marketing

Gera vídeos verticais (1080x1920, 30 fps) com [HyperFrames](https://hyperframes.heygen.com) a partir de um roteiro em
`src/videos.mjs`, usando capturas de tela do protótipo da plataforma. Catálogo e textos: [../04-videos.md](../04-videos.md).

## O que fica fora do Git

| Pasta | O que é | Como recuperar |
| --- | --- | --- |
| `takes/` | PNGs das telas (desktop 2x e mobile 3x) | `PROTO_HTML=<index-v29.html> node tools/shoot.cjs` |
| `src/assets/` | `gsap.min.js`, fontes Sora e DM Mono (`assets/fonts/`), trilha `music.mp3` | GSAP por npm ou CDN (3.15); fontes em `ekoai-website/src/fonts`; trilha licenciada à escolha |
| `projects/`, `out/` | Projetos gerados e vídeos renderizados | `node src/build.mjs` e `./render-all.sh` |

O protótipo v29 (HTML de 1,3 MB, dados fictícios da "Doce Ponto") está anexado ao card BEZ-562 do ClickUp e publicado
como artifact no Claude Design.

## Passo a passo

```sh
cd docs/marketing/video-pipeline
(cd tools && npm install)
PROTO_HTML=/caminho/index-v29.html node tools/shoot.cjs   # gera takes/
# colocar gsap.min.js, fonts/ e music.mp3 em src/assets/
node src/build.mjs                                        # gera projects/<id>/
(cd projects/v1-ekoai-em-45s && npx hyperframes check && npx hyperframes snapshot --at 3,9,15)
./render-all.sh                                           # out/<id>.mp4
```

## Roteiro

Cada vídeo é uma lista de cenas em `src/videos.mjs`:

| Tipo | Campos |
| --- | --- |
| `hook` | `text` (use `*destaque*`), `kicker`, `size` |
| `shot` | `img` (take), `title`, `kicker`, `chip`, `to` e `from` (retângulo da tela em frações x, y, largura, altura), `kind: 'phone'` para mobile |
| `pains` | `title`, `items` (pares dor e resposta) |
| `end` | `tag`, `cta` |

Não usar preço nem promessa de venda nos textos. Conferir cada take contra a staging antes de publicar.
