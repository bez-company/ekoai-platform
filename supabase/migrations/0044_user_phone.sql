-- 0044_user_phone.sql: celular de contato da pessoa (BEZ-356). Pedido no cadastro, junto de nome e e-mail, e editável em
-- Seu perfil. Guardado em E.164 (+5511912345678). Aditivo e reaplicável (o CI roda duas vezes): a coluna só é criada
-- se não existir; quem já tem conta fica sem celular até preencher.

alter table users add column if not exists phone text
  check (phone is null or phone ~ '^\+[0-9]{10,15}$');
