-- Endurece funções SECURITY DEFINER legadas e reduz execução pública.
-- Idempotente: funções ausentes são ignoradas para permitir rollout incremental.

do $$
declare
  signature text;
  signatures text[] := array[
    'public.auto_funnel_set_stage(uuid,uuid,text)',
    'public.trg_consultation_funnel()',
    'public.trg_surgery_funnel()',
    'public.trg_surgery_payment_funnel()',
    'public.process_funnel_daily()',
    'public.apply_followup_rules()',
    'public.move_opportunity(uuid,text,text)',
    'public.export_patient_data(uuid)',
    'public.anonymize_patient_data(uuid)',
    'public.delete_patient_data(uuid)',
    'public.log_record_change()',
    'public.ensure_whatsapp_lead(uuid,text,text)'
  ];
begin
  foreach signature in array signatures loop
    if to_regprocedure(signature) is not null then
      execute format('alter function %s set search_path = public, pg_temp', signature);
    end if;
  end loop;
end $$;

do $$
declare
  signature text;
  signatures text[] := array[
    'public.auto_funnel_set_stage(uuid,uuid,text)',
    'public.trg_consultation_funnel()',
    'public.trg_surgery_funnel()',
    'public.trg_surgery_payment_funnel()',
    'public.apply_followup_rules()',
    'public.log_record_change()',
    'public.ensure_whatsapp_lead(uuid,text,text)'
  ];
begin
  foreach signature in array signatures loop
    if to_regprocedure(signature) is not null then
      execute format('revoke all on function %s from public, anon, authenticated', signature);
    end if;
  end loop;

  if to_regprocedure('public.process_funnel_daily()') is not null then
    revoke all on function public.process_funnel_daily() from public, anon, authenticated;
    grant execute on function public.process_funnel_daily() to service_role;
  end if;
  if to_regprocedure('public.move_opportunity(uuid,text,text)') is not null then
    revoke all on function public.move_opportunity(uuid,text,text) from public, anon;
    grant execute on function public.move_opportunity(uuid,text,text) to authenticated;
  end if;
  if to_regprocedure('public.ensure_whatsapp_lead(uuid,text,text)') is not null then
    grant execute on function public.ensure_whatsapp_lead(uuid,text,text) to service_role;
  end if;
  foreach signature in array array[
    'public.export_patient_data(uuid)',
    'public.anonymize_patient_data(uuid)',
    'public.delete_patient_data(uuid)'
  ] loop
    if to_regprocedure(signature) is not null then
      execute format('revoke all on function %s from public, anon', signature);
      execute format('grant execute on function %s to authenticated', signature);
    end if;
  end loop;
end $$;

