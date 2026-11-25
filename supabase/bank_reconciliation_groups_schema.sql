-- Conciliação agrupada: várias linhas bancárias para uma parcela/título.
begin;

create table if not exists public.bank_reconciliation_groups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  financial_installment_id uuid not null references public.financial_installments(id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0),
  difference_amount numeric(14,2) not null default 0,
  justification text,
  confirmed_by uuid not null references auth.users(id) on delete restrict,
  confirmed_at timestamptz not null default timezone('utc', now()),
  reversed_by uuid references auth.users(id) on delete restrict,
  reversed_at timestamptz,
  reversal_reason text
);

create table if not exists public.bank_reconciliation_group_lines (
  group_id uuid not null references public.bank_reconciliation_groups(id) on delete cascade,
  statement_line_id uuid not null references public.bank_statement_lines(id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0),
  primary key (group_id, statement_line_id)
);

create index if not exists idx_bank_group_line_statement
  on public.bank_reconciliation_group_lines(statement_line_id);
create unique index if not exists uq_bank_group_installment_active
  on public.bank_reconciliation_groups(financial_installment_id)
  where reversed_at is null;
create index if not exists idx_bank_group_owner on public.bank_reconciliation_groups(user_id, confirmed_at desc);

alter table public.bank_reconciliation_groups enable row level security;
alter table public.bank_reconciliation_group_lines enable row level security;
do $$ begin
  create policy "Bank reconciliation groups clinic access" on public.bank_reconciliation_groups
    for all to authenticated using (user_id = public.data_owner_id()) with check (user_id = public.data_owner_id());
  create policy "Bank reconciliation group lines clinic access" on public.bank_reconciliation_group_lines
    for all to authenticated using (exists (select 1 from public.bank_reconciliation_groups g where g.id = group_id and g.user_id = public.data_owner_id()))
    with check (exists (select 1 from public.bank_reconciliation_groups g where g.id = group_id and g.user_id = public.data_owner_id()));
exception when duplicate_object then null; end $$;

create or replace function public.confirm_bank_reconciliation_group(
  p_line_ids uuid[], p_installment_id uuid, p_justification text, p_window_days integer default 3
)
returns public.bank_reconciliation_groups
language plpgsql security definer set search_path = public
as $$
declare
  owner_now uuid := public.data_owner_id(); actor_now uuid := auth.uid();
  installment public.financial_installments; entry public.financial_entries;
  line_row public.bank_statement_lines; created public.bank_reconciliation_groups;
  ids uuid[] := (select array_agg(distinct item) from unnest(p_line_ids) item);
  total numeric(14,2); difference numeric(14,2); first_date date; last_date date; reference_date date;
begin
  if actor_now is null or owner_now is null or not public.bank_reconciliation_can_manage() then raise exception 'Acesso negado à conciliação bancária.' using errcode = '42501'; end if;
  if coalesce(array_length(ids, 1), 0) < 2 or array_length(ids, 1) > 20 then raise exception 'Um agrupamento precisa ter entre 2 e 20 linhas.' using errcode = '22023'; end if;
  if length(trim(coalesce(p_justification, ''))) < 3 then raise exception 'Justificativa obrigatória para conciliação agrupada.' using errcode = '23514'; end if;
  if p_window_days is null or p_window_days < 0 or p_window_days > 7 then raise exception 'Janela de datas inválida.' using errcode = '22023'; end if;
  select * into installment from public.financial_installments where id = p_installment_id and user_id = owner_now and archived_at is null and status not in ('canceled','refunded') for update;
  if not found then raise exception 'Parcela inválida, cancelada ou arquivada.' using errcode = 'P0002'; end if;
  select * into entry from public.financial_entries where id = installment.financial_entry_id and user_id = owner_now and archived_at is null and status not in ('canceled','refunded');
  if not found then raise exception 'Título financeiro inválido.' using errcode = 'P0002'; end if;
  if entry.direction = 'receivable' and exists (select 1 from public.bank_statement_lines l where l.id = any(ids) and l.amount <= 0) then raise exception 'Todas as linhas precisam ser entradas para uma conta a receber'; end if;
  if entry.direction = 'payable' and exists (select 1 from public.bank_statement_lines l where l.id = any(ids) and l.amount >= 0) then raise exception 'Todas as linhas precisam ser saídas para uma conta a pagar'; end if;
  if (select count(*) from public.bank_statement_lines l where l.id = any(ids) and l.user_id = owner_now and l.archived_at is null) <> array_length(ids, 1) then raise exception 'Linha bancária inválida.'; end if;
  if exists (select 1 from public.bank_statement_lines l where l.id = any(ids) and l.review_status <> 'pending') then raise exception 'Todas as linhas precisam estar pendentes.' using errcode = '23514'; end if;
  if exists (select 1 from public.bank_reconciliation_group_lines gl join public.bank_reconciliation_groups g on g.id = gl.group_id where gl.statement_line_id = any(ids) and g.reversed_at is null) then raise exception 'Uma das linhas já possui conciliação agrupada ativa.' using errcode = '23505'; end if;
  if exists (select 1 from public.bank_reconciliations r where r.statement_line_id = any(ids) and r.user_id = owner_now and r.reversed_at is null) then raise exception 'Uma das linhas já possui conciliação ativa.' using errcode = '23505'; end if;
  if (select count(distinct l.financial_account_id) from public.bank_statement_lines l where l.id = any(ids) and l.user_id = owner_now and l.archived_at is null) <> 1 then raise exception 'As linhas precisam pertencer à mesma conta bancária.' using errcode = '23514'; end if;
  if exists (select 1 from public.bank_reconciliations r where r.financial_installment_id = installment.id and r.user_id = owner_now and r.reversed_at is null) then raise exception 'A parcela já possui conciliação ativa.' using errcode = '23505'; end if;
  if exists (select 1 from public.bank_reconciliation_groups g where g.financial_installment_id = installment.id and g.user_id = owner_now and g.reversed_at is null) then raise exception 'A parcela já possui conciliação agrupada ativa.' using errcode = '23505'; end if;
  perform 1 from public.bank_statement_lines l where l.id = any(ids) and l.user_id = owner_now and l.archived_at is null for update;
  select sum(abs(l.amount)), min(l.posted_date), max(l.posted_date) into total, first_date, last_date from public.bank_statement_lines l where l.id = any(ids) and l.user_id = owner_now and l.archived_at is null;
  reference_date := coalesce(installment.settlement_date, installment.due_date);
  if total is null or first_date is null or last_date - first_date > p_window_days or (reference_date is not null and greatest(abs(first_date - reference_date), abs(last_date - reference_date)) > p_window_days) then raise exception 'As linhas não formam um grupo temporal válido.' using errcode = '23514'; end if;
  difference := round(total - abs(installment.amount), 2);
  if abs(difference) > 0.01 and length(trim(coalesce(p_justification, ''))) < 3 then raise exception 'Diferença agrupada exige justificativa.' using errcode = '23514'; end if;
  insert into public.bank_reconciliation_groups(user_id, financial_installment_id, amount, difference_amount, justification, confirmed_by)
  values (owner_now, installment.id, total, difference, trim(p_justification), actor_now) returning * into created;
  insert into public.bank_reconciliation_group_lines(group_id, statement_line_id, amount)
    select created.id, l.id, abs(l.amount) from public.bank_statement_lines l where l.id = any(ids) and l.user_id = owner_now;
  return created;
exception when unique_violation then raise exception 'A parcela ou uma das linhas já possui conciliação agrupada ativa.' using errcode = '23505';
end;
$$;

create or replace function public.reverse_bank_reconciliation_group(p_group_id uuid, p_reason text)
returns public.bank_reconciliation_groups
language plpgsql security definer set search_path = public
as $$
declare owner_now uuid := public.data_owner_id(); result_row public.bank_reconciliation_groups;
begin
  if auth.uid() is null or owner_now is null or not public.bank_reconciliation_can_manage() then raise exception 'Acesso negado à conciliação bancária.' using errcode = '42501'; end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'Informe o motivo da desconciliação.' using errcode = '23514'; end if;
  update public.bank_reconciliation_groups set reversed_by = auth.uid(), reversed_at = timezone('utc', now()), reversal_reason = trim(p_reason) where id = p_group_id and user_id = owner_now and reversed_at is null returning * into result_row;
  if result_row.id is null then raise exception 'Grupo de conciliação não encontrado ou já revertido.' using errcode = 'P0002'; end if;
  return result_row;
end;
$$;

revoke all on function public.confirm_bank_reconciliation_group(uuid[], uuid, text, integer) from public, anon;
revoke all on function public.reverse_bank_reconciliation_group(uuid, text) from public, anon;
grant execute on function public.confirm_bank_reconciliation_group(uuid[], uuid, text, integer) to authenticated;
grant execute on function public.reverse_bank_reconciliation_group(uuid, text) to authenticated;
grant select on public.bank_reconciliation_groups, public.bank_reconciliation_group_lines to authenticated;
commit;
