# SPEC 035: a aprovação guarda os fatos e a oferta que o post afirma

- **Status:** em implementação (04/11/2026)
- **Data:** 2026-11-04
- **Cards:** BEZ-543 (esta spec); pai BEZ-542 (roadmap AI-native)
- **Origem:** EKO-03 em [`docs/analises/2026-11-03-documentacao-mestra-ai-native.md`](../analises/2026-11-03-documentacao-mestra-ai-native.md) (seções 14.2 e 19.4)
- **Depende de:** conferência antes de publicar (BEZ-275, `lib/publish-preflight*.ts`), fatos (SPEC 018, `company_facts`), campanhas (SPEC 018)

## Problema

A conferência antes de publicar (BEZ-275) só reconhece um fato pelo número que o post repete, e só quando esse fato deixou de
valer. Três mudanças depois da aprovação passam sem ser vistas:

1. A pessoa **edita** o fato: "Bolo de pote por R$ 18" vira "por R$ 20". O post aprovado ainda diz R$ 18, e nenhum fato vigente
   ou vencido tem mais o 18.
2. A pessoa **desliga** ou **apaga** o fato. Desligado não entra na lista de vencidos; apagado some.
3. A pessoa muda a **oferta da campanha** ("10% na primeira encomenda" vira "15%").

O agendado não sabe em que fatos e em que oferta o post se apoiou quando foi aprovado.

## Decisões

1. **Base da aprovação** (`scheduled_posts.approval_basis`, jsonb, migration 0063): na aprovação, guardar `{ at, facts: [{ id,
   text }], campaign: { id, offering } | null }`. Entra o fato do tipo `fact`, ligado, cujo número aparece no texto do post (legenda,
   arte, lâminas, texto alternativo) ou cujo texto inteiro aparece nele. A regra é por código, sem modelo e sem custo. Vale para
   Aprovar, Aprovar todas da ideia e Publicar foto de quem aprova.
2. **Na conferência**, cada fato da base precisa existir, estar vigente (ou vencendo) e ter o mesmo texto. Senão o post fica
   segurado com o motivo: "foi apagado", "mudou de 'A' para 'B'" ou "não vale mais". A oferta da campanha que mudou segura o post
   quando um número da oferta antiga está no post.
3. **Agendado sem base** (aprovado antes desta mudança, ou base que falhou ao ser lida) continua só com a regra por número do
   BEZ-275. A falha ao montar a base não impede a aprovação: vai para o log e o post segue sem base.
4. **Sem tela nova.** O motivo aparece no estado "Não publicado" que já existe e no aviso `publish.held`.

## Fora de escopo

Saber qual fato o modelo "quis" usar (pedir ao modelo a lista de fatos) e a mídia na base (o consentimento já é conferido pela foto
do banco no BEZ-275).

## Aceite

- Fato editado, desligado ou apagado depois da aprovação segura o post; o mesmo fato sem mudança deixa publicar.
- Oferta da campanha alterada com número no post segura; alterada sem número no post deixa publicar.
- Agendado sem base se comporta como antes.
- Teste no Postgres: aprovar grava a base; editar o fato e rodar o cron não chama a Meta.
