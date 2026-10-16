insert into public.billing_charges (
  id, user_id, created_by, patient_id, financial_entry_id, financial_installment_id,
  environment, billing_type, provider_charge_id, idempotency_key, external_reference,
  description, amount, due_date, status
) values (
  '77777777-7777-4777-8777-777777777777', '11111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
  '55555555-5555-4555-8555-555555555555', '66666666-6666-4666-8666-666666666666',
  'sandbox', 'PIX', 'pay_1', '88888888-8888-4888-8888-888888888888', 'surgimetrics:test',
  'Cirurgia Ana', 100, '2026-10-20', 'pending'
);

select public.apply_billing_webhook_event(
  '11111111-1111-4111-8111-111111111111', 'evt_received', 'PAYMENT_RECEIVED', 'pay_1', 'hash1',
  'received', '2026-10-16T15:00:00Z', 100, 97.50, 'pix'
);
-- Repetição do mesmo evento não pode duplicar baixa nem tarifa.
select public.apply_billing_webhook_event(
  '11111111-1111-4111-8111-111111111111', 'evt_received', 'PAYMENT_RECEIVED', 'pay_1', 'hash1',
  'received', '2026-10-16T15:00:00Z', 100, 97.50, 'pix'
);

do $$
declare settlements jsonb;
begin
  if (select status <> 'received' or fee_amount <> 2.50 from public.billing_charges where provider_charge_id = 'pay_1') then
    raise exception 'Cobrança não persistiu recebimento/tarifa corretamente.';
  end if;
  if (select status <> 'paid' or settlement_date <> '2026-10-16' or paid_amount <> 100 from public.financial_installments where id = '66666666-6666-4666-8666-666666666666') then
    raise exception 'Parcela não foi liquidada corretamente.';
  end if;
  select receipt_settlements into settlements from public.surgeries where id = '33333333-3333-4333-8333-333333333333';
  if settlements -> '1' ->> 'chargeId' <> '77777777-7777-4777-8777-777777777777' then
    raise exception 'Origem operacional perdeu o vínculo da cobrança.';
  end if;
  if (select count(*) <> 1 from public.expenses where id = '77777777-7777-4777-8777-777777777777' and value = 2.50 and status = 'pago') then
    raise exception 'Tarifa foi perdida ou duplicada.';
  end if;
  if (select count(*) <> 1 from public.billing_webhook_events where provider_event_id = 'evt_received' and status = 'processed') then
    raise exception 'Evento idempotente não foi persistido uma única vez.';
  end if;
end $$;

select public.apply_billing_webhook_event(
  '11111111-1111-4111-8111-111111111111', 'evt_refund', 'PAYMENT_REFUNDED', 'pay_1', 'hash2',
  'refunded', null, 100, 97.50, 'pix'
);
-- Evento atrasado não pode ressuscitar uma cobrança estornada.
select public.apply_billing_webhook_event(
  '11111111-1111-4111-8111-111111111111', 'evt_late', 'PAYMENT_UPDATED', 'pay_1', 'hash3',
  'pending', null, 100, 97.50, 'pix'
);

do $$
begin
  if (select status <> 'refunded' from public.billing_charges where provider_charge_id = 'pay_1') then
    raise exception 'Evento atrasado reabriu cobrança estornada.';
  end if;
  if (select status <> 'pending' or settlement_date is not null or paid_amount <> 0 from public.financial_installments where id = '66666666-6666-4666-8666-666666666666') then
    raise exception 'Estorno não reabriu a parcela corretamente.';
  end if;
  if (select payment_status <> 'pendente' or receipt_settlements <> '{}'::jsonb from public.surgeries where id = '33333333-3333-4333-8333-333333333333') then
    raise exception 'Estorno não propagou para a origem operacional.';
  end if;
  if (select archived_at is null from public.expenses where id = '77777777-7777-4777-8777-777777777777') then
    raise exception 'Tarifa do recebimento estornado continuou ativa.';
  end if;
end $$;
