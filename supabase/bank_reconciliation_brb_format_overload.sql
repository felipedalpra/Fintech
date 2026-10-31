-- Conciliacao bancaria: a versao de 6 parametros do RPC tambem precisa aceitar
-- o extrato do BRB. Executar depois de bank_reconciliation_brb_format.sql.
-- Aditiva e idempotente.
--
-- Motivo (bug em producao, 31/10/2026): existem DUAS funcoes
-- `start_bank_statement_import` -- uma de 5 parametros e outra de 6, com
-- `p_statement_metadata`. Sao overloads distintas, nao versoes da mesma coisa.
-- A migration anterior corrigiu so a de 5 parametros, mas o app chama com
-- `p_statement_metadata`, entao o PostgREST resolve para a de 6 -- que
-- continuava recusando 'brb'. Resultado: "Formato de extrato invalido." depois
-- da previa correta na tela, exatamente a falha que a migration anterior dizia
-- ter corrigido.
--
-- A conferencia que fizemos (`count(*) ... where prosrc like '%brb%'`) devolveu
-- 1 e parecia sucesso, mas era 1 de 2: ela nao conseguia revelar a overload
-- divergente. A query no fim deste arquivo conta as DUAS.

begin;

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
  if p_format not in ('ofx', 'csv', 'xlsx', 'brb') then raise exception 'Formato de extrato inválido.' using errcode = '22023'; end if;
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

commit;

-- ---------------------------------------------------------------------------
-- Conferencia: as DUAS overloads precisam aceitar 'brb'
-- ---------------------------------------------------------------------------
-- Esperado: total_overloads = 2 e aceitam_brb = 2. Qualquer outro resultado
-- significa que sobrou uma overload divergente.
--
--   select count(*) as total_overloads,
--          count(*) filter (where prosrc like '%''brb''%') as aceitam_brb
--   from pg_proc
--   where proname = 'start_bank_statement_import';
