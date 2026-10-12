-- funnel_automation_schema.sql
-- CRM Fase 2 · sub-projeto 4 — Automação do funil (evento → estágio), modelo OPORTUNIDADES.
-- Avança a oportunidade de estágio automaticamente quando um evento claro acontece.
-- Forward-only (guarda pelo estágio anterior), auditável (opportunity_stage_history, source='automacao')
-- e FAIL-SAFE (nunca aborta o insert/update da consulta/cirurgia).
-- Executar DEPOIS de: opportunities_schema.sql e opportunity_move_rpc.sql. Rodar no SQL Editor.
-- Design: docs/superpowers/specs/2026-10-11-funnel-automation-opportunities-design.md

-- 1. Avança UMA oportunidade só se estiver exatamente no estágio esperado e aberta. Audita no history.
--    SEM raise de permissão (é sistêmico) — diferente de move_opportunity, para não abortar o evento-fonte.
create or replace function public.auto_advance_opportunity(p_opp uuid, p_from text, p_to text)
returns void
language plpgsql
security definer
as $$
declare
  v_owner uuid;
begin
  update public.opportunities
     set stage = p_to,
         stage_entered_at = timezone('utc', now()),
         updated_at = timezone('utc', now())
   where id = p_opp
     and stage = p_from
     and status = 'aberto'
   returning user_id into v_owner;

  if v_owner is not null then
    insert into public.opportunity_stage_history (opportunity_id, user_id, from_stage, to_stage, moved_by, source)
    values (p_opp, v_owner, p_from, p_to, auth.uid(), 'automacao');
  end if;
end $$;

-- 2. Resolve a oportunidade-alvo de um evento: usa o opportunity_id do evento; senão, a ÚNICA
--    oportunidade aberta do paciente (ambíguo = não chuta).
create or replace function public.resolve_event_opportunity(p_opp uuid, p_patient uuid)
returns uuid
language plpgsql
security definer
as $$
declare
  v_id uuid;
  v_count int;
begin
  if p_opp is not null then
    return p_opp;
  end if;
  if p_patient is null then
    return null;
  end if;
  select count(*) into v_count from public.opportunities
    where patient_id = p_patient and status = 'aberto';
  if v_count = 1 then
    select id into v_id from public.opportunities
      where patient_id = p_patient and status = 'aberto';
    return v_id;
  end if;
  return null;
end $$;

-- 3. Consulta criada → consulta_agendada ➜ consultado. (fail-safe: nunca aborta o insert da consulta)
create or replace function public.trg_consultation_funnel()
returns trigger
language plpgsql
security definer
as $$
declare
  v_opp uuid;
begin
  begin
    v_opp := public.resolve_event_opportunity(NEW.opportunity_id, NEW.patient_id);
    if v_opp is not null then
      perform public.auto_advance_opportunity(v_opp, 'consulta_agendada', 'consultado');
    end if;
  exception when others then null;
  end;
  return NEW;
end $$;

drop trigger if exists trg_consultation_funnel on public.consultations;
create trigger trg_consultation_funnel
  after insert on public.consultations
  for each row execute function public.trg_consultation_funnel();

-- 4. Cirurgia criada → consultado ➜ orcamento_enviado.
create or replace function public.trg_surgery_funnel()
returns trigger
language plpgsql
security definer
as $$
declare
  v_opp uuid;
begin
  begin
    v_opp := public.resolve_event_opportunity(NEW.opportunity_id, NEW.patient_id);
    if v_opp is not null then
      perform public.auto_advance_opportunity(v_opp, 'consultado', 'orcamento_enviado');
    end if;
  exception when others then null;
  end;
  return NEW;
end $$;

drop trigger if exists trg_surgery_funnel on public.surgeries;
create trigger trg_surgery_funnel
  after insert on public.surgeries
  for each row execute function public.trg_surgery_funnel();

-- 5. Pagamento da cirurgia vira pago/parcelado → orcamento_enviado ➜ reserva_paga.
--    Guarda IS DISTINCT FROM: só dispara quando o status MUDA de verdade (ignora re-save do autosave).
create or replace function public.trg_surgery_payment_funnel()
returns trigger
language plpgsql
security definer
as $$
declare
  v_opp uuid;
begin
  begin
    if NEW.payment_status in ('pago', 'parcelado')
       and OLD.payment_status is distinct from NEW.payment_status then
      v_opp := public.resolve_event_opportunity(NEW.opportunity_id, NEW.patient_id);
      if v_opp is not null then
        perform public.auto_advance_opportunity(v_opp, 'orcamento_enviado', 'reserva_paga');
      end if;
    end if;
  exception when others then null;
  end;
  return NEW;
end $$;

drop trigger if exists trg_surgery_payment_funnel on public.surgeries;
create trigger trg_surgery_payment_funnel
  after update of payment_status on public.surgeries
  for each row execute function public.trg_surgery_payment_funnel();

-- Verificação (rodar separado):
--   select trigger_name, event_object_table from information_schema.triggers
--   where trigger_name like 'trg_%funnel%';
-- Esperado: trg_consultation_funnel (consultations), trg_surgery_funnel + trg_surgery_payment_funnel (surgeries).
