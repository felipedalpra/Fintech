-- Registra transferências internas como pares de movimentos bancários.
-- Nenhum lado cria receita/despesa; as linhas permanecem apenas na trilha bancária.
begin;

create table if not exists public.bank_internal_transfers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_line_id uuid not null references public.bank_statement_lines(id) on delete restrict,
  destination_line_id uuid not null references public.bank_statement_lines(id) on delete restrict,
  source_financial_account_id uuid not null references public.financial_accounts(id) on delete restrict,
  destination_financial_account_id uuid not null references public.financial_accounts(id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0),
  posted_date date not null,
  justification text not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now()),
  reversed_by uuid references auth.users(id) on delete restrict,
  reversed_at timestamptz,
  reversal_reason text,
  check (source_line_id <> destination_line_id),
  check (source_financial_account_id <> destination_financial_account_id)
);

create unique index if not exists uq_bank_internal_transfer_pair
  on public.bank_internal_transfers(user_id, least(source_line_id, destination_line_id), greatest(source_line_id, destination_line_id));
create index if not exists idx_bank_internal_transfers_owner_date
  on public.bank_internal_transfers(user_id, posted_date desc);

alter table public.bank_internal_transfers enable row level security;
do $$ begin
  create policy "Bank internal transfers clinic access" on public.bank_internal_transfers
    for all to authenticated using (user_id = public.data_owner_id()) with check (user_id = public.data_owner_id());
exception when duplicate_object then null; end $$;

create or replace function public.confirm_bank_internal_transfer(
  p_source_line_id uuid,
  p_destination_line_id uuid,
  p_justification text
)
returns public.bank_internal_transfers
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_now uuid := public.data_owner_id();
  source_line public.bank_statement_lines;
  destination_line public.bank_statement_lines;
  result_row public.bank_internal_transfers;
begin
  if owner_now is null or not public.bank_reconciliation_can_manage() then raise exception 'Sem permissão para registrar transferência interna'; end if;
  if length(trim(coalesce(p_justification, ''))) < 3 then raise exception 'Justificativa obrigatória para transferência interna'; end if;
  select * into source_line from public.bank_statement_lines where id = p_source_line_id and user_id = owner_now and archived_at is null for update;
  select * into destination_line from public.bank_statement_lines where id = p_destination_line_id and user_id = owner_now and archived_at is null for update;
  if source_line.id is null or destination_line.id is null then raise exception 'Linhas bancárias não encontradas'; end if;
  if source_line.id = destination_line.id or source_line.financial_account_id = destination_line.financial_account_id then raise exception 'Contas bancárias incompatíveis para transferência'; end if;
  if source_line.amount >= 0 or destination_line.amount <= 0 or abs(source_line.amount) <> destination_line.amount or source_line.posted_date <> destination_line.posted_date then raise exception 'Linhas não formam transferência interna válida'; end if;
  if source_line.review_status <> 'pending' or destination_line.review_status <> 'pending' then raise exception 'As linhas precisam estar pendentes'; end if;
  insert into public.bank_internal_transfers(user_id, source_line_id, destination_line_id, source_financial_account_id, destination_financial_account_id, amount, posted_date, justification, created_by)
  values (owner_now, source_line.id, destination_line.id, source_line.financial_account_id, destination_line.financial_account_id, abs(source_line.amount), source_line.posted_date, trim(p_justification), auth.uid())
  on conflict (user_id, least(source_line_id, destination_line_id), greatest(source_line_id, destination_line_id)) do update set justification = excluded.justification
  returning * into result_row;
  update public.bank_statement_lines set review_status = 'ignored', review_reason = 'Transferência interna', reviewed_by = auth.uid(), reviewed_at = timezone('utc', now()) where id in (source_line.id, destination_line.id);
  return result_row;
end;
$$;

revoke all on function public.confirm_bank_internal_transfer(uuid, uuid, text) from public, anon;
grant execute on function public.confirm_bank_internal_transfer(uuid, uuid, text) to authenticated;
grant select on public.bank_internal_transfers to authenticated;

commit;
