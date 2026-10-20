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

  -- tabela de segredo (nome termina em _secrets) fica fora do alcance da API: sem privilégio e sem policy
  for r in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relname like '%\_secrets'
      and (has_table_privilege('authenticated', c.oid, 'SELECT') or has_table_privilege('authenticated', c.oid, 'INSERT')
        or has_table_privilege('authenticated', c.oid, 'UPDATE') or has_table_privilege('authenticated', c.oid, 'DELETE')
        or exists (select 1 from pg_policy p where p.polrelid = c.oid))
  loop
    raise exception 'tabela de segredo % está ao alcance da API', r.relname;
  end loop;

  -- platform_admins não tem policy nem privilégio para a API (ultra-admin.md: sem acesso pela API)
  for r in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'platform_admins'
      and (has_table_privilege('authenticated', c.oid, 'SELECT') or has_table_privilege('authenticated', c.oid, 'INSERT')
        or has_table_privilege('authenticated', c.oid, 'UPDATE') or has_table_privilege('authenticated', c.oid, 'DELETE')
        or exists (select 1 from pg_policy p where p.polrelid = c.oid))
  loop
    raise exception 'platform_admins está ao alcance da API';
  end loop;

  -- o administrador da plataforma não aparece em nenhuma policy (nada de bypass no RLS)
  for r in
    select p.polname, p.polrelid::regclass::text as rel from pg_policy p
    where coalesce(pg_get_expr(p.polqual, p.polrelid), '') || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') ~ 'platform_admins'
  loop
    raise exception 'policy % de % menciona platform_admins', r.polname, r.rel;
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

-- ─────────────────────────────────────────────────────────────────────────────
-- Fase 1 da plataforma (SPEC 011): planos, perfil, convites, redes e auditoria.
-- A (admin), B (creator) e V (viewer) da exemplo; E sem conta; a acme é a outra conta.
-- ─────────────────────────────────────────────────────────────────────────────
reset role;
select set_config('app.user_id', '', false);

insert into brand_assets (id, tenant_id, kind, storage_path, content_type, byte_size) values
  ('10000000-0000-0000-0000-000000000001', 'exemplo', 'logo', 'tenants/exemplo/brand/logo-1.png', 'image/png', 1000),
  ('10000000-0000-0000-0000-000000000002', 'acme',    'logo', 'tenants/acme/brand/logo-1.png',    'image/png', 1000);
insert into company_profiles (tenant_id, niche, offering, audience, logo_asset_id) values
  ('exemplo', 'Alimentação', 'Bolos sob encomenda', 'Famílias de Marília', '10000000-0000-0000-0000-000000000001'),
  ('acme', 'Serviços profissionais', 'Consultoria', 'Pequenas empresas', null);
insert into invitations (tenant_id, email, role, token_hash) values
  ('exemplo', 'novo@exemplo.test', 'viewer', repeat('a', 64)),
  ('acme',    'novo@acme.test',    'viewer', repeat('b', 64));
insert into social_accounts (id, tenant_id, channel, external_id, handle) values
  ('20000000-0000-0000-0000-000000000001', 'exemplo', 'instagram', 'ig-exemplo', '@exemplo'),
  ('20000000-0000-0000-0000-000000000002', 'acme',    'instagram', 'ig-acme',    '@acme');
insert into social_account_secrets (social_account_id, access_token_ciphertext, key_version) values
  ('20000000-0000-0000-0000-000000000001', 'cifrado-1', 'v1'),
  ('20000000-0000-0000-0000-000000000002', 'cifrado-2', 'v1');
insert into audit_events (tenant_id, action) values ('exemplo', 'team.member_added'), ('acme', 'team.member_added');

-- ── A: admin vê e edita o perfil da própria conta, nada da outra ──────────────
set role authenticated;
select set_config('app.user_id', '00000000-0000-0000-0000-00000000000a', false);
do $$
declare n int;
begin
  select count(*) into n from plans;
  if n < 2 then raise exception 'A deveria ver os planos, viu %', n; end if;
  select count(*) into n from company_profiles;
  if n <> 1 then raise exception 'A deveria ver 1 perfil, viu %', n; end if;
  select count(*) into n from brand_assets;
  if n <> 1 then raise exception 'A deveria ver 1 logo, viu %', n; end if;
  select count(*) into n from invitations;
  if n <> 1 then raise exception 'A deveria ver 1 convite, viu %', n; end if;
  select count(*) into n from social_accounts;
  if n <> 1 then raise exception 'A deveria ver 1 conta de rede, viu %', n; end if;
  select count(*) into n from audit_events;
  if n <> 1 then raise exception 'A deveria ver 1 evento de auditoria, viu %', n; end if;

  update company_profiles set region = 'Marília, SP' where tenant_id = 'exemplo';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'A não conseguiu editar o perfil'; end if;
  update company_profiles set region = 'invade' where tenant_id = 'acme';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'A alterou % perfil(is) da acme', n; end if;

  insert into brand_assets (tenant_id, kind, storage_path, content_type, byte_size)
    values ('exemplo', 'logo', 'tenants/exemplo/brand/logo-2.png', 'image/png', 500);
  begin
    insert into brand_assets (tenant_id, kind, storage_path, content_type, byte_size)
      values ('acme', 'logo', 'tenants/acme/brand/invade.png', 'image/png', 500);
    raise exception 'A gravou logo na acme';
  exception when insufficient_privilege then null;
  end;
  begin
    update company_profiles set logo_asset_id = '10000000-0000-0000-0000-000000000002' where tenant_id = 'exemplo';
    raise exception 'o perfil da exemplo apontou para o logo da acme';
  exception when foreign_key_violation then null;
  end;

  begin
    insert into invitations (tenant_id, email, role, token_hash) values ('exemplo', 'direto@exemplo.test', 'viewer', repeat('c', 64));
    raise exception 'A criou convite direto no banco (passa pelo servidor)';
  exception when insufficient_privilege then null;
  end;
  begin
    update invitations set role = 'admin' where tenant_id = 'exemplo';
    raise exception 'A mudou convite direto no banco';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into social_accounts (tenant_id, channel, external_id) values ('exemplo', 'instagram', 'ig-direto');
    raise exception 'A conectou rede direto no banco (passa pelo servidor)';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from social_account_secrets;
    raise exception 'A leu token de rede';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from platform_admins;
    raise exception 'A leu platform_admins';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into audit_events (tenant_id, action) values ('exemplo', 'team.forjado');
    raise exception 'A gravou auditoria direto no banco';
  exception when insufficient_privilege then null;
  end;
  begin
    update audit_events set action = 'team.reescrito';
    raise exception 'A reescreveu auditoria';
  exception when insufficient_privilege then null;
  end;
  begin
    perform app.accept_invitation(repeat('a', 64), '00000000-0000-0000-0000-00000000000a');
    raise exception 'A aceitou convite pela API (só o servidor aceita)';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ── B: criador vê perfil e redes, não edita nem vê equipe e auditoria ─────────
select set_config('app.user_id', '00000000-0000-0000-0000-00000000000b', false);
do $$
declare n int;
begin
  select count(*) into n from company_profiles;
  if n <> 1 then raise exception 'B deveria ver o perfil, viu %', n; end if;
  update company_profiles set region = 'B edita' where tenant_id = 'exemplo';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'B editou o perfil (só brand.manage)'; end if;
  begin
    insert into brand_assets (tenant_id, kind, storage_path, content_type, byte_size)
      values ('exemplo', 'logo', 'tenants/exemplo/brand/b.png', 'image/png', 500);
    raise exception 'B enviou logo (só brand.manage)';
  exception when insufficient_privilege then null;
  end;
  select count(*) into n from social_accounts;
  if n <> 1 then raise exception 'B deveria ver a conta de rede, viu %', n; end if;
  select count(*) into n from invitations;
  if n <> 0 then raise exception 'B viu % convite(s) (só team.manage)', n; end if;
  select count(*) into n from audit_events;
  if n <> 0 then raise exception 'B viu % evento(s) de auditoria (só audit.view)', n; end if;
end $$;

-- ── V: leitor não vê perfil, redes, convites nem auditoria ────────────────────
select set_config('app.user_id', '00000000-0000-0000-0000-00000000000f', false);
do $$
declare n int;
begin
  select count(*) into n from company_profiles;
  if n <> 0 then raise exception 'V viu % perfil(is)', n; end if;
  select count(*) into n from brand_assets;
  if n <> 0 then raise exception 'V viu % logo(s)', n; end if;
  select count(*) into n from social_accounts;
  if n <> 0 then raise exception 'V viu % conta(s) de rede', n; end if;
  select count(*) into n from invitations;
  if n <> 0 then raise exception 'V viu % convite(s)', n; end if;
  select count(*) into n from audit_events;
  if n <> 0 then raise exception 'V viu % evento(s) de auditoria', n; end if;
  select count(*) into n from plans;
  if n < 2 then raise exception 'V deveria ver os planos'; end if;
end $$;

-- ── E: logado sem conta não vê nada ──────────────────────────────────────────
select set_config('app.user_id', '00000000-0000-0000-0000-00000000000e', false);
do $$
declare n int;
begin
  select count(*) into n from (
    select 1 from company_profiles union all select 1 from brand_assets union all select 1 from social_accounts
    union all select 1 from invitations union all select 1 from audit_events
  ) t;
  if n <> 0 then raise exception 'E viu % linha(s) de contas', n; end if;
end $$;

-- ── Planos e limites (gatilhos, como dono) ───────────────────────────────────
reset role;
select set_config('app.user_id', '', false);
insert into users (id, email)
  select ('00000000-0000-0000-0000-0000000001' || lpad(g::text, 2, '0'))::uuid, 'lim' || g || '@exemplo.test'
  from generate_series(1, 8) g;
do $$
declare
  u1 uuid := '00000000-0000-0000-0000-000000000101';
  u2 uuid := '00000000-0000-0000-0000-000000000102';
  u3 uuid := '00000000-0000-0000-0000-000000000103';
  u4 uuid := '00000000-0000-0000-0000-000000000104';
  u5 uuid := '00000000-0000-0000-0000-000000000105';
  u6 uuid := '00000000-0000-0000-0000-000000000106';
  u7 uuid := '00000000-0000-0000-0000-000000000107';
  u8 uuid := '00000000-0000-0000-0000-000000000108';
  n int;
  tid text;
begin
  -- o plano é do mesmo tipo da conta
  begin
    insert into tenants (id, name, kind) values ('solo', 'Solo', 'pessoa');
    raise exception 'conta pessoa ficou com o plano de empresa';
  exception when check_violation then null;
  end;
  insert into tenants (id, name, kind, plan_id) values ('solo', 'Solo', 'pessoa', 'pessoa');
  begin
    update tenants set plan_id = 'inicial' where id = 'solo';
    raise exception 'conta pessoa trocou para o plano de empresa sem mudar o tipo';
  exception when check_violation then null;
  end;

  -- conta pessoa: uma pessoa só
  insert into tenant_members (tenant_id, user_id, role) values ('solo', u1, 'admin');
  begin
    insert into tenant_members (tenant_id, user_id, role) values ('solo', u2, 'creator');
    raise exception 'conta pessoa ganhou a segunda pessoa';
  exception when check_violation then null;
  end;

  -- conta empresa: 5 pessoas no plano inicial
  insert into tenants (id, name) values ('lim', 'Lim');
  insert into tenant_members (tenant_id, user_id, role)
    values ('lim', u1, 'admin'), ('lim', u2, 'creator'), ('lim', u3, 'creator'), ('lim', u4, 'viewer'), ('lim', u5, 'viewer');
  begin
    insert into tenant_members (tenant_id, user_id, role) values ('lim', u6, 'viewer');
    raise exception 'a conta lim passou de 5 pessoas';
  exception when check_violation then null;
  end;

  -- convite pendente ocupa vaga
  insert into tenants (id, name) values ('conv', 'Conv');
  insert into tenant_members (tenant_id, user_id, role)
    values ('conv', u1, 'admin'), ('conv', u2, 'creator'), ('conv', u3, 'creator'), ('conv', u4, 'viewer');
  insert into invitations (tenant_id, email, role, token_hash) values ('conv', 'lim8@exemplo.test', 'creator', repeat('1', 64));
  begin
    insert into invitations (tenant_id, email, role, token_hash) values ('conv', 'lim7@exemplo.test', 'viewer', repeat('2', 64));
    raise exception 'convite pendente não ocupou vaga';
  exception when check_violation then null;
  end;
  begin
    insert into invitations (tenant_id, email, role, token_hash) values ('conv', 'lim8@exemplo.test', 'viewer', repeat('3', 64));
    raise exception 'dois convites pendentes para a mesma pessoa';
  exception when unique_violation or check_violation then null;
  end;

  -- aceitar: certo, reusado
  tid := app.accept_invitation(repeat('1', 64), u8);
  if tid <> 'conv' then raise exception 'aceitou na conta errada: %', tid; end if;
  select count(*) into n from tenant_members where tenant_id = 'conv' and user_id = u8 and role = 'creator';
  if n <> 1 then raise exception 'a pessoa não entrou com o papel do convite'; end if;
  if (select accepted_by from invitations where token_hash = repeat('1', 64)) <> u8 then raise exception 'convite sem accepted_by'; end if;
  begin
    perform app.accept_invitation(repeat('1', 64), u8);
    raise exception 'convite aceito duas vezes';
  exception when others then
    if sqlerrm <> 'invitation_used' then raise exception 'esperava invitation_used, veio %', sqlerrm; end if;
  end;

  -- vencido, cancelado, de outro e-mail, inexistente, já membro
  insert into tenants (id, name) values ('conv2', 'Conv2');
  insert into tenant_members (tenant_id, user_id, role) values ('conv2', u1, 'admin');
  insert into invitations (tenant_id, email, role, token_hash, expires_at)
    values ('conv2', 'lim7@exemplo.test', 'viewer', repeat('4', 64), now() - interval '1 minute');
  insert into invitations (tenant_id, email, role, token_hash, cancelled_at)
    values ('conv2', 'lim6@exemplo.test', 'viewer', repeat('5', 64), now());
  insert into invitations (tenant_id, email, role, token_hash) values ('conv2', 'lim5@exemplo.test', 'viewer', repeat('6', 64));
  insert into invitations (tenant_id, email, role, token_hash) values ('conv2', 'lim1@exemplo.test', 'viewer', repeat('7', 64));
  begin
    perform app.accept_invitation(repeat('4', 64), u7);
    raise exception 'convite vencido aceito';
  exception when others then
    if sqlerrm <> 'invitation_expired' then raise exception 'esperava invitation_expired, veio %', sqlerrm; end if;
  end;
  begin
    perform app.accept_invitation(repeat('5', 64), u6);
    raise exception 'convite cancelado aceito';
  exception when others then
    if sqlerrm <> 'invitation_cancelled' then raise exception 'esperava invitation_cancelled, veio %', sqlerrm; end if;
  end;
  begin
    perform app.accept_invitation(repeat('6', 64), u6);
    raise exception 'convite de outro e-mail aceito';
  exception when others then
    if sqlerrm <> 'invitation_email_mismatch' then raise exception 'esperava invitation_email_mismatch, veio %', sqlerrm; end if;
  end;
  begin
    perform app.accept_invitation(repeat('f', 64), u1);
    raise exception 'convite inexistente aceito';
  exception when others then
    if sqlerrm <> 'invitation_not_found' then raise exception 'esperava invitation_not_found, veio %', sqlerrm; end if;
  end;
  begin
    perform app.accept_invitation(repeat('7', 64), u1);
    raise exception 'quem já é membro aceitou de novo';
  exception when others then
    if sqlerrm <> 'already_member' then raise exception 'esperava already_member, veio %', sqlerrm; end if;
  end;
  select count(*) into n from tenant_members where tenant_id = 'conv2';
  if n <> 1 then raise exception 'convite recusado mexeu na equipe (% membros)', n; end if;

  -- reenviar um convite vencido ocupa vaga de novo
  insert into tenants (id, name) values ('resend', 'Resend');
  insert into tenant_members (tenant_id, user_id, role)
    values ('resend', u1, 'admin'), ('resend', u2, 'creator'), ('resend', u3, 'creator'), ('resend', u4, 'viewer');
  insert into invitations (tenant_id, email, role, token_hash) values ('resend', 'lim5@exemplo.test', 'viewer', repeat('8', 64));
  update invitations set expires_at = now() - interval '1 minute' where token_hash = repeat('8', 64);
  insert into invitations (tenant_id, email, role, token_hash) values ('resend', 'lim6@exemplo.test', 'viewer', repeat('9', 64));
  begin
    update invitations set expires_at = now() + interval '7 days' where token_hash = repeat('8', 64);
    raise exception 'reenviar o convite vencido passou do limite de pessoas';
  exception when check_violation then null;
  end;
  update invitations set cancelled_at = now() where token_hash = repeat('9', 64);
  update invitations set expires_at = now() + interval '7 days' where token_hash = repeat('8', 64);

  -- contas de Instagram: o plano inicial permite 1
  insert into social_accounts (tenant_id, channel, external_id) values ('lim', 'instagram', 'ig-lim-1');
  begin
    insert into social_accounts (tenant_id, channel, external_id) values ('lim', 'instagram', 'ig-lim-2');
    raise exception 'a conta lim passou de 1 Instagram';
  exception when check_violation then null;
  end;
  insert into social_accounts (tenant_id, channel, external_id) values ('lim', 'linkedin', 'li-lim-1');

  -- a mesma conta de rede não fica ativa em duas contas; revogar libera e apaga o token
  begin
    insert into social_accounts (tenant_id, channel, external_id) values ('solo', 'instagram', 'ig-exemplo');
    raise exception 'o mesmo Instagram conectou em duas contas';
  exception when unique_violation then null;
  end;
  update social_accounts set status = 'revoked' where id = '20000000-0000-0000-0000-000000000001';
  select count(*) into n from social_account_secrets where social_account_id = '20000000-0000-0000-0000-000000000001';
  if n <> 0 then raise exception 'conta revogada ficou com token'; end if;
  insert into social_accounts (tenant_id, channel, external_id) values ('solo', 'instagram', 'ig-exemplo');

  -- auditoria só de inserção, até para o dono
  begin
    update audit_events set action = 'team.reescrito';
    raise exception 'auditoria foi reescrita';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from audit_events;
    raise exception 'auditoria foi apagada';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into audit_events (tenant_id, action) values ('exemplo', 'Ação Inválida');
    raise exception 'auditoria aceitou nome de ação fora do padrão';
  exception when check_violation then null;
  end;
  insert into audit_events (tenant_id, actor_kind, action, target_type, target_id, metadata)
    values ('exemplo', 'system', 'team.invitation_sent', 'invitation', 'x', '{"role":"viewer"}');

  -- nome da pessoa: opcional, mas não vazio nem enorme
  update users set name = 'Ana Ribeiro' where id = u1;
  begin
    update users set name = '   ' where id = u1;
    raise exception 'nome em branco aceito';
  exception when check_violation then null;
  end;
  begin
    update users set name = repeat('a', 81) where id = u1;
    raise exception 'nome com 81 caracteres aceito';
  exception when check_violation then null;
  end;

  -- administrador da plataforma: uma linha só
  insert into platform_admins (user_id, email) values (u1, 'dono@exemplo.test');
  begin
    insert into platform_admins (user_id, email) values (u2, 'outro@exemplo.test');
    raise exception 'segundo administrador da plataforma';
  exception when unique_violation then null;
  end;
  begin
    insert into platform_admins (singleton, user_id, email) values (false, u3, 'fora@exemplo.test');
    raise exception 'singleton falso aceito';
  exception when check_violation then null;
  end;
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
