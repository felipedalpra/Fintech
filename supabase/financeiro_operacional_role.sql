-- Perfil Financeiro operacional.
-- Permite executar a rotina financeira sem liberar a camada gerencial (DRE, metas,
-- relatórios, indicadores e plano de contas). Aplicar depois de:
-- access_control_schema.sql, finance_role_access_schema.sql e os schemas financeiros.

begin;

alter table public.clinic_members
  drop constraint if exists clinic_members_role_check;

alter table public.clinic_members
  add constraint clinic_members_role_check
  check (role in ('admin', 'gestao', 'financeiro', 'concierge', 'equipe'));

create or replace function public.finance_role_can_operate()
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
      from public.clinic_members member
      join public.clinics clinic on clinic.id = member.clinic_id
      where member.user_id = auth.uid()
        and clinic.owner_id = public.data_owner_id()
        and member.role in ('admin', 'gestao', 'financeiro')
    ),
    false
  )
$$;

revoke all on function public.finance_role_can_operate() from public, anon;
grant execute on function public.finance_role_can_operate() to authenticated;

create or replace function public.bank_reconciliation_can_manage()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.finance_role_can_operate()
$$;

revoke all on function public.bank_reconciliation_can_manage() from public, anon;
grant execute on function public.bank_reconciliation_can_manage() to authenticated;

-- O perfil operacional pode ler e alterar lançamentos das fontes usadas no dia a dia.
-- Não recebe acesso a ativos/passivos, metas, categorias ou entradas auxiliares do
-- indicador financeiro.
create or replace function public.financial_source_allowed_for_current_user(
  source_kind text,
  source_record_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  member_role text;
  owner_now uuid := public.data_owner_id();
begin
  if owner_now is null or auth.uid() is null then
    return false;
  end if;
  if public.finance_role_can_manage() then
    return true;
  end if;

  select member.role into member_role
  from public.clinic_members member
  join public.clinics clinic on clinic.id = member.clinic_id
  where member.user_id = auth.uid()
    and clinic.owner_id = owner_now
  limit 1;

  if member_role = 'financeiro' then
    if source_kind = 'surgery' then
      return exists (select 1 from public.surgeries source where source.id = source_record_id and source.user_id = owner_now);
    end if;
    if source_kind = 'consultation' then
      return exists (select 1 from public.consultations source where source.id = source_record_id and source.user_id = owner_now);
    end if;
    if source_kind = 'product_sale' then
      return exists (select 1 from public.product_sales source where source.id = source_record_id and source.user_id = owner_now);
    end if;
    if source_kind = 'product_purchase' then
      return exists (select 1 from public.product_purchases source where source.id = source_record_id and source.user_id = owner_now);
    end if;
    if source_kind = 'extra_revenue' then
      return exists (select 1 from public.extra_revenues source where source.id = source_record_id and source.user_id = owner_now);
    end if;
    if source_kind = 'expense' then
      return exists (select 1 from public.expenses source where source.id = source_record_id and source.user_id = owner_now);
    end if;
    if source_kind = 'recurrence' then
      return exists (select 1 from public.recorrencias source where source.id = source_record_id and source.user_id = owner_now);
    end if;
    return false;
  end if;

  if source_kind = 'surgery' and member_role = 'concierge' then
    return exists (select 1 from public.surgeries source where source.id = source_record_id and source.user_id = owner_now);
  end if;
  if source_kind = 'consultation' and member_role in ('concierge', 'equipe') then
    return exists (select 1 from public.consultations source where source.id = source_record_id and source.user_id = owner_now);
  end if;
  if source_kind = 'product_sale' and member_role in ('concierge', 'equipe') then
    return exists (select 1 from public.product_sales source where source.id = source_record_id and source.user_id = owner_now);
  end if;
  if source_kind = 'product_purchase' and member_role in ('concierge', 'equipe') then
    return exists (select 1 from public.product_purchases source where source.id = source_record_id and source.user_id = owner_now);
  end if;
  return false;
end;
$$;

revoke all on function public.financial_source_allowed_for_current_user(text, uuid) from public, anon;
grant execute on function public.financial_source_allowed_for_current_user(text, uuid) to authenticated;

do $$
declare
  table_name text;
  display_name text;
begin
  foreach table_name in array array['extra_revenues', 'expenses', 'recorrencias', 'financial_accounts'] loop
    display_name := initcap(replace(table_name, '_', ' '));
    execute format('drop policy if exists %I on public.%I', display_name || ' finance role access', table_name);
    execute format('drop policy if exists %I on public.%I', display_name || ' operational finance access', table_name);
    execute format(
      'create policy %I on public.%I for all to authenticated using (user_id = public.data_owner_id() and public.finance_role_can_operate()) with check (user_id = public.data_owner_id() and public.finance_role_can_operate())',
      display_name || ' operational finance access', table_name
    );
  end loop;
end $$;

-- Cobranças são criadas pelo backend, mas podem ser consultadas pela rotina financeira.
drop policy if exists "Billing customers finance access" on public.billing_provider_customers;
create policy "Billing customers finance access" on public.billing_provider_customers
  for select to authenticated
  using (user_id = public.data_owner_id() and public.finance_role_can_operate());

drop policy if exists "Billing charges finance read" on public.billing_charges;
create policy "Billing charges finance read" on public.billing_charges
  for select to authenticated
  using (user_id = public.data_owner_id() and public.finance_role_can_operate());

commit;
