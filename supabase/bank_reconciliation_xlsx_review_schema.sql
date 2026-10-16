-- Amplia a conciliação bancária existente com importação XLSX e decisão de revisão reversível.
-- Aditivo e idempotente; não apaga nem altera lançamentos financeiros existentes.
-- Executar depois de bank_reconciliation_schema.sql.

alter table public.bank_statement_imports
  drop constraint if exists bank_statement_imports_source_format_check;

alter table public.bank_statement_imports
  add constraint bank_statement_imports_source_format_check
  check (source_format in ('ofx', 'csv', 'xlsx'));

alter table public.bank_statement_lines
  add column if not exists review_status text not null default 'pending',
  add column if not exists review_reason text,
  add column if not exists reviewed_by uuid references auth.users(id) on delete restrict,
  add column if not exists reviewed_at timestamptz,
  add column if not exists review_claim_token uuid,
  add column if not exists movement_fingerprint text;

update public.bank_statement_lines
set movement_fingerprint = posted_date::text || '|'
  || case when amount > 0 then 'receivable' else 'payable' end || '|'
  || to_char(abs(amount), 'FM999999999999990.00') || '|'
  || normalized_description
where movement_fingerprint is null;

alter table public.bank_statement_lines
  alter column movement_fingerprint set not null;

create index if not exists idx_bank_lines_owner_account_fingerprint
  on public.bank_statement_lines(user_id, financial_account_id, movement_fingerprint)
  where archived_at is null;

alter table public.bank_statement_lines
  drop constraint if exists bank_statement_lines_review_status_check;

alter table public.bank_statement_lines
  add constraint bank_statement_lines_review_status_check
  check (review_status in ('pending', 'processing', 'ignored'));

create or replace function public.start_bank_statement_import(
  p_account_id uuid,
  p_file_name text,
  p_file_hash text,
  p_format text,
  p_expected_count integer
)
returns public.bank_statement_imports
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_now uuid := public.data_owner_id();
  created public.bank_statement_imports;
begin
  if auth.uid() is null or owner_now is null or not public.bank_reconciliation_can_manage() then
    raise exception 'Acesso negado à conciliação bancária.' using errcode = '42501';
  end if;
  if p_format not in ('ofx', 'csv', 'xlsx') then
    raise exception 'Formato de extrato inválido.' using errcode = '22023';
  end if;
  if p_expected_count is null or p_expected_count < 1 or p_expected_count > 50000 then
    raise exception 'Quantidade de linhas inválida.' using errcode = '22023';
  end if;
  if p_file_hash is null or p_file_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Hash do arquivo inválido.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.financial_accounts a
    where a.id = p_account_id and a.user_id = owner_now and a.active and a.archived_at is null
  ) then
    raise exception 'Conta financeira inválida ou inativa.' using errcode = '22023';
  end if;

  insert into public.bank_statement_imports (
    user_id, financial_account_id, file_name, file_hash, source_format,
    expected_line_count, imported_by
  ) values (
    owner_now, p_account_id, left(trim(coalesce(p_file_name, 'extrato')), 255), lower(p_file_hash), p_format,
    p_expected_count, auth.uid()
  ) returning * into created;
  return created;
exception
  when unique_violation then
    raise exception 'Este arquivo já foi importado para a conta selecionada.' using errcode = '23505';
end
$$;

create or replace function public.confirm_bank_reconciliation(
  p_line_id uuid,
  p_installment_id uuid,
  p_method text,
  p_score numeric default null,
  p_reasons jsonb default '[]'::jsonb,
  p_justification text default null,
  p_window_days integer default 3
)
returns public.bank_reconciliations
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_now uuid := public.data_owner_id();
  actor_now uuid := auth.uid();
  bank_line public.bank_statement_lines;
  installment public.financial_installments;
  entry public.financial_entries;
  amount_difference numeric(14,2);
  day_difference integer;
  created public.bank_reconciliations;
begin
  if actor_now is null or owner_now is null or not public.bank_reconciliation_can_manage() then
    raise exception 'Acesso negado à conciliação bancária.' using errcode = '42501';
  end if;
  if p_method not in ('suggested', 'manual', 'created_from_line') then
    raise exception 'Método de conciliação inválido.' using errcode = '22023';
  end if;
  if p_window_days is null or p_window_days < 0 or p_window_days > 7 then
    raise exception 'Janela de datas inválida.' using errcode = '22023';
  end if;

  perform i.id
  from public.bank_statement_imports i
  join public.bank_statement_lines l on l.import_id = i.id
  where l.id = p_line_id and l.user_id = owner_now
    and i.user_id = owner_now and i.status = 'ready' and i.archived_at is null
  for update of i;

  select l.* into bank_line
  from public.bank_statement_lines l
  join public.bank_statement_imports i on i.id = l.import_id
  where l.id = p_line_id and l.user_id = owner_now and l.archived_at is null
    and i.user_id = owner_now and i.status = 'ready' and i.archived_at is null
  for update of l;
  if not found then raise exception 'Linha de extrato inválida ou ainda não finalizada.' using errcode = 'P0002'; end if;

  select * into installment
  from public.financial_installments
  where id = p_installment_id and user_id = owner_now and archived_at is null
    and status not in ('canceled', 'refunded')
  for update;
  if not found then raise exception 'Parcela inválida, cancelada ou arquivada.' using errcode = 'P0002'; end if;

  select * into entry
  from public.financial_entries
  where id = installment.financial_entry_id and user_id = owner_now and archived_at is null
    and status not in ('canceled', 'refunded');
  if not found then raise exception 'Título financeiro inválido, cancelado ou arquivado.' using errcode = 'P0002'; end if;

  if bank_line.review_status = 'ignored' then
    raise exception 'Reabra a linha ignorada antes de conciliá-la.' using errcode = '23514';
  end if;

  if bank_line.review_status = 'processing'
     and not (p_method = 'created_from_line' and entry.source_id = bank_line.id) then
    raise exception 'Esta linha está reservada para a criação de outro lançamento.' using errcode = '23514';
  end if;
  if (bank_line.amount > 0 and entry.direction <> 'receivable')
     or (bank_line.amount < 0 and entry.direction <> 'payable') then
    raise exception 'Direção incompatível entre extrato e parcela.' using errcode = '23514';
  end if;
  if installment.financial_account_id is not null
     and installment.financial_account_id <> bank_line.financial_account_id then
    raise exception 'A parcela pertence explicitamente a outra conta financeira.' using errcode = '23514';
  end if;

  amount_difference := round(abs(abs(bank_line.amount) - abs(installment.amount)), 2);
  day_difference := case
    when coalesce(installment.settlement_date, installment.due_date) is null then null
    else abs(bank_line.posted_date - coalesce(installment.settlement_date, installment.due_date))
  end;
  if (amount_difference > 0.01 or day_difference is null or day_difference > p_window_days
      or installment.financial_account_id is null)
     and length(trim(coalesce(p_justification, ''))) < 3 then
    raise exception 'Conciliação divergente exige justificativa.' using errcode = '23514';
  end if;

  insert into public.bank_reconciliations (
    user_id, statement_line_id, financial_installment_id, match_method,
    score, match_reasons, difference_amount, difference_days, justification,
    confirmed_by
  ) values (
    owner_now, bank_line.id, installment.id, p_method,
    p_score, coalesce(p_reasons, '[]'::jsonb), amount_difference, day_difference,
    nullif(trim(coalesce(p_justification, '')), ''), actor_now
  ) returning * into created;
  update public.bank_statement_lines
  set review_status = 'pending', review_claim_token = null
  where id = bank_line.id and user_id = owner_now;
  return created;
exception
  when unique_violation then
    raise exception 'A linha ou a parcela já possui uma conciliação ativa.' using errcode = '23505';
end
$$;

create or replace function public.set_bank_statement_lines_review(
  p_line_ids uuid[],
  p_status text,
  p_reason text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_now uuid := public.data_owner_id();
  changed_count integer := 0;
  expected_count integer := 0;
begin
  if auth.uid() is null or owner_now is null or not public.bank_reconciliation_can_manage() then
    raise exception 'Acesso negado à conciliação bancária.' using errcode = '42501';
  end if;
  if p_status not in ('pending', 'ignored') then
    raise exception 'Decisão de revisão inválida.' using errcode = '22023';
  end if;
  if coalesce(array_length(p_line_ids, 1), 0) = 0 then
    raise exception 'Nenhuma linha selecionada.' using errcode = '22023';
  end if;

  select count(distinct value)::integer into expected_count
  from unnest(p_line_ids) as selected(value);

  update public.bank_statement_lines
  set review_status = p_status,
      review_reason = case when p_status = 'ignored' then nullif(trim(coalesce(p_reason, '')), '') else null end,
      reviewed_by = auth.uid(),
      reviewed_at = timezone('utc', now()),
      review_claim_token = null
  where user_id = owner_now and id = any(p_line_ids) and archived_at is null
    and ((p_status = 'ignored' and review_status = 'pending')
      or (p_status = 'pending' and review_status = 'ignored'))
    and not exists (
      select 1 from public.bank_reconciliations r
      where r.statement_line_id = bank_statement_lines.id and r.user_id = owner_now and r.reversed_at is null
    );
  get diagnostics changed_count = row_count;
  if changed_count <> expected_count then
    raise exception 'Uma ou mais linhas foram alteradas por outra sessão. Atualize a conciliação.' using errcode = '40001';
  end if;
  return changed_count;
end
$$;

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

create or replace function public.archive_bank_statement_import(p_import_id uuid)
returns public.bank_statement_imports
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_now uuid := public.data_owner_id();
  target public.bank_statement_imports;
  archived_time timestamptz := timezone('utc', now());
begin
  if auth.uid() is null or owner_now is null or not public.bank_reconciliation_can_manage() then
    raise exception 'Acesso negado à conciliação bancária.' using errcode = '42501';
  end if;
  select * into target
  from public.bank_statement_imports
  where id = p_import_id and user_id = owner_now and archived_at is null
  for update;
  if not found then raise exception 'Importação não encontrada.' using errcode = 'P0002'; end if;
  if exists (
    select 1 from public.bank_statement_lines l
    where l.import_id = target.id and l.user_id = owner_now and l.archived_at is null
      and l.review_status = 'processing'
  ) then
    raise exception 'Conclua ou cancele as criações em andamento antes de arquivar esta importação.' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.bank_reconciliations r
    join public.bank_statement_lines l on l.id = r.statement_line_id
    where l.import_id = target.id and r.user_id = owner_now and r.reversed_at is null
  ) then
    raise exception 'Desconcilie as linhas antes de arquivar esta importação.' using errcode = '23514';
  end if;
  update public.bank_statement_imports
  set status = 'archived', archived_at = archived_time
  where id = target.id
  returning * into target;
  update public.bank_statement_lines
  set archived_at = archived_time
  where import_id = target.id and user_id = owner_now and archived_at is null;
  return target;
end
$$;

revoke all on function public.set_bank_statement_lines_review(uuid[], text, text) from public, anon;
revoke all on function public.claim_bank_statement_lines_for_creation(uuid[], uuid, boolean) from public, anon;
revoke all on function public.release_bank_statement_line_claims(uuid[], uuid) from public, anon;
revoke all on function public.recover_bank_statement_line_claim(uuid) from public, anon;
revoke all on function public.archive_bank_statement_import(uuid) from public, anon;
grant execute on function public.set_bank_statement_lines_review(uuid[], text, text) to authenticated;
grant execute on function public.claim_bank_statement_lines_for_creation(uuid[], uuid, boolean) to authenticated;
grant execute on function public.release_bank_statement_line_claims(uuid[], uuid) to authenticated;
grant execute on function public.recover_bank_statement_line_claim(uuid) to authenticated;
grant execute on function public.archive_bank_statement_import(uuid) to authenticated;

notify pgrst, 'reload schema';
