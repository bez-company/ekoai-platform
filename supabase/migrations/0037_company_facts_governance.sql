-- 0037_company_facts_governance.sql: fonte, validade e aprovação dos fatos da empresa
-- (SPEC 018, BEZ-263; ADR 0019).
--
-- Um fato só vale se uma pessoa o confirmou e ele está dentro da validade. Fato escrito por agente ou
-- importação (BEZ-192 e 197) entra `pending`. Vencido não é gravado: sai de `valid_until` e da data de hoje,
-- para não depender de job nem do relógio do banco. "Nunca afirmar" (kind = never) vale sempre que
-- estiver ativo; só `rejected` o desliga.
--
-- Os fatos que já existem foram digitados por um administrador: viram `confirmed`, com verified_at igual a
-- created_at. Depois do preenchimento o default passa a `pending`: fato novo sem decisão explícita não vale.
--
-- Aditivo e reaplicável (o CI roda duas vezes). Nada é apagado.

alter table company_facts add column if not exists status text not null default 'confirmed'
  check (status in ('pending', 'confirmed', 'rejected'));
alter table company_facts add column if not exists verified_at timestamptz;
alter table company_facts add column if not exists approved_by uuid references users(id) on delete set null;
alter table company_facts add column if not exists valid_until date;
alter table company_facts add column if not exists category text not null default 'outro'
  check (category in ('oferta_preco', 'prazo_horario', 'contato_endereco', 'numero_resultado', 'certificacao_regra', 'sobre_a_empresa', 'outro'));
alter table company_facts add column if not exists proposed_by text not null default 'person'
  check (proposed_by in ('person', 'agent'));
alter table company_facts add column if not exists expiry_notice text
  check (expiry_notice is null or expiry_notice in ('soon', 'expired'));

-- Os fatos antigos já estavam em vigor: a confirmação vale desde que foram criados.
update company_facts set verified_at = created_at where status = 'confirmed' and verified_at is null;

alter table company_facts alter column status set default 'pending';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'company_facts_confirmed_verified' and conrelid = 'public.company_facts'::regclass) then
    alter table company_facts add constraint company_facts_confirmed_verified check (status <> 'confirmed' or verified_at is not null);
  end if;
end $$;

-- O job diário varre só o que ainda pode gerar aviso de vencimento.
create index if not exists company_facts_expiry_idx on company_facts (valid_until)
  where kind = 'fact' and status = 'confirmed' and active and valid_until is not null;
