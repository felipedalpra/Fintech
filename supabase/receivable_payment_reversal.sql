-- Estorno transacional e auditável de uma parcela recebida.
-- A função não apaga lançamentos: preserva o settlement como `reversed` e reabre
-- a parcela canônica. Executar depois de financial_ledger_schema.sql e
-- finance_role_access_schema.sql e billing_charges_schema.sql.

alter table public.financial_installments
  add column if not exists source_installment_number integer;

create or replace function public.try_payment_schedule(p_method text)
returns jsonb
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  input_text text := substring(coalesce(p_method, '') from 12);
  bytes bytea := ''::bytea;
  position_now integer := 1;
  char_now text;
  decoded jsonb;
begin
  if coalesce(p_method, '') not like 'pagamentos:%' then return null; end if;
  while position_now <= length(input_text) loop
    char_now := substring(input_text from position_now for 1);
    if char_now = '%' and position_now + 2 <= length(input_text) then
      bytes := bytes || decode(substring(input_text from position_now + 1 for 2), 'hex');
      position_now := position_now + 3;
    else
      bytes := bytes || convert_to(char_now, 'UTF8');
      position_now := position_now + 1;
    end if;
  end loop;
  decoded := convert_from(bytes, 'UTF8')::jsonb;
  if jsonb_typeof(decoded) <> 'array' then return null; end if;
  return decoded;
exception when others then
  return null;
end
$$;

revoke all on function public.try_payment_schedule(text) from public, anon;

-- Backfill determinístico para títulos existentes. A ordenação repete a regra do
-- financialLedger.js: vencimento e, em empate, a ordem original do cronograma.
with sources as (
  select entry.id entry_id, public.try_payment_schedule(surgery.payment_method) schedule
  from public.financial_entries entry
  join public.surgeries surgery on entry.source_type = 'surgery' and surgery.id = entry.source_id and surgery.user_id = entry.user_id
  where entry.source_component = 'revenue' and entry.archived_at is null
  union all
  select entry.id, public.try_payment_schedule(consultation.payment_method)
  from public.financial_entries entry
  join public.consultations consultation on entry.source_type = 'consultation' and consultation.id = entry.source_id and consultation.user_id = entry.user_id
  where entry.source_component = 'revenue' and entry.archived_at is null
  union all
  select entry.id, public.try_payment_schedule(sale.payment_method)
  from public.financial_entries entry
  join public.product_sales sale on entry.source_type = 'product_sale' and sale.id = entry.source_id and sale.user_id = entry.user_id
  where entry.source_component = 'revenue' and entry.archived_at is null
), schedule_rows as (
  select source.entry_id,
         item.ordinality::integer source_number,
         row_number() over (partition by source.entry_id order by item.value ->> 'date', item.ordinality)::integer ledger_number
  from sources source
  cross join lateral jsonb_array_elements(source.schedule) with ordinality item(value, ordinality)
  where source.schedule is not null
), mapped as (
  update public.financial_installments installment
  set source_installment_number = schedule_row.source_number,
      updated_at = timezone('utc', now())
  from schedule_rows schedule_row
  where installment.financial_entry_id = schedule_row.entry_id
    and installment.installment_number = schedule_row.ledger_number
    and installment.source_installment_number is null
  returning installment.id
)
update public.financial_installments installment
set source_installment_number = installment.installment_number,
    updated_at = timezone('utc', now())
where installment.source_installment_number is null
  and not exists (select 1 from mapped where mapped.id = installment.id);

create or replace function public.latest_active_receipt_date(p_settlements jsonb)
returns date
language sql
immutable
set search_path = public, pg_temp
as $$
  select max(nullif(value ->> 'receivedDate', '')::date)
  from jsonb_each(coalesce(p_settlements, '{}'::jsonb))
  where coalesce(value ->> 'status', 'received') <> 'reversed'
    and nullif(value ->> 'receivedDate', '') is not null
$$;

revoke all on function public.latest_active_receipt_date(jsonb) from public, anon;
grant execute on function public.latest_active_receipt_date(jsonb) to authenticated, service_role;

-- Atualiza a função já instalada no ambiente durante o upgrade. A definição
-- canônica em billing_charges_schema.sql contém as mesmas trocas; este bloco é
-- idempotente e falha fechado se encontrar uma versão desconhecida.
do $migration$
declare
  webhook_oid oid;
  original_definition text;
  patched_definition text;
  old_refund_expression text := 'select max((value ->> ''receivedDate'')::date) into latest_receipt_date from jsonb_each(settlements_after);';
  new_refund_expression text := 'latest_receipt_date := public.latest_active_receipt_date(settlements_after);';
begin
  select to_regprocedure('public.apply_billing_webhook_event(text,text,uuid,text,text,text,text,text,timestamptz,numeric,numeric,text)')::oid
  into webhook_oid;
  if webhook_oid is null then
    raise exception 'apply_billing_webhook_event precisa existir antes desta migration.';
  end if;
  select pg_get_functiondef(webhook_oid) into original_definition;
  patched_definition := original_definition;

  if position('settlement_key := installment_now.installment_number::text;' in patched_definition) > 0 then
    patched_definition := replace(
      patched_definition,
      'settlement_key := installment_now.installment_number::text;',
      'settlement_key := coalesce(installment_now.source_installment_number, installment_now.installment_number)::text;'
    );
  elsif position('settlement_key := coalesce(installment_now.source_installment_number, installment_now.installment_number)::text;' in patched_definition) = 0 then
    raise exception 'Versão desconhecida do settlement_key no webhook de cobrança.';
  end if;

  if position(E'jsonb_object_agg(\n      installment_number::text,' in patched_definition) > 0 then
    patched_definition := replace(
      patched_definition,
      E'jsonb_object_agg(\n      installment_number::text,',
      E'jsonb_object_agg(\n      coalesce(source_installment_number, installment_number)::text,'
    );
  elsif position('coalesce(source_installment_number, installment_number)::text' in patched_definition) = 0 then
    raise exception 'Versão desconhecida da materialização legada no webhook de cobrança.';
  end if;

  if position(old_refund_expression in patched_definition) > 0 then
    patched_definition := replace(patched_definition, old_refund_expression, new_refund_expression);
  elsif position(new_refund_expression in patched_definition) = 0 then
    raise exception 'Versão desconhecida do refund no webhook de cobrança.';
  end if;

  if patched_definition is distinct from original_definition then
    execute patched_definition;
  end if;
end
$migration$;

create or replace function public.reverse_receivable_installment(
  p_source_type text,
  p_source_id uuid,
  p_source_installment_number integer,
  p_ledger_installment_number integer,
  p_expected_receipt_settlements jsonb,
  p_expected_payment_status text,
  p_expected_receipt_date date,
  p_next_receipt_settlements jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  owner_now uuid := public.data_owner_id();
  entry_now public.financial_entries%rowtype;
  installment_now public.financial_installments%rowtype;
  current_settlements jsonb;
  current_status text;
  current_receipt_date date;
  current_target jsonb;
  next_target jsonb;
  audit_base jsonb;
  audit_history jsonb;
  latest_receipt_date date;
  remaining_paid integer;
  source_table text;
  status_column text;
  date_column text;
  source_count integer;
begin
  if auth.uid() is null or owner_now is null or not public.finance_role_can_manage() then
    raise exception 'Sem permissão para estornar recebimentos.' using errcode = '42501';
  end if;
  if p_source_type not in ('surgery', 'consultation', 'product_sale')
     or coalesce(p_source_installment_number, 0) < 1
     or coalesce(p_ledger_installment_number, 0) < 1
     or jsonb_typeof(coalesce(p_expected_receipt_settlements, '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_next_receipt_settlements, '{}'::jsonb)) <> 'object' then
    raise exception 'Parâmetros de estorno inválidos.' using errcode = '22023';
  end if;

  select installment.* into installment_now
  from public.financial_installments installment
  join public.financial_entries entry on entry.id = installment.financial_entry_id
  where entry.user_id = owner_now
    and entry.direction = 'receivable'
    and entry.source_type = p_source_type
    and entry.source_id = p_source_id
    and entry.source_component = 'revenue'
    and entry.archived_at is null
    and installment.user_id = owner_now
    and installment.installment_number = p_ledger_installment_number
    and installment.archived_at is null
  for update of installment;
  if installment_now.id is null then
    raise exception 'Parcela financeira não encontrada. Recarregue a página.' using errcode = 'P0002';
  end if;

  select * into entry_now
  from public.financial_entries
  where id = installment_now.financial_entry_id and user_id = owner_now
  for update;

  if p_source_type = 'surgery' then
    source_table := 'surgeries'; status_column := 'payment_status'; date_column := 'payment_date';
  elsif p_source_type = 'consultation' then
    source_table := 'consultations'; status_column := 'payment_status'; date_column := 'payment_date';
  else
    source_table := 'product_sales'; status_column := 'status'; date_column := 'received_date';
  end if;

  execute format(
    'select coalesce(receipt_settlements, ''{}''::jsonb) settlements, %I status, %I receipt_date from public.%I where id = $1 and user_id = $2 for update',
    status_column, date_column, source_table
  ) into current_settlements, current_status, current_receipt_date using p_source_id, owner_now;
  get diagnostics source_count = row_count;
  if source_count <> 1 then
    raise exception 'Lançamento de origem não encontrado.' using errcode = 'P0002';
  end if;

  if current_settlements is distinct from coalesce(p_expected_receipt_settlements, '{}'::jsonb)
     or current_status is distinct from p_expected_payment_status
     or current_receipt_date is distinct from p_expected_receipt_date then
    raise exception 'Os dados mudaram durante o estorno. Recarregue a página e tente novamente.' using errcode = '40001';
  end if;

  current_target := current_settlements -> p_source_installment_number::text;
  next_target := p_next_receipt_settlements -> p_source_installment_number::text;
  if next_target is null
     or coalesce(next_target ->> 'status', '') <> 'reversed'
     or nullif(next_target ->> 'reversedAt', '') is null then
    raise exception 'O histórico auditável do estorno é obrigatório.' using errcode = '22023';
  end if;
  if nullif(coalesce(current_target, next_target) ->> 'chargeId', '') is not null then
    raise exception 'Recebimentos de cobrança bancária devem ser estornados pelo provedor.' using errcode = '23514';
  end if;
  if current_target is not null then
    if nullif(current_target ->> 'receivedDate', '') is null
       or coalesce(current_target ->> 'status', 'received') = 'reversed'
       or (current_settlements - p_source_installment_number::text)
          is distinct from (p_next_receipt_settlements - p_source_installment_number::text)
       or (current_target - array['status','reversedAt','reversedByRole','reversalReason','history'])
          is distinct from (next_target - array['status','reversedAt','reversedByRole','reversalReason','history']) then
      raise exception 'O recebimento selecionado não corresponde ao estado atual.' using errcode = '40001';
    end if;
  elsif current_status not in ('pago', 'recebido') then
    raise exception 'Esta parcela não possui recebimento reconhecido para estornar.' using errcode = '23514';
  end if;

  if installment_now.status <> 'paid'
     or installment_now.settlement_date is null
     or abs(installment_now.amount - coalesce(nullif(next_target ->> 'amount', '')::numeric, -1)) > 0.01
     or installment_now.settlement_date <> nullif(next_target ->> 'receivedDate', '')::date then
    raise exception 'A parcela canônica diverge do recebimento. Recarregue antes de estornar.' using errcode = '40001';
  end if;
  if installment_now.source_installment_number is null
     or installment_now.source_installment_number <> p_source_installment_number then
    raise exception 'A identidade da parcela diverge do cronograma de origem. Recarregue antes de estornar.' using errcode = '40001';
  end if;

  -- A interface propõe a materialização legada, mas o servidor é a autoridade da
  -- trilha: horário e ator nunca são aceitos do navegador.
  audit_base := coalesce(current_target, next_target)
    - array['status','reversedAt','reversedBy','reversedByRole','reversalReason','history'];
  audit_history := coalesce(coalesce(current_target, next_target) -> 'history', '[]'::jsonb);
  if jsonb_typeof(audit_history) <> 'array' then audit_history := '[]'::jsonb; end if;
  next_target := audit_base || jsonb_build_object(
    'status', 'reversed',
    'reversedAt', timezone('utc', now()),
    'reversedBy', auth.uid(),
    'reversalReason', 'Estorno manual no financeiro',
    'history', audit_history || jsonb_build_array(jsonb_build_object(
      'action', 'reversed',
      'at', timezone('utc', now()),
      'by', auth.uid(),
      'reason', 'Estorno manual no financeiro',
      'previous', audit_base
    ))
  );
  p_next_receipt_settlements := jsonb_set(
    p_next_receipt_settlements,
    array[p_source_installment_number::text],
    next_target,
    true
  );

  latest_receipt_date := public.latest_active_receipt_date(p_next_receipt_settlements);
  execute format(
    'update public.%I set receipt_settlements = $1, %I = $2, %I = ''pendente'' where id = $3 and user_id = $4',
    source_table, date_column, status_column
  ) using p_next_receipt_settlements, latest_receipt_date, p_source_id, owner_now;

  update public.financial_installments
  set paid_amount = 0,
      settlement_date = null,
      status = 'pending',
      updated_at = timezone('utc', now())
  where id = installment_now.id;

  select count(*) into remaining_paid
  from public.financial_installments
  where financial_entry_id = entry_now.id
    and archived_at is null
    and status = 'paid';
  update public.financial_entries
  set status = case when remaining_paid > 0 then 'partially_paid' else 'pending' end,
      updated_at = timezone('utc', now())
  where id = entry_now.id;

  return jsonb_build_object(
    'receiptSettlements', p_next_receipt_settlements,
    'paymentStatus', 'pendente',
    'receiptDate', latest_receipt_date,
    'sourceInstallmentNumber', p_source_installment_number,
    'ledgerInstallmentNumber', p_ledger_installment_number
  );
end
$$;

revoke all on function public.reverse_receivable_installment(text, uuid, integer, integer, jsonb, text, date, jsonb) from public, anon;
grant execute on function public.reverse_receivable_installment(text, uuid, integer, integer, jsonb, text, date, jsonb) to authenticated;

-- Mantém a data de recebimento coerente também quando um webhook remove sua baixa.
create or replace function public.sync_active_receipt_date()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.receipt_settlements is distinct from old.receipt_settlements then
    if tg_table_name = 'product_sales' then
      new.received_date := public.latest_active_receipt_date(new.receipt_settlements);
    else
      new.payment_date := public.latest_active_receipt_date(new.receipt_settlements);
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists sync_surgery_active_receipt_date on public.surgeries;
create trigger sync_surgery_active_receipt_date before update of receipt_settlements on public.surgeries
for each row execute function public.sync_active_receipt_date();
drop trigger if exists sync_consultation_active_receipt_date on public.consultations;
create trigger sync_consultation_active_receipt_date before update of receipt_settlements on public.consultations
for each row execute function public.sync_active_receipt_date();
drop trigger if exists sync_product_sale_active_receipt_date on public.product_sales;
create trigger sync_product_sale_active_receipt_date before update of receipt_settlements on public.product_sales
for each row execute function public.sync_active_receipt_date();
