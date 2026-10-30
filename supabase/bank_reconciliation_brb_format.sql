-- Conciliacao bancaria: aceitar o extrato do BRB como formato de origem.
-- Executar depois de bank_reconciliation_xlsx_review_schema.sql.
-- Aditiva e idempotente.
--
-- Motivo: o leitor do extrato do BRB devolve `source_format = 'brb'`, mas tanto
-- o CHECK da coluna quanto o guard do RPC so aceitavam ofx/csv/xlsx. Sem esta
-- migration, confirmar a importacao de um extrato do BRB falha com
-- "Formato de extrato invalido" e NADA e gravado -- o usuario ve a previa
-- correta na tela e perde tudo no clique seguinte.

begin;

-- ---------------------------------------------------------------------------
-- 1. A coluna passa a aceitar o novo formato
-- ---------------------------------------------------------------------------
alter table public.bank_statement_imports
  drop constraint if exists bank_statement_imports_source_format_check;

alter table public.bank_statement_imports
  add constraint bank_statement_imports_source_format_check
  check (source_format in ('ofx', 'csv', 'xlsx', 'brb'));

-- ---------------------------------------------------------------------------
-- 2. O RPC passa a aceitar o novo formato
-- ---------------------------------------------------------------------------
-- Recriado por inteiro porque o guard e uma linha dentro da funcao. Nada mais
-- mudou: as checagens de acesso, de contagem, de hash e de conta continuam
-- identicas as de bank_reconciliation_xlsx_review_schema.sql.
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
  if p_format not in ('ofx', 'csv', 'xlsx', 'brb') then
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

commit;
