-- finance_role_access_schema.sql
-- Restringe dados financeiros a admin/gestao sem impedir que perfis operacionais
-- registrem consultas, cirurgias e produtos que alimentam o razão canônico.
-- Aditivo/idempotente: não altera, remove ou recalcula nenhum dado.
-- Executar DEPOIS de access_control_schema.sql, erp_relational_schema.sql,
-- financial_ledger_schema.sql, financial_accounts_schema.sql e chart_of_accounts_schema.sql.

begin;

create or replace function public.finance_role_can_manage()
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
        and member.role in ('admin', 'gestao')
    ),
    false
  )
$$;

revoke all on function public.finance_role_can_manage() from public, anon;
grant execute on function public.finance_role_can_manage() to authenticated;

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

-- Fontes exclusivamente financeiras: nenhuma leitura ou escrita para concierge/equipe.
do $$
declare
  table_name text;
  display_name text;
begin
  drop policy if exists "Financial accounts clinic access" on public.financial_accounts;
  foreach table_name in array array[
    'extra_revenues',
    'expenses',
    'assets',
    'liabilities',
    'goals',
    'recorrencias',
    'financial_accounts'
  ] loop
    display_name := initcap(replace(table_name, '_', ' '));
    execute format('drop policy if exists %I on public.%I', display_name || ' own rows', table_name);
    execute format('drop policy if exists %I on public.%I', display_name || ' clinic access', table_name);
    execute format('drop policy if exists %I on public.%I', display_name || ' finance role access', table_name);
    execute format(
      'create policy %I on public.%I for all to authenticated using (user_id = public.data_owner_id() and public.finance_role_can_manage()) with check (user_id = public.data_owner_id() and public.finance_role_can_manage())',
      display_name || ' finance role access',
      table_name
    );
  end loop;
end $$;

-- O plano precisa continuar legível pelos perfis operacionais para que novos
-- atendimentos sejam classificados corretamente no razão. Somente admin/gestão edita.
drop policy if exists "Chart accounts clinic access" on public.chart_accounts;
drop policy if exists "Chart accounts clinic read" on public.chart_accounts;
drop policy if exists "Chart accounts finance write" on public.chart_accounts;

create policy "Chart accounts clinic read" on public.chart_accounts
  for select to authenticated
  using (user_id = public.data_owner_id());

create policy "Chart accounts finance write" on public.chart_accounts
  for all to authenticated
  using (user_id = public.data_owner_id() and public.finance_role_can_manage())
  with check (user_id = public.data_owner_id() and public.finance_role_can_manage());

-- Perfis operacionais só enxergam e sincronizam títulos derivados das telas às
-- quais já têm acesso. Receita extra, despesa e recorrência ficam invisíveis.
drop policy if exists "Financial entries clinic access" on public.financial_entries;
drop policy if exists "Financial entries role read" on public.financial_entries;
drop policy if exists "Financial entries role insert" on public.financial_entries;
drop policy if exists "Financial entries role update" on public.financial_entries;
drop policy if exists "Financial entries finance delete" on public.financial_entries;

create policy "Financial entries role read" on public.financial_entries
  for select to authenticated
  using (
    user_id = public.data_owner_id()
    and (
      public.financial_source_allowed_for_current_user(source_type, source_id)
    )
  );

create policy "Financial entries role insert" on public.financial_entries
  for insert to authenticated
  with check (
    user_id = public.data_owner_id()
    and (
      public.financial_source_allowed_for_current_user(source_type, source_id)
    )
  );

create policy "Financial entries role update" on public.financial_entries
  for update to authenticated
  using (
    user_id = public.data_owner_id()
    and (
      public.financial_source_allowed_for_current_user(source_type, source_id)
    )
  )
  with check (
    user_id = public.data_owner_id()
    and (
      public.financial_source_allowed_for_current_user(source_type, source_id)
    )
  );

create policy "Financial entries finance delete" on public.financial_entries
  for delete to authenticated
  using (user_id = public.data_owner_id() and public.finance_role_can_manage());

create or replace function public.financial_entry_visible_to_current_user(target_entry_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.financial_entries entry
    where entry.id = target_entry_id
      and entry.user_id = public.data_owner_id()
      and (
        public.financial_source_allowed_for_current_user(entry.source_type, entry.source_id)
      )
  )
$$;

revoke all on function public.financial_entry_visible_to_current_user(uuid) from public, anon;
grant execute on function public.financial_entry_visible_to_current_user(uuid) to authenticated;

drop policy if exists "Financial installments clinic access" on public.financial_installments;
drop policy if exists "Financial installments role read" on public.financial_installments;
drop policy if exists "Financial installments role insert" on public.financial_installments;
drop policy if exists "Financial installments role update" on public.financial_installments;
drop policy if exists "Financial installments finance delete" on public.financial_installments;

create policy "Financial installments role read" on public.financial_installments
  for select to authenticated
  using (
    user_id = public.data_owner_id()
    and public.financial_entry_visible_to_current_user(financial_entry_id)
  );

create policy "Financial installments role insert" on public.financial_installments
  for insert to authenticated
  with check (
    user_id = public.data_owner_id()
    and public.financial_entry_visible_to_current_user(financial_entry_id)
  );

create policy "Financial installments role update" on public.financial_installments
  for update to authenticated
  using (
    user_id = public.data_owner_id()
    and public.financial_entry_visible_to_current_user(financial_entry_id)
  )
  with check (
    user_id = public.data_owner_id()
    and public.financial_entry_visible_to_current_user(financial_entry_id)
  );

create policy "Financial installments finance delete" on public.financial_installments
  for delete to authenticated
  using (user_id = public.data_owner_id() and public.finance_role_can_manage());

commit;

-- Verificação manual por sessão:
-- select public.finance_role_can_manage();
-- Admin/gestão => true. Concierge/equipe => false.
