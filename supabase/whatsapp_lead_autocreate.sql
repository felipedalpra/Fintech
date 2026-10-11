-- whatsapp_lead_autocreate.sql
-- Lead automático: mensagem de número novo vira lead no pipeline (contato + oportunidade),
-- no estágio "primeiro_contato". Executar DEPOIS de opportunities_schema.sql e whatsapp_schema.sql.

-- 1. Novo estágio inicial do pipeline: "primeiro_contato".
alter table public.opportunities drop constraint if exists opportunities_stage_check;
alter table public.opportunities
  add constraint opportunities_stage_check
  check (stage in ('primeiro_contato','consulta_agendada','consultado','orcamento_enviado','reserva_paga','follow_up'));

-- 2. RPC atômica e idempotente: garante um lead (paciente + oportunidade) para um telefone.
--    Chamada pelo webhook (service role) quando a mensagem é de um número ainda sem paciente.
create or replace function public.ensure_whatsapp_lead(p_owner uuid, p_phone text, p_name text)
returns uuid
language plpgsql
security definer
as $$
declare
  pid uuid;
  oid uuid;
begin
  if p_owner is null or coalesce(p_phone, '') = '' then
    return null;
  end if;

  -- Já existe paciente com esse telefone (comparando só dígitos) nesta clínica?
  select id into pid
  from public.patients
  where user_id = p_owner
    and regexp_replace(coalesce(phone, ''), '\D', '', 'g') = p_phone
  limit 1;
  if pid is not null then
    return pid;
  end if;

  -- Cria o lead (paciente) e a oportunidade em "primeiro_contato".
  insert into public.patients (user_id, full_name, phone, active)
  values (p_owner, coalesce(nullif(p_name, ''), p_phone), p_phone, true)
  returning id into pid;

  insert into public.opportunities (user_id, patient_id, title, stage, status, source, stage_entered_at)
  values (p_owner, pid, 'Lead WhatsApp', 'primeiro_contato', 'aberto', 'whatsapp', timezone('utc', now()))
  returning id into oid;

  insert into public.opportunity_stage_history (opportunity_id, user_id, from_stage, to_stage, moved_by, source)
  values (oid, p_owner, null, 'primeiro_contato', null, 'automacao');

  return pid;
end $$;
