-- billing_charges_schema.sql
-- Fase 3: cobranças Asaas (boleto/Pix), webhook idempotente e liquidação fiel ao razão.
-- Executar DEPOIS de: access_control_schema.sql, patients_schema.sql,
-- financial_ledger_schema.sql, chart_of_accounts_schema.sql, finance_soft_delete.sql,
-- finance_role_access_schema.sql e whatsapp_automations_schema.sql.

begin;

-- Datas reais por parcela. A chave do JSON é o número da parcela ("1", "2", ...).
-- Exemplo: {"1":{"receivedDate":"2026-10-16","amount":500,"method":"pix","chargeId":"..."}}
alter table public.surgeries
  add column if not exists receipt_settlements jsonb not null default '{}'::jsonb;
alter table public.consultations
  add column if not exists receipt_settlements jsonb not null default '{}'::jsonb;
alter table public.product_sales
  add column if not exists receipt_settlements jsonb not null default '{}'::jsonb;

alter table public.whatsapp_automations
  alter column payment_template set default
  'Olá {patient_name}! Sua cobrança de {value} vence em {date}. Pague por aqui: {payment_link}';
update public.whatsapp_automations
set payment_template = 'Olá {patient_name}! Sua cobrança de {value} vence em {date}. Pague por aqui: {payment_link}'
where payment_template = 'Olá {patient_name}! Consta um pagamento de {value} com vencimento em {date}. Qualquer dúvida sobre o pagamento, estamos à disposição.';

create table if not exists public.billing_provider_connections (
  user_id                 uuid primary key references auth.users(id) on delete cascade,
  provider                text not null default 'asaas' check (provider in ('asaas')),
  environment             text not null default 'sandbox' check (environment in ('sandbox','production')),
  encrypted_api_key       text not null,
  api_key_last4           text,
  webhook_token_hash      text not null unique,
  provider_webhook_id     text,
  status                  text not null default 'connected' check (status in ('connected','error','disabled')),
  last_error              text,
  verified_at             timestamptz,
  created_at              timestamptz not null default timezone('utc', now()),
  updated_at              timestamptz not null default timezone('utc', now())
);

-- Segredos são write-only pelo endpoint server-side. Nem admin lê esta tabela via browser.
alter table public.billing_provider_connections enable row level security;
revoke all on public.billing_provider_connections from public, anon, authenticated;

create table if not exists public.billing_provider_customers (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null references auth.users(id) on delete cascade,
  patient_id              uuid not null references public.patients(id) on delete cascade,
  provider                text not null default 'asaas',
  environment             text not null,
  provider_customer_id    text not null,
  created_at              timestamptz not null default timezone('utc', now()),
  updated_at              timestamptz not null default timezone('utc', now()),
  unique (user_id, patient_id, provider, environment),
  unique (provider, environment, provider_customer_id)
);

create table if not exists public.billing_charges (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references auth.users(id) on delete cascade,
  created_by               uuid references auth.users(id) on delete set null,
  patient_id               uuid not null references public.patients(id) on delete restrict,
  financial_entry_id       uuid not null references public.financial_entries(id) on delete restrict,
  financial_installment_id uuid not null references public.financial_installments(id) on delete restrict,
  provider                 text not null default 'asaas' check (provider in ('asaas')),
  environment              text not null check (environment in ('sandbox','production')),
  billing_type             text not null check (billing_type in ('BOLETO','PIX')),
  provider_charge_id       text,
  idempotency_key          uuid not null,
  external_reference       text not null,
  description              text not null,
  amount                   numeric(12,2) not null check (amount > 0),
  net_amount               numeric(12,2),
  fee_amount               numeric(12,2) not null default 0 check (fee_amount >= 0),
  due_date                 date not null,
  status                   text not null default 'creating'
                             check (status in ('creating','pending','confirmed','received','overdue','canceled','refunded','failed')),
  invoice_url              text,
  bank_slip_url            text,
  boleto_barcode           text,
  pix_payload              text,
  paid_at                  timestamptz,
  canceled_at              timestamptz,
  provider_payload         jsonb not null default '{}'::jsonb,
  fee_expense_id           uuid,
  last_error               text,
  created_at               timestamptz not null default timezone('utc', now()),
  updated_at               timestamptz not null default timezone('utc', now()),
  unique (user_id, idempotency_key),
  unique (provider, environment, provider_charge_id),
  unique (user_id, external_reference)
);

-- Uma parcela só pode ter uma cobrança ainda válida. Cancelar/reembolsar libera reemissão.
create unique index if not exists uq_billing_charge_active_installment
  on public.billing_charges(financial_installment_id)
  where status not in ('canceled','refunded','failed');
create index if not exists idx_billing_charges_owner_status
  on public.billing_charges(user_id, status, due_date desc);
create index if not exists idx_billing_charges_provider_id
  on public.billing_charges(provider, environment, provider_charge_id);

create table if not exists public.billing_webhook_events (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  provider            text not null default 'asaas',
  provider_event_id   text not null,
  event_type          text not null,
  provider_charge_id  text,
  payload_hash        text not null,
  status              text not null default 'processing' check (status in ('processing','processed','ignored','failed')),
  error_message       text,
  created_at          timestamptz not null default timezone('utc', now()),
  processed_at        timestamptz,
  unique (provider, provider_event_id)
);

alter table public.billing_provider_customers enable row level security;
alter table public.billing_charges enable row level security;
alter table public.billing_webhook_events enable row level security;

drop policy if exists "Billing customers finance access" on public.billing_provider_customers;
create policy "Billing customers finance access" on public.billing_provider_customers
  for select to authenticated
  using (user_id = public.data_owner_id() and public.finance_role_can_manage());

drop policy if exists "Billing charges finance read" on public.billing_charges;
create policy "Billing charges finance read" on public.billing_charges
  for select to authenticated
  using (user_id = public.data_owner_id() and public.finance_role_can_manage());

-- Escritas de cobranças/eventos são exclusivamente server-side (service_role).
revoke insert, update, delete on public.billing_provider_customers from authenticated;
revoke insert, update, delete on public.billing_charges from authenticated;
revoke all on public.billing_webhook_events from public, anon, authenticated;
grant select on public.billing_provider_customers, public.billing_charges to authenticated;
grant all on public.billing_provider_connections, public.billing_provider_customers,
  public.billing_charges, public.billing_webhook_events to service_role;

-- Aplica um webhook em uma única transação. O evento duplicado retorna sem repetir a baixa.
create or replace function public.apply_billing_webhook_event(
  p_user_id uuid,
  p_provider_event_id text,
  p_event_type text,
  p_provider_charge_id text,
  p_payload_hash text,
  p_status text,
  p_paid_at timestamptz default null,
  p_gross_amount numeric default null,
  p_net_amount numeric default null,
  p_payment_method text default null
)
returns public.billing_charges
language plpgsql
security definer
set search_path = public
as $$
declare
  charge_now public.billing_charges;
  installment_now public.financial_installments;
  entry_now public.financial_entries;
  v_received_date date;
  settlement_key text;
  settlement_value jsonb;
  settlements_after jsonb;
  legacy_settlements jsonb;
  remaining_open integer;
  remaining_paid integer;
  latest_receipt_date date;
  fee_now numeric(12,2);
  fee_account_id uuid;
  effective_status text;
  inserted_event boolean := false;
begin
  if p_user_id is null or coalesce(trim(p_provider_event_id), '') = '' then
    raise exception 'Evento de cobrança inválido.';
  end if;

  insert into public.billing_webhook_events (
    user_id, provider, provider_event_id, event_type, provider_charge_id, payload_hash
  ) values (
    p_user_id, 'asaas', p_provider_event_id, p_event_type, p_provider_charge_id, p_payload_hash
  ) on conflict (provider, provider_event_id) do update
      set status = 'processing',
          error_message = null,
          processed_at = null
      where billing_webhook_events.status = 'failed';
  inserted_event := found;

  select * into charge_now
  from public.billing_charges
  where user_id = p_user_id
    and provider = 'asaas'
    and provider_charge_id = p_provider_charge_id
  for update;

  if charge_now.id is null then
    if inserted_event then
      update public.billing_webhook_events
      set status = 'ignored', processed_at = timezone('utc', now())
      where provider = 'asaas' and provider_event_id = p_provider_event_id;
    end if;
    return null;
  end if;

  if not inserted_event then
    return charge_now;
  end if;

  if p_status in ('confirmed','received') and p_gross_amount is not null
     and abs(p_gross_amount - charge_now.amount) > 0.01 then
    raise exception 'Valor recebido (%) diverge da cobrança vinculada (%).', p_gross_amount, charge_now.amount;
  end if;

  effective_status := case
    when charge_now.status = 'refunded' then charge_now.status
    when charge_now.status = 'received' and p_status in ('pending','overdue','confirmed') then charge_now.status
    when charge_now.status = 'confirmed' and p_status in ('pending','overdue') then charge_now.status
    when charge_now.status = 'canceled' and p_status in ('pending','overdue') then charge_now.status
    else p_status
  end;

  update public.billing_charges
  set status = effective_status,
      paid_at = case when p_status in ('confirmed','received') then coalesce(p_paid_at, paid_at, timezone('utc', now())) else paid_at end,
      canceled_at = case when p_status in ('canceled','refunded') then timezone('utc', now()) else canceled_at end,
      net_amount = coalesce(p_net_amount, net_amount),
      fee_amount = case
        when p_gross_amount is not null and p_net_amount is not null then greatest(0, round(p_gross_amount - p_net_amount, 2))
        else fee_amount
      end,
      updated_at = timezone('utc', now()),
      last_error = null
  where id = charge_now.id
  returning * into charge_now;

  select * into installment_now
  from public.financial_installments
  where id = charge_now.financial_installment_id and user_id = p_user_id
  for update;
  select * into entry_now
  from public.financial_entries
  where id = charge_now.financial_entry_id and user_id = p_user_id
  for update;

  if installment_now.id is null or entry_now.id is null then
    raise exception 'Parcela financeira vinculada à cobrança não foi encontrada.';
  end if;

  v_received_date := coalesce((p_paid_at at time zone 'America/Sao_Paulo')::date, current_date);
  settlement_key := installment_now.installment_number::text;
  settlement_value := jsonb_build_object(
    'receivedDate', v_received_date,
    'amount', charge_now.amount,
    'method', coalesce(nullif(p_payment_method, ''), lower(charge_now.billing_type)),
    'chargeId', charge_now.id,
    'provider', charge_now.provider
  );

  if effective_status in ('confirmed','received') then
    update public.financial_installments
    set paid_amount = amount,
        settlement_date = v_received_date,
        payment_method = coalesce(nullif(p_payment_method, ''), lower(charge_now.billing_type)),
        status = 'paid',
        updated_at = timezone('utc', now())
    where id = installment_now.id;

    select count(*) into remaining_open
    from public.financial_installments
    where financial_entry_id = entry_now.id
      and id <> installment_now.id
      and archived_at is null
      and status not in ('paid','canceled','refunded');

    update public.financial_entries
    set status = case when remaining_open = 0 then 'paid' else 'partially_paid' end,
        updated_at = timezone('utc', now())
    where id = entry_now.id;

    select coalesce(jsonb_object_agg(
      installment_number::text,
      jsonb_build_object(
        'receivedDate', settlement_date,
        'amount', amount,
        'method', coalesce(payment_method, 'legacy'),
        'legacy', true
      )
    ), '{}'::jsonb) into legacy_settlements
    from public.financial_installments
    where financial_entry_id = entry_now.id
      and archived_at is null
      and status = 'paid'
      and settlement_date is not null;

    if entry_now.source_type = 'surgery' then
      update public.surgeries
      set receipt_settlements = legacy_settlements || coalesce(receipt_settlements, '{}'::jsonb) || jsonb_build_object(settlement_key, settlement_value),
          payment_date = greatest(coalesce(surgeries.payment_date, v_received_date), v_received_date),
          payment_status = case when remaining_open = 0 then 'pago' else 'pendente' end
      where id = entry_now.source_id and user_id = p_user_id;
    elsif entry_now.source_type = 'consultation' then
      update public.consultations
      set receipt_settlements = legacy_settlements || coalesce(receipt_settlements, '{}'::jsonb) || jsonb_build_object(settlement_key, settlement_value),
          payment_date = greatest(coalesce(consultations.payment_date, v_received_date), v_received_date),
          payment_status = case when remaining_open = 0 then 'pago' else 'pendente' end
      where id = entry_now.source_id and user_id = p_user_id;
    elsif entry_now.source_type = 'product_sale' then
      update public.product_sales
      set receipt_settlements = legacy_settlements || coalesce(receipt_settlements, '{}'::jsonb) || jsonb_build_object(settlement_key, settlement_value),
          received_date = greatest(coalesce(product_sales.received_date, v_received_date), v_received_date),
          status = case when remaining_open = 0 then 'recebido' else 'pendente' end,
          payment_method = coalesce(nullif(p_payment_method, ''), lower(charge_now.billing_type))
      where id = entry_now.source_id and user_id = p_user_id;
    elsif entry_now.source_type = 'extra_revenue' then
      update public.extra_revenues
      set received_date = v_received_date,
          status = 'recebido'
      where id = entry_now.source_id and user_id = p_user_id;
    else
      raise exception 'Origem % não suporta baixa automática.', entry_now.source_type;
    end if;

    -- A receita permanece bruta. A tarifa vira despesa financeira própria para caixa e DRE baterem.
    fee_now := greatest(0, coalesce(p_gross_amount, charge_now.amount) - coalesce(p_net_amount, p_gross_amount, charge_now.amount));
    if fee_now > 0 then
      select id into fee_account_id
      from public.chart_accounts
      where user_id = p_user_id and code = '8.02.04' and is_active = true
      order by created_at asc limit 1;

      insert into public.expenses (
        id, user_id, description, category, value, due_date, competence_date,
        payment_date, status, cost_center, origin_label, chart_account_id
      ) values (
        charge_now.id, p_user_id, 'Tarifa de cobrança Asaas - ' || charge_now.description,
        'taxas_meios_pagamento', fee_now, v_received_date, v_received_date,
        v_received_date, 'pago', 'Financeiro', 'Asaas', fee_account_id
      ) on conflict (id) do update set
        value = excluded.value,
        due_date = excluded.due_date,
        competence_date = excluded.competence_date,
        payment_date = excluded.payment_date,
        status = 'pago',
        archived_at = null;

      update public.billing_charges set fee_expense_id = charge_now.id where id = charge_now.id;
    end if;
  elsif effective_status = 'refunded' then
    -- Só desfaz a baixa se ela ainda pertence a esta cobrança; nunca apaga edição humana concorrente.
    if entry_now.source_type = 'surgery' then
      select coalesce(receipt_settlements, '{}'::jsonb) - settlement_key into settlements_after
      from public.surgeries
      where id = entry_now.source_id and user_id = p_user_id
        and receipt_settlements -> settlement_key ->> 'chargeId' = charge_now.id::text;
      if settlements_after is not null then
        select max((value ->> 'receivedDate')::date) into latest_receipt_date from jsonb_each(settlements_after);
        update public.surgeries set receipt_settlements = settlements_after, payment_status = 'pendente', payment_date = latest_receipt_date
        where id = entry_now.source_id and user_id = p_user_id;
      end if;
    elsif entry_now.source_type = 'consultation' then
      select coalesce(receipt_settlements, '{}'::jsonb) - settlement_key into settlements_after
      from public.consultations
      where id = entry_now.source_id and user_id = p_user_id
        and receipt_settlements -> settlement_key ->> 'chargeId' = charge_now.id::text;
      if settlements_after is not null then
        select max((value ->> 'receivedDate')::date) into latest_receipt_date from jsonb_each(settlements_after);
        update public.consultations set receipt_settlements = settlements_after, payment_status = 'pendente', payment_date = latest_receipt_date
        where id = entry_now.source_id and user_id = p_user_id;
      end if;
    elsif entry_now.source_type = 'product_sale' then
      select coalesce(receipt_settlements, '{}'::jsonb) - settlement_key into settlements_after
      from public.product_sales
      where id = entry_now.source_id and user_id = p_user_id
        and receipt_settlements -> settlement_key ->> 'chargeId' = charge_now.id::text;
      if settlements_after is not null then
        select max((value ->> 'receivedDate')::date) into latest_receipt_date from jsonb_each(settlements_after);
        update public.product_sales set receipt_settlements = settlements_after, status = 'pendente', received_date = latest_receipt_date
        where id = entry_now.source_id and user_id = p_user_id;
      end if;
    elsif entry_now.source_type = 'extra_revenue' then
      update public.extra_revenues set received_date = null, status = 'pendente'
      where id = entry_now.source_id and user_id = p_user_id;
    end if;

    update public.financial_installments
    set paid_amount = 0, settlement_date = null, status = 'pending', updated_at = timezone('utc', now())
    where id = installment_now.id;
    select count(*) into remaining_paid
    from public.financial_installments
    where financial_entry_id = entry_now.id
      and id <> installment_now.id
      and archived_at is null
      and status = 'paid';
    update public.financial_entries
    set status = case when remaining_paid > 0 then 'partially_paid' else 'pending' end,
        updated_at = timezone('utc', now())
    where id = entry_now.id;
    if charge_now.fee_expense_id is not null then
      update public.expenses
      set archived_at = timezone('utc', now()), status = 'aberto'
      where id = charge_now.fee_expense_id and user_id = p_user_id;
    end if;
  end if;

  update public.billing_webhook_events
  set status = 'processed', processed_at = timezone('utc', now())
  where provider = 'asaas' and provider_event_id = p_provider_event_id;

  select * into charge_now from public.billing_charges where id = charge_now.id;
  return charge_now;
end;
$$;

revoke all on function public.apply_billing_webhook_event(uuid,text,text,text,text,text,timestamptz,numeric,numeric,text) from public, anon, authenticated;
grant execute on function public.apply_billing_webhook_event(uuid,text,text,text,text,text,timestamptz,numeric,numeric,text) to service_role;

commit;

-- Verificação pós-aplicação:
-- select table_name from information_schema.tables
-- where table_schema='public' and table_name like 'billing_%' order by table_name;
-- select column_name from information_schema.columns
-- where table_schema='public' and table_name='surgeries' and column_name='receipt_settlements';
