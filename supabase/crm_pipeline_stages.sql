-- CRM — etapas configuráveis do Kanban.
-- Aditiva e idempotente. Aplicar depois de crm_workspace_phase1.sql,
-- opportunities_schema.sql e opportunity_move_rpc.sql.

begin;

alter table public.crm_stage_settings
  add column if not exists archived_at timestamptz;

-- A configuração deixa de ser limitada às oito chaves originais. As chaves padrão
-- continuam estáveis e as customizadas são geradas pela aplicação.
alter table public.crm_stage_settings
  drop constraint if exists crm_stage_settings_stage_key_check;
alter table public.crm_stage_settings
  add constraint crm_stage_settings_stage_key_format
  check (length(trim(stage_key)) between 2 and 80 and stage_key ~ '^[a-z0-9_]+$');

alter table public.opportunities drop constraint if exists opportunities_stage_check;

create or replace function public.crm_allowed_stage(p_owner uuid, p_stage text)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select p_stage in (
    'primeiro_contato','consulta_agendada','consultado','encaminhado_nutrologia',
    'exames_prontos','orcamento_enviado','reserva_paga','cirurgia_marcada',
    'cirurgia_feita','follow_up'
  )
  or exists (
    select 1 from public.crm_stage_settings s
    where s.user_id = p_owner and s.stage_key = p_stage and s.archived_at is null
  )
$$;
revoke all on function public.crm_allowed_stage(uuid, text) from public, anon;
grant execute on function public.crm_allowed_stage(uuid, text) to authenticated;

create or replace function public.crm_opportunity_stage_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.crm_allowed_stage(new.user_id, new.stage) then
    raise exception 'Etapa inválida ou arquivada para esta clínica';
  end if;
  return new;
end $$;

drop trigger if exists trg_crm_opportunity_stage_guard on public.opportunities;
create trigger trg_crm_opportunity_stage_guard
  before insert or update of user_id, stage on public.opportunities
  for each row execute function public.crm_opportunity_stage_guard();

-- Exclui (arquiva) uma etapa sem deixar oportunidades órfãs: move todos os registros
-- para a etapa escolhida e registra cada movimento no histórico auditável.
create or replace function public.crm_delete_stage(p_stage_key text, p_replacement_key text)
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  owner uuid := public.data_owner_id();
  moved integer := 0;
begin
  if owner is null or not public.crm_can_manage_workspace() then
    raise exception 'Sem permissão para configurar as etapas';
  end if;
  if p_stage_key is null or p_replacement_key is null or p_stage_key = p_replacement_key then
    raise exception 'Escolha uma etapa de destino diferente';
  end if;
  if not public.crm_allowed_stage(owner, p_replacement_key) then
    raise exception 'Etapa de destino inválida';
  end if;
  if not public.crm_allowed_stage(owner, p_stage_key) then
    raise exception 'Etapa de origem inválida';
  end if;
  select count(*) into moved from public.opportunities
    where user_id = owner and stage = p_stage_key;

  insert into public.opportunity_stage_history
    (opportunity_id, user_id, from_stage, to_stage, moved_by, source)
  select id, user_id, stage, p_replacement_key, auth.uid(), 'manual'
    from public.opportunities where user_id = owner and stage = p_stage_key;

  update public.opportunities
    set stage = p_replacement_key,
        stage_entered_at = timezone('utc', now()),
        updated_at = timezone('utc', now())
    where user_id = owner and stage = p_stage_key;

  insert into public.crm_stage_settings (user_id, stage_key, archived_at, updated_by, updated_at)
    values (owner, p_stage_key, timezone('utc', now()), auth.uid(), timezone('utc', now()))
    on conflict (user_id, stage_key) do update
      set archived_at = excluded.archived_at, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  return moved;
end $$;
revoke all on function public.crm_delete_stage(text, text) from public, anon;
grant execute on function public.crm_delete_stage(text, text) to authenticated;

-- Automação de avanço também conhece as duas etapas novas. Etapas customizadas
-- continuam sendo manuais (rank 0), sem alterar o comportamento existente.
create or replace function public.funnel_stage_rank(s text)
returns int language sql immutable as $$
  select case s
    when 'primeiro_contato' then 1 when 'consulta_agendada' then 2 when 'consultado' then 3
    when 'encaminhado_nutrologia' then 4 when 'exames_prontos' then 5
    when 'orcamento_enviado' then 6 when 'reserva_paga' then 7
    when 'cirurgia_marcada' then 8 when 'cirurgia_feita' then 9 when 'follow_up' then 10
    else 0 end
$$;

create or replace function public.move_opportunity(
  opp_id uuid, new_stage text, move_source text default 'manual'
)
returns public.opportunities language plpgsql security definer set search_path = public, pg_temp as $$
declare
  old_stage text; owner uuid; result public.opportunities;
begin
  select stage, user_id into old_stage, owner from public.opportunities where id = opp_id;
  if owner is null then raise exception 'Oportunidade não encontrada'; end if;
  if owner <> public.data_owner_id() then raise exception 'Sem permissão para mover esta oportunidade'; end if;
  if not public.crm_allowed_stage(owner, new_stage) then raise exception 'Etapa inválida ou arquivada'; end if;
  if move_source not in ('manual', 'automacao') then move_source := 'manual'; end if;
  update public.opportunities set stage = new_stage, stage_entered_at = timezone('utc', now()), updated_at = timezone('utc', now())
    where id = opp_id returning * into result;
  insert into public.opportunity_stage_history (opportunity_id, user_id, from_stage, to_stage, moved_by, source)
    values (opp_id, owner, old_stage, new_stage, auth.uid(), move_source);
  return result;
end $$;

commit;
