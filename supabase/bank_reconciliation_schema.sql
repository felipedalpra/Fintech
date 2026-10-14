-- bank_reconciliation_schema.sql
-- Fase 3 · item 1 — conciliação bancária assistida.
-- ADITIVO e idempotente. Não altera valores/status/datas do razão nem cria função Vercel.
-- Parse OFX/CSV ocorre no navegador; este schema persiste somente dados normalizados e vínculos.
-- Executar DEPOIS de access_control_schema.sql, financial_ledger_schema.sql e financial_accounts_schema.sql.

create or replace function public.bank_reconciliation_can_manage()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    auth.uid() = public.data_owner_id()
    or exists (
      select 1
      from public.clinic_members cm
      join public.clinics c on c.id = cm.clinic_id
      where cm.user_id = auth.uid()
        and c.owner_id = public.data_owner_id()
        and cm.role in ('admin', 'gestao')
    ),
    false
  )
$$;

revoke all on function public.bank_reconciliation_can_manage() from public, anon;
grant execute on function public.bank_reconciliation_can_manage() to authenticated;

create table if not exists public.bank_statement_imports (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  financial_account_id uuid not null references public.financial_accounts(id) on delete restrict,
  file_name           text not null,
  file_hash           text not null check (file_hash ~ '^[0-9a-f]{64}$'),
  source_format       text not null check (source_format in ('ofx', 'csv')),
  expected_line_count integer not null check (expected_line_count between 1 and 50000),
  line_count          integer not null default 0 check (line_count >= 0),
  status              text not null default 'importing' check (status in ('importing', 'ready', 'archived')),
  period_start        date,
  period_end          date,
  imported_by         uuid not null references auth.users(id) on delete restrict,
  created_at          timestamptz not null default timezone('utc', now()),
  ready_at            timestamptz,
  archived_at         timestamptz
);

create table if not exists public.bank_statement_lines (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references auth.users(id) on delete cascade,
  import_id              uuid not null references public.bank_statement_imports(id) on delete restrict,
  financial_account_id   uuid not null references public.financial_accounts(id) on delete restrict,
  source_line_key        text not null,
  external_id            text,
  posted_date            date not null,
  amount                 numeric(14,2) not null check (amount <> 0),
  currency               text not null default 'BRL' check (currency = 'BRL'),
  description            text not null default '',
  normalized_description text not null default '',
  source_metadata        jsonb not null default '{}'::jsonb,
  line_index             integer not null check (line_index > 0),
  created_at             timestamptz not null default timezone('utc', now()),
  archived_at            timestamptz,
  unique (import_id, source_line_key)
);

create table if not exists public.bank_reconciliations (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references auth.users(id) on delete cascade,
  statement_line_id        uuid not null references public.bank_statement_lines(id) on delete restrict,
  financial_installment_id uuid not null references public.financial_installments(id) on delete restrict,
  match_method             text not null check (match_method in ('suggested', 'manual', 'created_from_line')),
  score                    numeric(5,2) check (score is null or (score between 0 and 100)),
  match_reasons            jsonb not null default '[]'::jsonb,
  difference_amount        numeric(14,2) not null default 0,
  difference_days          integer,
  justification            text,
  confirmed_by             uuid not null references auth.users(id) on delete restrict,
  confirmed_at             timestamptz not null default timezone('utc', now()),
  reversed_by              uuid references auth.users(id) on delete restrict,
  reversed_at              timestamptz,
  reversal_reason          text,
  created_at               timestamptz not null default timezone('utc', now())
);

create unique index if not exists uq_bank_import_active_file
  on public.bank_statement_imports(user_id, financial_account_id, file_hash)
  where archived_at is null and status <> 'archived';
create index if not exists idx_bank_import_owner_created
  on public.bank_statement_imports(user_id, created_at desc)
  where archived_at is null;
create index if not exists idx_bank_lines_import
  on public.bank_statement_lines(import_id, line_index)
  where archived_at is null;
create index if not exists idx_bank_lines_owner_date
  on public.bank_statement_lines(user_id, posted_date)
  where archived_at is null;
create unique index if not exists uq_bank_line_external_active
  on public.bank_statement_lines(user_id, financial_account_id, external_id)
  where external_id is not null and archived_at is null;
create unique index if not exists uq_bank_reconciliation_line_active
  on public.bank_reconciliations(statement_line_id)
  where reversed_at is null;
create unique index if not exists uq_bank_reconciliation_installment_active
  on public.bank_reconciliations(financial_installment_id)
  where reversed_at is null;
create index if not exists idx_bank_reconciliation_owner
  on public.bank_reconciliations(user_id, confirmed_at desc);

alter table public.bank_statement_imports enable row level security;
alter table public.bank_statement_lines enable row level security;
alter table public.bank_reconciliations enable row level security;

drop policy if exists "Bank imports clinic read" on public.bank_statement_imports;
create policy "Bank imports clinic read" on public.bank_statement_imports
  for select to authenticated
  using (user_id = public.data_owner_id() and public.bank_reconciliation_can_manage());

drop policy if exists "Bank lines clinic read" on public.bank_statement_lines;
create policy "Bank lines clinic read" on public.bank_statement_lines
  for select to authenticated
  using (user_id = public.data_owner_id() and public.bank_reconciliation_can_manage());

drop policy if exists "Bank lines importing insert" on public.bank_statement_lines;
create policy "Bank lines importing insert" on public.bank_statement_lines
  for insert to authenticated
  with check (
    user_id = public.data_owner_id()
    and public.bank_reconciliation_can_manage()
    and exists (
      select 1
      from public.bank_statement_imports i
      where i.id = bank_statement_lines.import_id
        and i.user_id = bank_statement_lines.user_id
        and i.financial_account_id = bank_statement_lines.financial_account_id
        and i.status = 'importing'
        and i.archived_at is null
    )
  );

drop policy if exists "Bank reconciliations clinic read" on public.bank_reconciliations;
create policy "Bank reconciliations clinic read" on public.bank_reconciliations
  for select to authenticated
  using (user_id = public.data_owner_id() and public.bank_reconciliation_can_manage());

-- O cliente só lê/importa linhas. Cabeçalhos e vínculos são mutados pelas RPCs abaixo.
revoke all on public.bank_statement_imports from anon;
revoke all on public.bank_statement_lines from anon;
revoke all on public.bank_reconciliations from anon;
grant select on public.bank_statement_imports to authenticated;
grant select, insert on public.bank_statement_lines to authenticated;
grant select on public.bank_reconciliations to authenticated;

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
  if p_format not in ('ofx', 'csv') then
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

create or replace function public.finalize_bank_statement_import(p_import_id uuid)
returns public.bank_statement_imports
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_now uuid := public.data_owner_id();
  target public.bank_statement_imports;
  actual_count integer;
  first_date date;
  last_date date;
begin
  if auth.uid() is null or owner_now is null or not public.bank_reconciliation_can_manage() then
    raise exception 'Acesso negado à conciliação bancária.' using errcode = '42501';
  end if;
  select * into target
  from public.bank_statement_imports
  where id = p_import_id and user_id = owner_now and archived_at is null
  for update;
  if not found then raise exception 'Importação não encontrada.' using errcode = 'P0002'; end if;
  if target.status = 'ready' then return target; end if;
  if target.status <> 'importing' then raise exception 'Importação não pode ser finalizada.' using errcode = '22023'; end if;

  select count(*)::integer, min(posted_date), max(posted_date)
    into actual_count, first_date, last_date
  from public.bank_statement_lines
  where import_id = p_import_id and user_id = owner_now and archived_at is null;
  if actual_count <> target.expected_line_count then
    raise exception 'Importação incompleta: esperadas %, recebidas % linhas.', target.expected_line_count, actual_count using errcode = '22023';
  end if;

  update public.bank_statement_imports
  set line_count = actual_count, period_start = first_date, period_end = last_date,
      status = 'ready', ready_at = timezone('utc', now())
  where id = target.id
  returning * into target;
  return target;
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
  if exists (
    select 1 from public.bank_reconciliations r
    join public.bank_statement_lines l on l.id = r.statement_line_id
    where l.import_id = p_import_id and r.user_id = owner_now and r.reversed_at is null
  ) then
    raise exception 'Desconcilie as linhas antes de arquivar esta importação.' using errcode = '23514';
  end if;
  update public.bank_statement_imports
  set status = 'archived', archived_at = archived_time
  where id = p_import_id and user_id = owner_now and archived_at is null
  returning * into target;
  if not found then raise exception 'Importação não encontrada.' using errcode = 'P0002'; end if;
  update public.bank_statement_lines
  set archived_at = archived_time
  where import_id = p_import_id and user_id = owner_now and archived_at is null;
  return target;
end
$$;

drop function if exists public.confirm_bank_reconciliation(uuid, uuid, text, numeric, jsonb, text);

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
  return created;
exception
  when unique_violation then
    raise exception 'A linha ou a parcela já possui uma conciliação ativa.' using errcode = '23505';
end
$$;

create or replace function public.reverse_bank_reconciliation(p_reconciliation_id uuid, p_reason text)
returns public.bank_reconciliations
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_now uuid := public.data_owner_id();
  changed public.bank_reconciliations;
begin
  if auth.uid() is null or owner_now is null or not public.bank_reconciliation_can_manage() then
    raise exception 'Acesso negado à conciliação bancária.' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Informe o motivo da desconciliação.' using errcode = '22023';
  end if;
  update public.bank_reconciliations
  set reversed_by = auth.uid(), reversed_at = timezone('utc', now()), reversal_reason = trim(p_reason)
  where id = p_reconciliation_id and user_id = owner_now and reversed_at is null
  returning * into changed;
  if not found then raise exception 'Conciliação ativa não encontrada.' using errcode = 'P0002'; end if;
  return changed;
end
$$;

revoke all on function public.start_bank_statement_import(uuid, text, text, text, integer) from public, anon;
revoke all on function public.finalize_bank_statement_import(uuid) from public, anon;
revoke all on function public.archive_bank_statement_import(uuid) from public, anon;
revoke all on function public.confirm_bank_reconciliation(uuid, uuid, text, numeric, jsonb, text, integer) from public, anon;
revoke all on function public.reverse_bank_reconciliation(uuid, text) from public, anon;
grant execute on function public.start_bank_statement_import(uuid, text, text, text, integer) to authenticated;
grant execute on function public.finalize_bank_statement_import(uuid) to authenticated;
grant execute on function public.archive_bank_statement_import(uuid) to authenticated;
grant execute on function public.confirm_bank_reconciliation(uuid, uuid, text, numeric, jsonb, text, integer) to authenticated;
grant execute on function public.reverse_bank_reconciliation(uuid, text) to authenticated;

-- Integra o histórico global quando a função de auditoria já tiver sido aplicada.
do $$
declare
  table_name text;
begin
  if to_regprocedure('public.log_record_change()') is null then return; end if;
  foreach table_name in array array['bank_statement_imports', 'bank_statement_lines', 'bank_reconciliations'] loop
    execute format('drop trigger if exists trg_record_audit on public.%I', table_name);
    execute format(
      'create trigger trg_record_audit after insert or update or delete on public.%I for each row execute function public.log_record_change()',
      table_name
    );
  end loop;
end
$$;
