-- rls_test.sql: prova o isolamento por tenant contra um Postgres de verdade (gate 4 da
-- esteira). Roda como o papel que o app usa (authenticated, com o JWT simulado), não
-- como superuser: superuser ignora RLS e o teste passaria por acidente.
--
-- Uso: psql "$PGURL" -v ON_ERROR_STOP=1 -f supabase/ci/bootstrap.sql (antes das migrations)
--      psql "$PGURL" -v ON_ERROR_STOP=1 -f supabase/ci/rls_test.sql
-- Tudo roda numa transação desfeita no fim: o banco sai como entrou.

\set ON_ERROR_STOP 1
begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- Catálogo: regras que valem para toda tabela, inclusive as que ainda vão nascer.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare r record;
begin
  -- toda tabela de public tem RLS ligado
  for r in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
  loop
    raise exception 'tabela % sem RLS', r.relname;
  end loop;

  -- toda tabela com tenant_id tem policy de leitura para authenticated
  for r in
    select c.relname from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
    where n.nspname = 'public' and c.relkind = 'r'
      and not exists (
        select 1 from pg_policy p
        where p.polrelid = c.oid and p.polcmd in ('r', '*') and 'authenticated'::regrole = any (p.polroles)
      )
  loop
    raise exception 'tabela % tem tenant_id mas não tem policy de leitura', r.relname;
  end loop;

  -- nenhum tenant_id tem default: quem insere informa o tenant (0013)
  for r in
    select table_name from information_schema.columns
    where table_schema = 'public' and column_name = 'tenant_id' and column_default is not null
  loop
    raise exception 'tenant_id de % tem default; informe o tenant em todo insert', r.table_name;
  end loop;

  -- anon não toca em tabela nenhuma
  for r in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and (has_table_privilege('anon', c.oid, 'SELECT') or has_table_privilege('anon', c.oid, 'INSERT')
        or has_table_privilege('anon', c.oid, 'UPDATE') or has_table_privilege('anon', c.oid, 'DELETE'))
  loop
    raise exception 'anon tem privilégio em %', r.relname;
  end loop;

  -- banco portável (SPEC 008): nada ativo depende do schema auth do Supabase
  for r in
    select p.polname, p.polrelid::regclass::text as rel from pg_policy p
    where coalesce(pg_get_expr(p.polqual, p.polrelid), '') || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') ~ '\mauth\.'
  loop
    raise exception 'policy % de % depende do schema auth', r.polname, r.rel;
  end loop;
  for r in
    select n.nspname, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'app') and p.prokind = 'f' and pg_get_functiondef(p.oid) ~ '\mauth\.'
  loop
    raise exception 'função %.% depende do schema auth', r.nspname, r.proname;
  end loop;
  for r in
    select c.conname from pg_constraint c join pg_class t on t.oid = c.confrelid join pg_namespace n on n.oid = t.relnamespace
    where c.contype = 'f' and n.nspname = 'auth'
  loop
    raise exception 'FK % aponta para o schema auth', r.conname;
  end loop;

  -- nenhuma função SECURITY DEFINER de public/app é executável por anon
  for r in
    select n.nspname, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'app') and p.prosecdef and has_function_privilege('anon', p.oid, 'EXECUTE')
  loop
    raise exception 'função SECURITY DEFINER %.% executável por anon', r.nspname, r.proname;
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Cenário: dois tenants, cinco pessoas (SPEC 008).
--   A: admin da exemplo    B: creator da exemplo    V: viewer da exemplo
--   D: viewer da acme (entra pelo JWT, como no Supabase)      E: logado sem tenant
-- A, B, V e E entram por app.user_id, como o nosso servidor faz.
-- ─────────────────────────────────────────────────────────────────────────────
insert into users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@test'),
  ('00000000-0000-0000-0000-00000000000b', 'b@test'),
  ('00000000-0000-0000-0000-00000000000f', 'v@test'),
  ('00000000-0000-0000-0000-00000000000d', 'd@test'),
  ('00000000-0000-0000-0000-00000000000e', 'e@test'),
  ('00000000-0000-0000-0000-000000000099', 'acme-admin@test');
insert into tenants (id, name) values ('exemplo', 'Exemplo'), ('acme', 'Acme') on conflict (id) do nothing;
-- tenant novo nasce pausado (trigger da 0013)
do $$
begin
  if not exists (select 1 from publishing_controls where tenant_id = 'acme' and paused) then
    raise exception 'tenant novo deveria nascer pausado';
  end if;
end $$;
insert into tenant_members (tenant_id, user_id, role) values
  ('exemplo', '00000000-0000-0000-0000-00000000000a', 'admin'),
  ('exemplo', '00000000-0000-0000-0000-00000000000b', 'creator'),
  ('exemplo', '00000000-0000-0000-0000-00000000000f', 'viewer'),
  ('acme',  '00000000-0000-0000-0000-000000000099', 'admin'),
  ('acme',  '00000000-0000-0000-0000-00000000000d', 'viewer');
insert into feedback (tenant_id, aspect, note) values ('exemplo', 'tom', 'rls-exemplo'), ('acme', 'tom', 'rls-acme');
insert into posts (tenant_id, pillar, channel) values ('exemplo', 'dica', 'instagram'), ('acme', 'dica', 'instagram');
insert into notifications (tenant_id, kind, title) values ('exemplo', 'rls', 'rls-exemplo'), ('acme', 'rls', 'rls-acme');

-- ── A: admin da exemplo ────────────────────────────────────────────────────────
set role authenticated;
select set_config('app.user_id', '00000000-0000-0000-0000-00000000000a', false);
do $$
declare n int;
begin
  select count(*) into n from feedback where note like 'rls-%';
  if n <> 1 then raise exception 'A deveria ver 1 feedback, viu %', n; end if;
  if exists (select 1 from feedback where tenant_id <> 'exemplo') then raise exception 'A viu feedback de outro tenant'; end if;
  if exists (select 1 from posts where tenant_id <> 'exemplo') then raise exception 'A viu post de outro tenant'; end if;
  select count(*) into n from tenants;
  if n <> 1 then raise exception 'A deveria ver só o próprio tenant, viu %', n; end if;
  select count(*) into n from users;
  if n <> 3 then raise exception 'A deveria ver a si e 2 colegas, viu % pessoas', n; end if;

  insert into feedback (tenant_id, aspect, note) values ('exemplo', 'tom', 'rls-a-ok');
  insert into style_rules (tenant_id, rule, aspect, source) values ('exemplo', 'rls-a-regra', 'tom', 'manual');
  update publishing_controls set paused = false where tenant_id = 'exemplo';
  insert into scheduled_posts (tenant_id, channel, variation, caption_final, scheduled_for)
    values ('exemplo', 'linkedin', '{"id":1}', 'rls-a-agenda', now());

  begin
    insert into feedback (tenant_id, aspect, note) values ('acme', 'tom', 'rls-a-invade');
    raise exception 'A gravou feedback na acme';
  exception when insufficient_privilege then null;
  end;

  update feedback set note = 'rls-a-alterou' where tenant_id = 'acme';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'A alterou % linha(s) da acme', n; end if;

  begin
    insert into posts (tenant_id, pillar, channel) values ('exemplo', 'dica', 'instagram');
    raise exception 'A gravou em posts (só jobs gravam)';
  exception when insufficient_privilege then null;
  end;

  select count(*) into n from notifications where kind = 'rls';
  if n <> 1 then raise exception 'A deveria ver 1 aviso, viu %', n; end if;
  begin
    insert into notifications (tenant_id, kind, title) values ('exemplo', 'rls', 'rls-a-forja');
    raise exception 'A gravou aviso (só jobs gravam)';
  exception when insufficient_privilege then null;
  end;

  begin
    update tenant_members set role = 'admin' where user_id = '00000000-0000-0000-0000-00000000000b';
    raise exception 'A mudou papel direto no banco (passa pelo servidor)';
  exception when insufficient_privilege then null;
  end;

  if app.can('exemplo', 'permissao.que.nao.existe') then raise exception 'permissão desconhecida passou'; end if;
end $$;

-- ── B: creator da exemplo ──────────────────────────────────────────────────────
select set_config('app.user_id', '00000000-0000-0000-0000-00000000000b', false);
do $$
begin
  insert into feedback (tenant_id, aspect, note) values ('exemplo', 'tom', 'rls-b-ok');
  insert into briefs (tenant_id, pillar, angle, idea, status) values ('exemplo', 'dica', 'rls', 'rls-b-brief', 'producing');

  begin
    insert into style_rules (tenant_id, rule, aspect, source) values ('exemplo', 'rls-b-regra', 'tom', 'manual');
    raise exception 'creator B mexeu na marca';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into scheduled_posts (tenant_id, channel, variation, caption_final, scheduled_for)
      values ('exemplo', 'linkedin', '{"id":1}', 'rls-b-agenda', now());
    raise exception 'creator B agendou sem a conta liberar';
  exception when insufficient_privilege then null;
  end;

  begin
    update publishing_controls set paused = true where tenant_id = 'exemplo';
    if found then raise exception 'creator B pausou a publicação'; end if;
  end;
end $$;

-- a conta libera a aprovação do criador
reset role;
update tenants set creator_can_approve = true where id = 'exemplo';
set role authenticated;
do $$
begin
  insert into scheduled_posts (tenant_id, channel, variation, caption_final, scheduled_for)
    values ('exemplo', 'linkedin', '{"id":1}', 'rls-b-agenda-liberado', now());
end $$;

-- ── V: viewer da exemplo (revisor: dá parecer e feedback) ──────────────────────
select set_config('app.user_id', '00000000-0000-0000-0000-00000000000f', false);
do $$
declare n int;
begin
  insert into feedback (tenant_id, aspect, note) values ('exemplo', 'tom', 'rls-v-parecer');

  update feedback set note = 'rls-v-alterou' where tenant_id = 'exemplo';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'viewer V alterou % feedback(s)', n; end if;

  begin
    insert into briefs (tenant_id, pillar, angle, idea, status) values ('exemplo', 'dica', 'rls', 'rls-v-brief', 'producing');
    raise exception 'viewer V criou brief';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into scheduled_posts (tenant_id, channel, variation, caption_final, scheduled_for)
      values ('exemplo', 'linkedin', '{"id":1}', 'rls-v-agenda', now());
    raise exception 'viewer V agendou';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ── D: viewer da acme, pelo JWT (caminho do Supabase) ────────────────────────
select set_config('app.user_id', '', false);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000d"}', false);
do $$
declare n int;
begin
  select count(*) into n from feedback where note like 'rls-%';
  if n <> 1 then raise exception 'D deveria ver 1 feedback, viu %', n; end if;
  if exists (select 1 from feedback where tenant_id <> 'acme') then raise exception 'D viu feedback de outro tenant'; end if;
  if exists (select 1 from users where email = 'a@test') then raise exception 'D viu pessoa de outra conta'; end if;
end $$;

-- ── E: logado sem tenant (cadastro aberto não dá acesso a nada) ──────────────
select set_config('request.jwt.claims', '', false);
select set_config('app.user_id', '00000000-0000-0000-0000-00000000000e', false);
do $$
declare n int;
begin
  if exists (select 1 from feedback) then raise exception 'E sem tenant viu feedback'; end if;
  if exists (select 1 from notifications) then raise exception 'E sem tenant viu aviso'; end if;
  if exists (select 1 from tenants) then raise exception 'E sem tenant viu tenant'; end if;
  if exists (select 1 from tenant_members) then raise exception 'E sem tenant viu membros'; end if;
  select count(*) into n from users;
  if n <> 1 then raise exception 'E deveria ver só a si mesmo, viu %', n; end if;
end $$;

-- ── Pelo menos um administrador ──────────────────────────────────────────────
reset role;
select set_config('app.user_id', '', false);
do $$
begin
  begin
    delete from tenant_members where tenant_id = 'exemplo' and user_id = '00000000-0000-0000-0000-00000000000a';
    raise exception 'o último admin da exemplo saiu';
  exception when check_violation then null;
  end;
  begin
    update tenant_members set role = 'creator' where tenant_id = 'exemplo' and user_id = '00000000-0000-0000-0000-00000000000a';
    raise exception 'o último admin da exemplo foi rebaixado';
  exception when check_violation then null;
  end;

  -- com um segundo admin, o primeiro pode ser rebaixado
  update tenant_members set role = 'admin' where tenant_id = 'exemplo' and user_id = '00000000-0000-0000-0000-00000000000b';
  update tenant_members set role = 'creator' where tenant_id = 'exemplo' and user_id = '00000000-0000-0000-0000-00000000000a';

  -- apagar a conta inteira leva os membros junto, inclusive o último admin
  insert into tenants (id, name) values ('beta', 'Beta');
  insert into tenant_members (tenant_id, user_id, role) values ('beta', '00000000-0000-0000-0000-00000000000e', 'admin');
  delete from publishing_controls where tenant_id = 'beta';
  delete from tenants where id = 'beta';
  if exists (select 1 from tenant_members where tenant_id = 'beta') then raise exception 'membros da beta sobraram'; end if;
end $$;

-- ── anon: nem chega na tabela ────────────────────────────────────────────────
reset role;
set role anon;
do $$
begin
  begin
    perform 1 from feedback;
    raise exception 'anon leu feedback';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
rollback;
\echo 'RLS: isolamento por tenant ok'
