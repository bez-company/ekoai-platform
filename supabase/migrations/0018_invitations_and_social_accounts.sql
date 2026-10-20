-- 0018_invitations_and_social_accounts.sql: convites da equipe, contas de rede conectadas e os
-- limites do plano (SPEC 011 R4, R5 e R7).
--
-- 1. invitations: convite por e-mail com papel, de uso único, válido por 7 dias. O banco guarda
--    só o hash do token; o token inteiro vai no e-mail e nunca é gravado. app.accept_invitation()
--    aceita o convite numa transação só (trava a linha: duas aceitações ao mesmo tempo não passam).
-- 2. social_accounts: a conta de rede conectada (Instagram), só metadados. Os tokens ficam em
--    social_account_secrets, tabela à parte, sem tenant_id e sem nenhuma permissão para a API:
--    a exportação (LGPD) e o RLS nunca chegam nela. O token só entra cifrado (Cloud KMS, feito no
--    servidor); o banco guarda o texto cifrado e a versão da chave.
-- 3. Limites do plano no banco: pessoas (membros mais convites pendentes) e contas de Instagram.
--    O servidor também checa para dar a mensagem, mas quem barra é o gatilho.
--
-- allow-destructive: o único `delete` está no gatilho que apaga os tokens de uma conta de rede ao
-- marcá-la como revogada. Nenhum dado de cliente além do próprio token é apagado.
--
-- Aditivo e reaplicável (o CI roda duas vezes).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Convites
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists invitations (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     text not null references tenants(id) on delete cascade,
  email         text not null check (email = lower(email) and position('@' in email) > 1 and length(email) <= 254),
  role          text not null check (role in ('admin', 'creator', 'viewer')),
  token_hash    text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  invited_by    uuid references users(id) on delete set null,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null default (now() + interval '7 days'),
  accepted_at   timestamptz,
  accepted_by   uuid references users(id) on delete set null,
  cancelled_at  timestamptz,
  check (accepted_at is null or cancelled_at is null)
);

-- Um convite pendente por pessoa e conta. Reenviar troca o token e a validade da mesma linha.
create unique index if not exists invitations_pending_uidx on invitations (tenant_id, email)
  where accepted_at is null and cancelled_at is null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Contas de rede e tokens cifrados
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists social_accounts (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      text not null references tenants(id) on delete cascade,
  channel        text not null check (channel in ('instagram', 'linkedin', 'twitter')),
  external_id    text not null check (length(external_id) between 1 and 100),
  handle         text check (handle is null or length(handle) <= 100),
  status         text not null default 'active' check (status in ('active', 'reauth_required', 'revoked')),
  status_reason  text check (status_reason is null or length(status_reason) <= 200),
  scopes         text[] not null default '{}',
  expires_at     timestamptz,
  connected_by   uuid references users(id) on delete set null,
  connected_at   timestamptz not null default now(),
  refreshed_at   timestamptz,
  updated_at     timestamptz not null default now()
);

-- Uma conta de rede conectada em uma conta só (revogada libera para conectar de novo).
create unique index if not exists social_accounts_live_uidx on social_accounts (channel, external_id)
  where status <> 'revoked';
create index if not exists social_accounts_tenant_idx on social_accounts (tenant_id, channel);

drop trigger if exists social_accounts_touch on social_accounts;
create trigger social_accounts_touch before update on social_accounts
  for each row execute function app.touch_updated_at();

-- Sem tenant_id de propósito: o teste de RLS exige policy de leitura em toda tabela com
-- tenant_id, e o texto cifrado não pode ser lido pela API nem sair na exportação.
create table if not exists social_account_secrets (
  social_account_id         uuid primary key references social_accounts(id) on delete cascade,
  access_token_ciphertext   text not null check (length(access_token_ciphertext) > 0),
  refresh_token_ciphertext  text check (refresh_token_ciphertext is null or length(refresh_token_ciphertext) > 0),
  key_version               text not null check (length(key_version) between 1 and 300),
  updated_at                timestamptz not null default now()
);

drop trigger if exists social_account_secrets_touch on social_account_secrets;
create trigger social_account_secrets_touch before update on social_account_secrets
  for each row execute function app.touch_updated_at();

-- Conta revogada não guarda token.
create or replace function app.drop_secrets_on_revoke()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.status = 'revoked' then
    delete from public.social_account_secrets where social_account_id = new.id;
  end if;
  return new;
end;
$$;
revoke execute on function app.drop_secrets_on_revoke() from public;

drop trigger if exists social_accounts_drop_secrets on social_accounts;
create trigger social_accounts_drop_secrets after update of status on social_accounts
  for each row when (new.status = 'revoked') execute function app.drop_secrets_on_revoke();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Limites do plano
-- ─────────────────────────────────────────────────────────────────────────────
-- Pessoas: membros da conta mais convites pendentes e não vencidos. Ao aceitar, conta só quem já
-- é membro (o convite aceito é o que vira membro). O lock evita que duas inserções simultâneas
-- passem juntas pelo limite.
create or replace function app.check_seat_limit()
returns trigger
language plpgsql set search_path = ''
as $$
declare
  v_max  integer;
  v_used integer;
begin
  perform pg_advisory_xact_lock(hashtext('seats:' || new.tenant_id));
  select p.max_seats into v_max
  from public.tenants t join public.plans p on p.id = t.plan_id
  where t.id = new.tenant_id;
  if v_max is null then
    return new;
  end if;
  select count(*) into v_used from public.tenant_members m where m.tenant_id = new.tenant_id;
  if tg_table_name = 'invitations' then
    v_used := v_used + (
      select count(*) from public.invitations i
      where i.tenant_id = new.tenant_id and i.accepted_at is null and i.cancelled_at is null and i.expires_at > now()
    );
  end if;
  if v_used >= v_max then
    raise exception 'o plano da conta % permite % pessoa(s) e o limite foi atingido', new.tenant_id, v_max
      using errcode = 'check_violation', hint = 'plan_seats';
  end if;
  return new;
end;
$$;
revoke execute on function app.check_seat_limit() from public;

drop trigger if exists tenant_members_seat_limit on tenant_members;
create trigger tenant_members_seat_limit before insert on tenant_members
  for each row execute function app.check_seat_limit();
drop trigger if exists invitations_seat_limit on invitations;
create trigger invitations_seat_limit before insert on invitations
  for each row execute function app.check_seat_limit();

-- Contas de Instagram: as não revogadas contam para o limite do plano.
create or replace function app.check_instagram_limit()
returns trigger
language plpgsql set search_path = ''
as $$
declare
  v_max  integer;
  v_used integer;
begin
  if new.channel <> 'instagram' or new.status = 'revoked' then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext('instagram:' || new.tenant_id));
  select p.max_instagram_accounts into v_max
  from public.tenants t join public.plans p on p.id = t.plan_id
  where t.id = new.tenant_id;
  if v_max is null then
    return new;
  end if;
  select count(*) into v_used from public.social_accounts s
  where s.tenant_id = new.tenant_id and s.channel = 'instagram' and s.status <> 'revoked' and s.id <> new.id;
  if v_used >= v_max then
    raise exception 'o plano da conta % permite % conta(s) de Instagram e o limite foi atingido', new.tenant_id, v_max
      using errcode = 'check_violation', hint = 'plan_instagram';
  end if;
  return new;
end;
$$;
revoke execute on function app.check_instagram_limit() from public;

drop trigger if exists social_accounts_instagram_limit on social_accounts;
create trigger social_accounts_instagram_limit before insert or update of status on social_accounts
  for each row execute function app.check_instagram_limit();

-- ─────────────────────────────────────────────────────────────────────────────
-- Aceitar convite (só o servidor chama: o usuário vem da sessão, nunca de parâmetro do cliente)
-- ─────────────────────────────────────────────────────────────────────────────
-- Devolve o id da conta. Os erros têm mensagem fixa para a tela escolher o estado:
-- invitation_not_found, invitation_cancelled, invitation_used, invitation_expired,
-- invitation_email_mismatch (convite de outro e-mail) e already_member.
create or replace function app.accept_invitation(p_token_hash text, p_user_id uuid)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_inv   public.invitations;
  v_email text;
begin
  select * into v_inv from public.invitations where token_hash = p_token_hash for update;
  if not found then
    raise exception 'invitation_not_found';
  end if;
  if v_inv.cancelled_at is not null then
    raise exception 'invitation_cancelled';
  end if;
  if v_inv.accepted_at is not null then
    raise exception 'invitation_used';
  end if;
  if v_inv.expires_at <= now() then
    raise exception 'invitation_expired';
  end if;
  select email into v_email from public.users where id = p_user_id;
  if v_email is distinct from v_inv.email then
    raise exception 'invitation_email_mismatch';
  end if;
  if exists (select 1 from public.tenant_members where tenant_id = v_inv.tenant_id and user_id = p_user_id) then
    raise exception 'already_member';
  end if;
  insert into public.tenant_members (tenant_id, user_id, role) values (v_inv.tenant_id, p_user_id, v_inv.role);
  update public.invitations set accepted_at = now(), accepted_by = p_user_id where id = v_inv.id;
  return v_inv.tenant_id;
end;
$$;
revoke execute on function app.accept_invitation(text, uuid) from public, anon, authenticated;
grant execute on function app.accept_invitation(text, uuid) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────────────────────────
alter table invitations            enable row level security;
alter table social_accounts        enable row level security;
alter table social_account_secrets enable row level security;

-- Convites: o administrador da conta lê. Criar, reenviar e cancelar passa pelo servidor, que gera
-- o token e grava o hash.
drop policy if exists invitations_select on invitations;
create policy invitations_select on invitations for select to authenticated using (app.can(tenant_id, 'team.manage'));

-- Contas de rede: admin e criador veem os metadados. Conectar e desconectar passa pelo servidor.
drop policy if exists social_accounts_select on social_accounts;
create policy social_accounts_select on social_accounts for select to authenticated using (app.can(tenant_id, 'channels.view'));

revoke all on invitations, social_accounts, social_account_secrets from anon, authenticated;
grant select on invitations, social_accounts to authenticated;
grant all on invitations, social_accounts, social_account_secrets to service_role;
