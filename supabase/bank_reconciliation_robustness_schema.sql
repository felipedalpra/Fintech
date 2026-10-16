-- bank_reconciliation_robustness_schema.sql
-- Fase 3 · robustez e proveniência da conciliação bancária.
-- ADITIVO e idempotente. Executar DEPOIS de:
--   financial_accounts_schema.sql
--   bank_reconciliation_schema.sql
--   bank_reconciliation_xlsx_review_schema.sql

-- 1. Conexão bancária é separada da conta financeira e do emissor de cobranças.
-- Tokens e referências de segredo nunca ficam nesta tabela; só registramos se o servidor os configurou.
create table if not exists public.bank_connections (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  provider           text not null,
  environment        text not null default 'production' check (environment in ('sandbox','production')),
  status             text not null default 'pending' check (status in ('pending','connected','action_required','expired','revoked','error')),
  consent_id         text,
  consent_status     text,
  consent_expires_at timestamptz,
  credentials_configured boolean not null default false,
  sync_cursor        text,
  last_synced_at     timestamptz,
  last_error         text,
  created_by         uuid not null references auth.users(id) on delete restrict,
  created_at         timestamptz not null default timezone('utc', now()),
  updated_at         timestamptz not null default timezone('utc', now()),
  archived_at        timestamptz
);

alter table public.bank_connections enable row level security;
drop policy if exists "Bank connections clinic read" on public.bank_connections;
create policy "Bank connections clinic read" on public.bank_connections
  for select to authenticated
  using (user_id = public.data_owner_id() and public.bank_reconciliation_can_manage());
revoke all on public.bank_connections from public, anon, authenticated;
grant select on public.bank_connections to authenticated;
create index if not exists idx_bank_connections_owner
  on public.bank_connections(user_id, created_at desc) where archived_at is null;
create unique index if not exists uq_bank_connection_consent
  on public.bank_connections(user_id, provider, consent_id)
  where consent_id is not null and archived_at is null;

-- 2. Identidade verificável da conta. Somente final da conta/documento é persistido.
alter table public.financial_accounts
  add column if not exists institution_code text,
  add column if not exists institution_name text,
  add column if not exists branch_code text,
  add column if not exists account_number_masked text,
  add column if not exists account_number_suffix text,
  add column if not exists holder_name text,
  add column if not exists holder_document_suffix text,
  add column if not exists currency text not null default 'BRL',
  add column if not exists source text not null default 'manual',
  add column if not exists external_account_id text,
  add column if not exists connection_id uuid references public.bank_connections(id) on delete set null,
  add column if not exists account_fingerprint text,
  add column if not exists verification_status text not null default 'unverified',
  add column if not exists verified_at timestamptz,
  add column if not exists last_synced_at timestamptz;

do $$ begin
  begin alter table public.financial_accounts add constraint financial_accounts_currency_check check (currency = 'BRL'); exception when duplicate_object then null; end;
  begin alter table public.financial_accounts add constraint financial_accounts_source_check check (source in ('manual','ofx','open_finance','bank_api')); exception when duplicate_object then null; end;
  begin alter table public.financial_accounts add constraint financial_accounts_verification_check check (verification_status in ('unverified','partially_verified','verified','disconnected')); exception when duplicate_object then null; end;
  begin alter table public.financial_accounts add constraint financial_accounts_suffix_check check (account_number_suffix is null or account_number_suffix ~ '^[0-9]{4}$'); exception when duplicate_object then null; end;
  begin alter table public.financial_accounts add constraint financial_accounts_document_suffix_check check (holder_document_suffix is null or holder_document_suffix ~ '^[0-9]{4}$'); exception when duplicate_object then null; end;
end $$;

create unique index if not exists uq_financial_account_fingerprint
  on public.financial_accounts(user_id, account_fingerprint)
  where account_fingerprint is not null and archived_at is null;
create unique index if not exists uq_financial_account_external
  on public.financial_accounts(user_id, connection_id, external_account_id)
  where connection_id is not null and external_account_id is not null and archived_at is null;

create or replace function public.create_financial_bank_account(
  p_name text,
  p_account_type text default 'checking',
  p_institution_code text default null,
  p_institution_name text default null,
  p_branch_code text default null,
  p_account_number_suffix text default null,
  p_holder_name text default null,
  p_holder_document_suffix text default null
)
returns public.financial_accounts
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_now uuid := public.data_owner_id();
  suffix text := nullif(regexp_replace(coalesce(p_account_number_suffix, ''), '[^0-9]', '', 'g'), '');
  document_suffix text := nullif(regexp_replace(coalesce(p_holder_document_suffix, ''), '[^0-9]', '', 'g'), '');
  fingerprint text;
  created public.financial_accounts;
begin
  if auth.uid() is null or owner_now is null or not public.bank_reconciliation_can_manage() then
    raise exception 'Acesso negado ao cadastro de contas.' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_name, ''))) < 2 then
    raise exception 'Informe um nome para a conta.' using errcode = '22023';
  end if;
  if p_account_type not in ('checking','savings','card','other') then
    raise exception 'Tipo de conta bancária inválido.' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_institution_name, ''))) < 2 then
    raise exception 'Informe a instituição financeira.' using errcode = '22023';
  end if;
  if suffix is null or length(suffix) <> 4 then
    raise exception 'Informe os 4 últimos dígitos da conta.' using errcode = '22023';
  end if;
  if document_suffix is not null and length(document_suffix) <> 4 then
    raise exception 'O documento do titular deve conter somente os 4 últimos dígitos.' using errcode = '22023';
  end if;

  fingerprint := md5(lower(trim(coalesce(nullif(p_institution_code, ''), p_institution_name))) || '|'
    || lower(trim(coalesce(p_branch_code, ''))) || '|' || suffix || '|' || p_account_type);

  insert into public.financial_accounts (
    user_id, name, account_type, institution_code, institution_name, branch_code,
    account_number_masked, account_number_suffix, holder_name, holder_document_suffix,
    currency, source, account_fingerprint, verification_status, active
  ) values (
    owner_now, left(trim(p_name), 120), p_account_type,
    nullif(left(trim(coalesce(p_institution_code, '')), 40), ''), left(trim(p_institution_name), 120),
    nullif(left(trim(coalesce(p_branch_code, '')), 30), ''), '••••' || suffix, suffix,
    nullif(left(trim(coalesce(p_holder_name, '')), 160), ''), document_suffix,
    'BRL', 'manual', fingerprint, 'partially_verified', true
  ) returning * into created;
  return created;
exception
  when unique_violation then
    raise exception 'Esta conta bancária já está cadastrada para a clínica.' using errcode = '23505';
end
$$;

revoke all on function public.create_financial_bank_account(text, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.create_financial_bank_account(text, text, text, text, text, text, text, text) to authenticated;

-- 3. Proveniência, identidade, período e controle de saldo do extrato.
alter table public.bank_statement_imports
  add column if not exists connection_id uuid references public.bank_connections(id) on delete set null,
  add column if not exists source_type text not null default 'manual_file',
  add column if not exists declared_period_start date,
  add column if not exists declared_period_end date,
  add column if not exists institution_code text,
  add column if not exists statement_account_masked text,
  add column if not exists statement_account_fingerprint text,
  add column if not exists currency text not null default 'BRL',
  add column if not exists closing_balance numeric(14,2),
  add column if not exists available_balance numeric(14,2),
  add column if not exists balance_date date,
  add column if not exists net_movement numeric(14,2),
  add column if not exists control_difference numeric(14,2),
  add column if not exists verification_status text not null default 'unverified',
  add column if not exists verification_notes jsonb not null default '[]'::jsonb;

do $$ begin
  begin alter table public.bank_statement_imports add constraint bank_import_source_type_check check (source_type in ('manual_file','open_finance','bank_api')); exception when duplicate_object then null; end;
  begin alter table public.bank_statement_imports add constraint bank_import_currency_check check (currency = 'BRL'); exception when duplicate_object then null; end;
  begin alter table public.bank_statement_imports add constraint bank_import_verification_check check (verification_status in ('unverified','partially_verified','verified','mismatch')); exception when duplicate_object then null; end;
end $$;

alter table public.bank_statement_lines
  add column if not exists provider_transaction_id text,
  add column if not exists end_to_end_id text,
  add column if not exists txid text,
  add column if not exists booking_status text not null default 'booked',
  add column if not exists counterparty_name text,
  add column if not exists counterparty_document_suffix text;

do $$ begin
  begin alter table public.bank_statement_lines add constraint bank_line_booking_status_check check (booking_status in ('pending','booked','reversed')); exception when duplicate_object then null; end;
  begin alter table public.bank_statement_lines add constraint bank_line_document_suffix_check check (counterparty_document_suffix is null or counterparty_document_suffix ~ '^[0-9]{4}$'); exception when duplicate_object then null; end;
end $$;

create unique index if not exists uq_bank_line_provider_transaction
  on public.bank_statement_lines(user_id, financial_account_id, provider_transaction_id)
  where provider_transaction_id is not null and archived_at is null;
create index if not exists idx_bank_line_end_to_end
  on public.bank_statement_lines(user_id, end_to_end_id)
  where end_to_end_id is not null and archived_at is null;

create or replace function public.guard_bank_reconciliation_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  import_status text;
  line_status text;
begin
  select i.verification_status, l.booking_status into import_status, line_status
  from public.bank_statement_lines l
  join public.bank_statement_imports i on i.id = l.import_id
  where l.id = new.statement_line_id and l.user_id = new.user_id and i.user_id = new.user_id;
  if import_status = 'mismatch' then
    raise exception 'Extrato com divergência de integridade não pode ser conciliado.' using errcode = '23514';
  end if;
  if line_status <> 'booked' then
    raise exception 'Somente movimentações efetivadas podem ser conciliadas.' using errcode = '23514';
  end if;
  return new;
end
$$;

drop trigger if exists trg_bank_reconciliation_integrity on public.bank_reconciliations;
create trigger trg_bank_reconciliation_integrity
  before insert on public.bank_reconciliations
  for each row execute function public.guard_bank_reconciliation_integrity();

drop function if exists public.start_bank_statement_import(uuid, text, text, text, integer);
create or replace function public.start_bank_statement_import(
  p_account_id uuid,
  p_file_name text,
  p_file_hash text,
  p_format text,
  p_expected_count integer,
  p_statement_metadata jsonb default '{}'::jsonb
)
returns public.bank_statement_imports
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_now uuid := public.data_owner_id();
  account_row public.financial_accounts;
  metadata jsonb := coalesce(p_statement_metadata, '{}'::jsonb);
  statement_institution text := nullif(left(trim(coalesce(metadata->>'institutionCode', '')), 40), '');
  statement_suffix text := nullif(right(regexp_replace(coalesce(metadata->>'accountNumberSuffix', ''), '[^0-9A-Za-z]', '', 'g'), 4), '');
  statement_currency text := upper(coalesce(nullif(trim(metadata->>'currency'), ''), 'BRL'));
  statement_fingerprint text;
  created public.bank_statement_imports;
begin
  if auth.uid() is null or owner_now is null or not public.bank_reconciliation_can_manage() then
    raise exception 'Acesso negado à conciliação bancária.' using errcode = '42501';
  end if;
  if p_format not in ('ofx', 'csv', 'xlsx') then raise exception 'Formato de extrato inválido.' using errcode = '22023'; end if;
  if p_expected_count is null or p_expected_count < 1 or p_expected_count > 50000 then raise exception 'Quantidade de linhas inválida.' using errcode = '22023'; end if;
  if p_file_hash is null or p_file_hash !~ '^[0-9a-f]{64}$' then raise exception 'Hash do arquivo inválido.' using errcode = '22023'; end if;
  if statement_currency <> 'BRL' then raise exception 'A conciliação aceita somente extratos em BRL.' using errcode = '22023'; end if;

  select * into account_row from public.financial_accounts
  where id = p_account_id and user_id = owner_now and active and archived_at is null
  for update;
  if not found then raise exception 'Conta financeira inválida ou inativa.' using errcode = '22023'; end if;
  if account_row.institution_code is not null and statement_institution is not null
     and lower(account_row.institution_code) <> lower(statement_institution) then
    raise exception 'O extrato pertence a outra instituição financeira.' using errcode = '23514';
  end if;
  if account_row.account_number_suffix is not null and statement_suffix is not null
     and lower(account_row.account_number_suffix) <> lower(statement_suffix) then
    raise exception 'O extrato pertence a outra conta bancária.' using errcode = '23514';
  end if;

  statement_fingerprint := case when statement_institution is not null and statement_suffix is not null
    then md5(lower(statement_institution) || '|' || lower(coalesce(metadata->>'agencyCode', '')) || '|'
      || lower(statement_suffix) || '|' || lower(coalesce(metadata->>'accountType', '')))
    else null end;

  insert into public.bank_statement_imports (
    user_id, financial_account_id, file_name, file_hash, source_format, source_type,
    expected_line_count, declared_period_start, declared_period_end, institution_code,
    statement_account_masked, statement_account_fingerprint, currency, closing_balance,
    available_balance, balance_date, verification_status, imported_by
  ) values (
    owner_now, p_account_id, left(trim(coalesce(p_file_name, 'extrato')), 255), lower(p_file_hash), p_format,
    'manual_file', p_expected_count,
    nullif(metadata->>'periodStart', '')::date, nullif(metadata->>'periodEnd', '')::date,
    statement_institution, nullif(left(trim(coalesce(metadata->>'accountNumberMasked', '')), 30), ''),
    statement_fingerprint, statement_currency,
    nullif(metadata->>'closingBalance', '')::numeric, nullif(metadata->>'availableBalance', '')::numeric,
    nullif(metadata->>'balanceDate', '')::date, case when p_format = 'ofx' then 'partially_verified' else 'unverified' end,
    auth.uid()
  ) returning * into created;
  return created;
exception
  when unique_violation then raise exception 'Este arquivo já foi importado para a conta selecionada.' using errcode = '23505';
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
  account_row public.financial_accounts;
  previous_import public.bank_statement_imports;
  actual_count integer;
  first_date date;
  last_date date;
  movement numeric(14,2);
  balance_difference numeric(14,2);
  period_mismatch boolean := false;
  identity_verified boolean := false;
  next_verification text;
  notes jsonb := '[]'::jsonb;
begin
  if auth.uid() is null or owner_now is null or not public.bank_reconciliation_can_manage() then
    raise exception 'Acesso negado à conciliação bancária.' using errcode = '42501';
  end if;
  select * into target from public.bank_statement_imports
  where id = p_import_id and user_id = owner_now and archived_at is null for update;
  if not found then raise exception 'Importação não encontrada.' using errcode = 'P0002'; end if;
  if target.status = 'ready' then return target; end if;
  if target.status <> 'importing' then raise exception 'Importação não pode ser finalizada.' using errcode = '22023'; end if;

  select count(*)::integer, min(posted_date), max(posted_date), round(coalesce(sum(amount), 0), 2)
    into actual_count, first_date, last_date, movement
  from public.bank_statement_lines
  where import_id = p_import_id and user_id = owner_now and archived_at is null;
  if actual_count <> target.expected_line_count then
    raise exception 'Importação incompleta: esperadas %, recebidas % linhas.', target.expected_line_count, actual_count using errcode = '22023';
  end if;

  period_mismatch := (target.declared_period_start is not null and first_date < target.declared_period_start)
    or (target.declared_period_end is not null and last_date > target.declared_period_end);
  if period_mismatch then notes := notes || jsonb_build_array('Movimentações fora do período declarado pelo extrato.'); end if;

  select * into account_row from public.financial_accounts where id = target.financial_account_id and user_id = owner_now;
  identity_verified := account_row.institution_code is not null and target.institution_code is not null
    and lower(account_row.institution_code) = lower(target.institution_code)
    and account_row.account_number_suffix is not null and target.statement_account_masked is not null
    and right(regexp_replace(target.statement_account_masked, '[^0-9A-Za-z]', '', 'g'), 4) = account_row.account_number_suffix;

  if target.closing_balance is not null then
    select * into previous_import from public.bank_statement_imports
    where user_id = owner_now and financial_account_id = target.financial_account_id
      and id <> target.id and status = 'ready' and archived_at is null
      and closing_balance is not null and balance_date is not null
      and balance_date < coalesce(target.declared_period_start, first_date)
      and verification_status <> 'mismatch'
    order by balance_date desc, ready_at desc limit 1;
    if found then
      balance_difference := round(target.closing_balance - (previous_import.closing_balance + movement), 2);
      if abs(balance_difference) > 0.01 then notes := notes || jsonb_build_array('Saldo final não fecha com o extrato anterior e o movimento líquido.'); end if;
    else
      notes := notes || jsonb_build_array('Sem saldo anterior verificado para conferir a equação.');
    end if;
  else
    notes := notes || jsonb_build_array('Extrato sem saldo final declarado.');
  end if;

  next_verification := case
    when period_mismatch or (balance_difference is not null and abs(balance_difference) > 0.01) then 'mismatch'
    when identity_verified and balance_difference is not null and abs(balance_difference) <= 0.01 then 'verified'
    when target.source_format = 'ofx' and (identity_verified or target.closing_balance is not null) then 'partially_verified'
    else 'unverified'
  end;

  update public.bank_statement_imports set
    line_count = actual_count, period_start = first_date, period_end = last_date,
    net_movement = movement, control_difference = balance_difference,
    verification_status = next_verification, verification_notes = notes,
    status = 'ready', ready_at = timezone('utc', now())
  where id = target.id returning * into target;

  if next_verification = 'verified' and account_row.verification_status <> 'verified' then
    update public.financial_accounts set verification_status = 'verified', verified_at = timezone('utc', now()), updated_at = timezone('utc', now())
    where id = account_row.id and user_id = owner_now;
  end if;
  return target;
end
$$;

revoke all on function public.start_bank_statement_import(uuid, text, text, text, integer, jsonb) from public, anon;
revoke all on function public.finalize_bank_statement_import(uuid) from public, anon;
grant execute on function public.start_bank_statement_import(uuid, text, text, text, integer, jsonb) to authenticated;
grant execute on function public.finalize_bank_statement_import(uuid) to authenticated;
revoke all on function public.guard_bank_reconciliation_integrity() from public, anon;

-- Auditoria global, quando disponível.
do $$ begin
  if to_regprocedure('public.log_record_change()') is not null then
    drop trigger if exists trg_record_audit on public.bank_connections;
    create trigger trg_record_audit after insert or update or delete on public.bank_connections
      for each row execute function public.log_record_change();
  end if;
end $$;
