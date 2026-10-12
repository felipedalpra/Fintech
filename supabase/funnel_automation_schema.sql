-- funnel_automation_schema.sql
-- CRM Fase 2 · sub-projeto 4 — Automação do funil (evento → estágio), modelo OPORTUNIDADES.
-- Cria a oportunidade no estágio certo se ela ainda não existe, e avança se existe e está atrás.
-- Forward-only (por rank — nunca regride/pula de forma a recuar), auditável (opportunity_stage_history,
-- source='automacao') e FAIL-SAFE (nunca aborta o insert/update da consulta/cirurgia).
-- Executar DEPOIS de: opportunities_schema.sql, opportunity_move_rpc.sql, whatsapp_lead_autocreate.sql.
-- Design: docs/superpowers/specs/2026-10-11-funnel-automation-opportunities-design.md

-- 0. Novos estágios no funil: cirurgia_marcada e cirurgia_feita (entre reserva_paga e follow_up).
alter table public.opportunities drop constraint if exists opportunities_stage_check;
alter table public.opportunities
  add constraint opportunities_stage_check
  check (stage in (
    'primeiro_contato','consulta_agendada','consultado','orcamento_enviado',
    'reserva_paga','cirurgia_marcada','cirurgia_feita','follow_up'
  ));

-- 1. Ordem (rank) dos estágios — base do forward-only.
create or replace function public.funnel_stage_rank(s text)
returns int language sql immutable as $$
  select case s
    when 'primeiro_contato'  then 1
    when 'consulta_agendada' then 2
    when 'consultado'        then 3
    when 'orcamento_enviado' then 4
    when 'reserva_paga'      then 5
    when 'cirurgia_marcada'  then 6
    when 'cirurgia_feita'    then 7
    when 'follow_up'         then 8
    else 0
  end
$$;

-- 2. Coloca a oportunidade do paciente num estágio-alvo:
--    - sem oportunidade aberta → CRIA no estágio-alvo (paciente entra no funil já no lugar certo);
--    - com oportunidade aberta e atrás do alvo → AVANÇA (forward-only por rank);
--    - já no alvo ou à frente → não faz nada (não regride, não sobrescreve avanço manual);
--    - paciente com +1 oportunidade aberta e sem opportunity_id no evento → não chuta (skip).
--    Tudo auditado em opportunity_stage_history (source='automacao').
create or replace function public.auto_funnel_set_stage(p_opp uuid, p_patient uuid, p_target text)
returns void
language plpgsql
security definer
as $$
declare
  v_opp uuid;
  v_cur text;
  v_owner uuid;
  v_name text;
  v_open_count int;
begin
  -- resolve a oportunidade-alvo
  if p_opp is not null then
    v_opp := p_opp;
  elsif p_patient is not null then
    select count(*) into v_open_count
      from public.opportunities where patient_id = p_patient and status = 'aberto';
    if v_open_count = 0 then
      -- CRIA no estágio-alvo
      select user_id, full_name into v_owner, v_name from public.patients where id = p_patient;
      if v_owner is null then return; end if;
      insert into public.opportunities (user_id, patient_id, title, stage, status, source, stage_entered_at)
      values (v_owner, p_patient, coalesce(nullif(v_name,''),'Oportunidade'), p_target, 'aberto', 'auto', timezone('utc', now()))
      returning id into v_opp;
      insert into public.opportunity_stage_history (opportunity_id, user_id, from_stage, to_stage, moved_by, source)
      values (v_opp, v_owner, null, p_target, auth.uid(), 'automacao');
      return;
    elsif v_open_count = 1 then
      select id into v_opp from public.opportunities where patient_id = p_patient and status = 'aberto';
    else
      return; -- ambíguo
    end if;
  else
    return;
  end if;

  -- AVANÇA se o alvo está à frente (forward-only) e a oportunidade está aberta
  select stage, user_id into v_cur, v_owner
    from public.opportunities where id = v_opp and status = 'aberto';
  if v_owner is null then return; end if;
  if public.funnel_stage_rank(p_target) > public.funnel_stage_rank(v_cur) then
    update public.opportunities
      set stage = p_target, stage_entered_at = timezone('utc', now()), updated_at = timezone('utc', now())
      where id = v_opp;
    insert into public.opportunity_stage_history (opportunity_id, user_id, from_stage, to_stage, moved_by, source)
    values (v_opp, v_owner, v_cur, p_target, auth.uid(), 'automacao');
  end if;
end $$;

-- 3. Consulta criada → Consulta Agendada. (fail-safe)
create or replace function public.trg_consultation_funnel()
returns trigger language plpgsql security definer as $$
begin
  begin
    perform public.auto_funnel_set_stage(NEW.opportunity_id, NEW.patient_id, 'consulta_agendada');
  exception when others then null; end;
  return NEW;
end $$;
drop trigger if exists trg_consultation_funnel on public.consultations;
create trigger trg_consultation_funnel
  after insert on public.consultations
  for each row execute function public.trg_consultation_funnel();

-- 4. Cirurgia criada → Cirurgia Marcada. (fail-safe)
create or replace function public.trg_surgery_funnel()
returns trigger language plpgsql security definer as $$
begin
  begin
    perform public.auto_funnel_set_stage(NEW.opportunity_id, NEW.patient_id, 'cirurgia_marcada');
  exception when others then null; end;
  return NEW;
end $$;
drop trigger if exists trg_surgery_funnel on public.surgeries;
create trigger trg_surgery_funnel
  after insert on public.surgeries
  for each row execute function public.trg_surgery_funnel();

-- 5. Pagamento da cirurgia vira pago/parcelado → Reserva Paga (só avança se ainda estava antes). (fail-safe)
create or replace function public.trg_surgery_payment_funnel()
returns trigger language plpgsql security definer as $$
begin
  begin
    if NEW.payment_status in ('pago','parcelado')
       and OLD.payment_status is distinct from NEW.payment_status then
      perform public.auto_funnel_set_stage(NEW.opportunity_id, NEW.patient_id, 'reserva_paga');
    end if;
  exception when others then null; end;
  return NEW;
end $$;
drop trigger if exists trg_surgery_payment_funnel on public.surgeries;
create trigger trg_surgery_payment_funnel
  after update of payment_status on public.surgeries
  for each row execute function public.trg_surgery_payment_funnel();

-- 6. Rotina diária: cirurgia cuja data já passou → Cirurgia Feita.
--    Chamada 1x/dia pelo cron de alertas (api/alerts/process.js). SECURITY DEFINER (roda como sistema).
create or replace function public.process_funnel_daily()
returns int
language plpgsql
security definer
as $$
declare
  rec record;
  v_count int := 0;
begin
  for rec in
    select distinct o.id as opp_id, o.user_id as owner
    from public.opportunities o
    join public.surgeries s
      on (s.opportunity_id = o.id or (s.opportunity_id is null and s.patient_id = o.patient_id))
    where o.status = 'aberto'
      and o.stage = 'cirurgia_marcada'
      and s.date <= current_date
      and s.payment_status <> 'cancelado'
  loop
    update public.opportunities
      set stage = 'cirurgia_feita', stage_entered_at = timezone('utc', now()), updated_at = timezone('utc', now())
      where id = rec.opp_id and stage = 'cirurgia_marcada' and status = 'aberto';
    if found then
      insert into public.opportunity_stage_history (opportunity_id, user_id, from_stage, to_stage, moved_by, source)
      values (rec.opp_id, rec.owner, 'cirurgia_marcada', 'cirurgia_feita', null, 'automacao');
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end $$;

-- Verificação:
--   select trigger_name, event_object_table from information_schema.triggers where trigger_name like 'trg_%funnel%';
--   select public.funnel_stage_rank('cirurgia_marcada'); -- 6
