# Custo da infraestrutura (20/10/2026)

> Levantamento com preços oficiais lidos em 20/10/2026 (Google Cloud, Supabase, Vercel, Neon). Câmbio
> de R$ 5,90 por US$, tirado do crédito de teste. Sem impostos. O que não foi verificado está marcado.
> Cartão: BEZ-79.

## O que custa na Ekoai hoje

O custo é da **máquina do banco ligada**, não do esquema nem dos dados: o Cloud SQL cobra por hora
pelo tamanho da instância e pelo disco reservado. Um banco vazio custa o mesmo que um cheio.

| Item (São Paulo) | US$ por mês |
| --- | --- |
| Cloud SQL de produção, `db-g1-small` | 38,33 |
| Cloud SQL de staging, `db-f1-micro` | 11,53 |
| Disco SSD de 10 GB, em cada banco (US$ 0,255 por GB) | 2 × 2,55 |
| Cloud Run (mínimo 0), Artifact Registry, Scheduler, KMS e segredos | 3 a 7 (estimado) |
| **Total** | **58 a 62** |

Nenhum tamanho compartilhado (`f1-micro`, `g1-small`) tem SLA (nota da página oficial). Uma instância
comporta vários bancos, e o custo é da máquina, não do banco.

## Escada de redução (Ekoai, US$ por mês)

| Passo | US$ | R$ |
| --- | --- | --- |
| Como estava | 58 a 62 | 340 a 366 |
| Só desligar o banco do staging | 47 a 51 | 277 a 300 |
| **Produção em `f1-micro`** (esta mudança) e staging desligado | 20 a 24 | 118 a 142 |
| Produção também desligada até o primeiro cliente | 9 a 12 | 53 a 71 |

Com o staging ligado o mês todo ao lado do `f1-micro` de produção, soma-se US$ 11,53.

## Preços usados

- Cloud SQL em São Paulo: `db-f1-micro` US$ 11,53; `db-g1-small` US$ 38,33; instância dedicada com 1 vCPU
  e 3,75 GB cerca de US$ 74; com 2 vCPU e 8 GB cerca de US$ 152 (US$ 0,062 por vCPU-hora e US$ 0,0105 por
  GiB-hora, mais disco).
- Supabase: plano Pro US$ 25 por organização, com US$ 10 de crédito de máquina; projeto extra Micro US$ 10;
  branch persistente US$ 0,01344 por hora (cerca de US$ 9,81 por mês), banco separado, sem cobertura do
  crédito do Pro nem do spend cap.
- Vercel: o plano Hobby é só para uso pessoal; Pro US$ 20 por mês por assento, com US$ 20 de uso.
- Neon: pago por uso, US$ 0,106 por CU-hora e US$ 0,35 por GB, desliga sozinho depois de 5 minutos parado,
  região em São Paulo.
- Modelo de imagem (`gemini-3.1-flash-image`, Vertex AI, global): US$ 60 por milhão de tokens de saída de
  imagem, cerca de 1.120 tokens por imagem, ou US$ 0,067. Texto: menos de US$ 0,002 por post.

## Por número de projetos (US$ por mês)

Cada projeto com banco de produção e de staging, dados pequenos. Estimativa, com as suposições abaixo.

| Projetos | Supabase + Vercel (staging fixo) | Supabase + Vercel (staging só nos testes) | Neon + Vercel | Cloud SQL dividido + Cloud Run | Cloud SQL, uma instância por projeto e por ambiente |
| --- | --- | --- | --- | --- | --- |
| 1 | 55 | 46 | 26 | 19 | 58 |
| 3 | 94 | 67 | 40 | 50 | 174 |
| 5 | 134 | 88 | 52 | 54 | 290 |
| 10 | 233 | 140 | 85 | 102 | 580 |
| 20 | 451 | 266 | 170 | 202 | 1.159 |
| 50 | 1.106 | 642 | 425 | 419 | 2.898 |

Suposições: Vercel com US$ 2 de uso por app contra US$ 20 de crédito; Neon com cerca de US$ 6,50 por
projeto (depende das horas ativas); Cloud Run com US$ 2 por app; capacidade do Cloud SQL dividido é palpite
e precisa ser medida. A coluna de uma instância por projeto é o modelo que ficou caro.

## Decisão

1. Produção da Ekoai em `db-f1-micro` até haver cliente pagante. Subir o tamanho reinicia o banco por
   alguns minutos.
2. Staging: ver a decisão registrada no cartão.
3. Trocar de provedor de banco não economiza para a Ekoai: no Supabase ela custaria cerca de US$ 20
   (produção US$ 10 e staging US$ 9,81), igual ao Google Cloud ajustado, e custaria semanas de trabalho.
4. Reavaliar quando houver mais de 3 produtos: aí compensa dividir os bancos pequenos numa instância só.

Pedido de crédito do Google for Startups (nível Start, US$ 2.000): ainda não feito, elegibilidade a
confirmar.
