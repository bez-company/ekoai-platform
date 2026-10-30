-- 0060_brief_studio_fallback.sql: o pedido que pediu Refinado ou Autoral e saiu como Rápido (SPEC 030, decisão 6, BEZ-497). Aditivo e reaplicável.
-- `fallback_from`: o nível que a pessoa pediu e não saiu; `fallback_reason`: o motivo em uma frase para a pessoa. O motor de hoje leva os dois
-- para a pendência e a tela de revisão avisa. Nulos no pedido que saiu no nível pedido.

alter table briefs add column if not exists fallback_from text
  check (fallback_from is null or fallback_from in ('refinado', 'autoral'));

alter table briefs add column if not exists fallback_reason text
  check (fallback_reason is null or length(fallback_reason) <= 300);
