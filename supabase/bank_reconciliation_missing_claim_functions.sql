-- Conciliacao bancaria: recria as funcoes de reserva de linha que sumiram.
-- Aditiva e idempotente.
--
-- Motivo (bug em producao, 31/10/2026): ao tentar criar um lancamento a partir
-- de uma linha do extrato, a tela mostrava "Migracao necessaria". Tres funcoes
-- nao existiam no banco:
--   claim_bank_statement_lines_for_creation
--   release_bank_statement_line_claims
--   recover_bank_statement_line_claim
--
-- Elas sao definidas em bank_reconciliation_xlsx_review_schema.sql, que faz
-- `drop function` antes de recriar. Aquela migration foi interrompida no meio:
-- as funcoes foram APAGADAS e nunca recriadas. (A mesma interrupcao deixou de
-- fora as colunas tratadas em bank_reconciliation_missing_line_columns.sql.)
--
-- POR QUE NAO RODAR O ARQUIVO ORIGINAL: ele tambem recria o CHECK de
-- `source_format` e a funcao `start_bank_statement_import` de 5 parametros,
-- ambos SEM 'brb' -- desfazendo o suporte ao extrato do BRB. Este arquivo
-- contem SOMENTE as tres funcoes e as suas permissoes.

drop function if exists public.claim_bank_statement_lines_for_creation(uuid[]);
drop function if exists public.claim_bank_statement_lines_for_creation(uuid[], uuid);

create or replace function public.claim_bank_statement_lines_for_creation(
  p_line_ids uuid[],
  p_claim_token uuid,
  p_allow_overlap boolean default false
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_now uuid := public.data_owner_id();
  expected_count integer := 0;
  changed_count integer := 0;
  import_count integer := 0;
  lock_key text;
begin
  if auth.uid() is null or owner_now is null or not public.bank_reconciliation_can_manage() then
    raise exception 'Acesso negado à conciliação bancária.' using errcode = '42501';
  end if;
  if coalesce(array_length(p_line_ids, 1), 0) = 0 then
    raise exception 'Nenhuma linha selecionada.' using errcode = '22023';
  end if;
  if p_claim_token is null then
    raise exception 'Token da reserva inválido.' using errcode = '22023';
  end if;

  select count(distinct value)::integer into expected_count
  from unnest(p_line_ids) as selected(value);

  select count(distinct l.import_id)::integer into import_count
  from public.bank_statement_lines l
  join public.bank_statement_imports i on i.id = l.import_id
  where l.id = any(p_line_ids) and l.user_id = owner_now and l.archived_at is null
    and i.user_id = owner_now and i.status = 'ready' and i.archived_at is null;
  if import_count <> 1 then
    raise exception 'As linhas devem pertencer à mesma importação ativa.' using errcode = '22023';
  end if;

  perform i.id
  from public.bank_statement_imports i
  where i.id = (
    select l.import_id from public.bank_statement_lines l
    where l.id = any(p_line_ids) and l.user_id = owner_now limit 1
  ) and i.user_id = owner_now and i.status = 'ready' and i.archived_at is null
  for update;

  for lock_key in
    select distinct owner_now::text || ':' || l.financial_account_id::text || ':' || l.movement_fingerprint
    from public.bank_statement_lines l
    where l.id = any(p_line_ids) and l.user_id = owner_now and l.archived_at is null
    order by 1
  loop
    perform pg_advisory_xact_lock(hashtextextended(lock_key, 0));
  end loop;

  if not coalesce(p_allow_overlap, false) then
    if exists (
      select 1
      from public.bank_statement_lines l
      where l.id = any(p_line_ids) and l.user_id = owner_now and l.archived_at is null
      group by l.financial_account_id, l.movement_fingerprint
      having count(*) > 1
    ) or exists (
      select 1
      from public.bank_statement_lines selected
      join public.bank_statement_lines other
        on other.user_id = selected.user_id
       and other.financial_account_id = selected.financial_account_id
       and other.movement_fingerprint = selected.movement_fingerprint
       and other.id <> selected.id
       and other.archived_at is null
       and other.review_status <> 'ignored'
      where selected.id = any(p_line_ids)
        and selected.user_id = owner_now
        and selected.archived_at is null
    ) then
      raise exception 'Existe outra movimentação com a mesma data, valor e descrição. Revise a duplicidade antes de criar.' using errcode = '23505';
    end if;
  end if;

  update public.bank_statement_lines
  set review_status = 'processing', review_reason = null,
      reviewed_by = auth.uid(), reviewed_at = timezone('utc', now()),
      review_claim_token = p_claim_token
  where user_id = owner_now and id = any(p_line_ids) and archived_at is null
    and review_status = 'pending'
    and not exists (
      select 1 from public.bank_reconciliations r
      where r.statement_line_id = bank_statement_lines.id and r.user_id = owner_now and r.reversed_at is null
    );
  get diagnostics changed_count = row_count;
  if changed_count <> expected_count then
    raise exception 'Uma ou mais linhas já foram reservadas ou conciliadas. Atualize a conciliação.' using errcode = '40001';
  end if;
  return changed_count;
end
$$;

create or replace function public.release_bank_statement_line_claims(p_line_ids uuid[], p_claim_token uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_now uuid := public.data_owner_id();
  expected_count integer := 0;
  changed_count integer := 0;
begin
  if auth.uid() is null or owner_now is null or not public.bank_reconciliation_can_manage() then
    raise exception 'Acesso negado à conciliação bancária.' using errcode = '42501';
  end if;
  if coalesce(array_length(p_line_ids, 1), 0) = 0 or p_claim_token is null then
    raise exception 'Reserva de criação inválida.' using errcode = '22023';
  end if;
  select count(distinct value)::integer into expected_count
  from unnest(p_line_ids) as selected(value);

  perform i.id
  from public.bank_statement_imports i
  where i.id = (
    select l.import_id from public.bank_statement_lines l
    where l.id = any(p_line_ids) and l.user_id = owner_now limit 1
  ) and i.user_id = owner_now and i.archived_at is null
  for update;

  update public.bank_statement_lines l
  set review_status = 'pending', review_reason = null, review_claim_token = null,
      reviewed_by = auth.uid(), reviewed_at = timezone('utc', now())
  where l.user_id = owner_now and l.id = any(p_line_ids) and l.archived_at is null
    and l.review_status = 'processing' and l.review_claim_token = p_claim_token
    and l.reviewed_by = auth.uid()
    and not exists (
      select 1 from public.bank_reconciliations r
      where r.statement_line_id = l.id and r.user_id = owner_now and r.reversed_at is null
    )
    and not exists (
      select 1 from public.financial_entries e
      where e.user_id = owner_now and e.source_id = l.id and e.archived_at is null
    )
    and not exists (
      select 1 from public.extra_revenues er
      where er.user_id = owner_now and er.id = l.id
        and coalesce(to_jsonb(er)->>'archived_at', '') = ''
    )
    and not exists (
      select 1 from public.expenses ex
      where ex.user_id = owner_now and ex.id = l.id
        and coalesce(to_jsonb(ex)->>'archived_at', '') = ''
    );
  get diagnostics changed_count = row_count;
  if changed_count <> expected_count then
    raise exception 'A reserva mudou ou a linha já originou um lançamento. Atualize a conciliação.' using errcode = '40001';
  end if;
  return changed_count;
end
$$;

create or replace function public.recover_bank_statement_line_claim(p_line_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_now uuid := public.data_owner_id();
  changed_count integer := 0;
begin
  if auth.uid() is null or owner_now is null or not public.bank_reconciliation_can_manage() then
    raise exception 'Acesso negado à conciliação bancária.' using errcode = '42501';
  end if;

  perform i.id
  from public.bank_statement_imports i
  join public.bank_statement_lines l on l.import_id = i.id
  where l.id = p_line_id and l.user_id = owner_now
    and i.user_id = owner_now and i.status = 'ready' and i.archived_at is null
  for update of i;

  update public.bank_statement_lines l
  set review_status = 'pending', review_reason = null, review_claim_token = null,
      reviewed_by = auth.uid(), reviewed_at = timezone('utc', now())
  where l.id = p_line_id and l.user_id = owner_now and l.archived_at is null
    and l.review_status = 'processing' and l.reviewed_by = auth.uid()
    and l.reviewed_at <= timezone('utc', now()) - interval '30 minutes'
    and not exists (
      select 1 from public.bank_reconciliations r
      where r.statement_line_id = l.id and r.user_id = owner_now and r.reversed_at is null
    )
    and not exists (
      select 1 from public.financial_entries e
      where e.user_id = owner_now and e.source_id = l.id and e.archived_at is null
    )
    and not exists (
      select 1 from public.extra_revenues er
      where er.user_id = owner_now and er.id = l.id
        and coalesce(to_jsonb(er)->>'archived_at', '') = ''
    )
    and not exists (
      select 1 from public.expenses ex
      where ex.user_id = owner_now and ex.id = l.id
        and coalesce(to_jsonb(ex)->>'archived_at', '') = ''
    );
  get diagnostics changed_count = row_count;
  if changed_count <> 1 then
    raise exception 'A reserva ainda é recente, pertence a outra pessoa ou já originou um lançamento.' using errcode = '40001';
  end if;
  return changed_count;
end
$$;

revoke all on function public.claim_bank_statement_lines_for_creation(uuid[], uuid, boolean) from public, anon;
revoke all on function public.release_bank_statement_line_claims(uuid[], uuid) from public, anon;
revoke all on function public.recover_bank_statement_line_claim(uuid) from public, anon;
grant execute on function public.claim_bank_statement_lines_for_creation(uuid[], uuid, boolean) to authenticated;
grant execute on function public.release_bank_statement_line_claims(uuid[], uuid) to authenticated;
grant execute on function public.recover_bank_statement_line_claim(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Conferencia
-- ---------------------------------------------------------------------------
-- Esperado: as tres funcoes listadas, com estes argumentos.
--
--   select p.proname as funcao, pg_get_function_identity_arguments(p.oid) as argumentos
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.proname in (
--     'claim_bank_statement_lines_for_creation',
--     'release_bank_statement_line_claims',
--     'recover_bank_statement_line_claim')
--   order by p.proname;
