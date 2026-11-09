-- crm_workspace_phase2.sql
-- CRM — Gestão de Oportunidades (workspace estilo Monday), Fase 2:
-- subitens (tarefas com status "aguardando"), edição em massa e menu contextual
-- (arquivar/restaurar, duplicar, tags em massa).
-- Migração ADITIVA e idempotente: não apaga, não reescreve registros existentes.
--
-- Executar DEPOIS de (já aplicados em produção):
--   access_control_schema.sql     (data_owner_id)
--   opportunities_schema.sql      (opportunities)
--   crm_contacts_schema.sql       (opportunities.contact_id)
--   tasks_timeline_schema.sql     (tasks)
--   crm_tasks_work_queue.sql      (tasks.task_type/outcome)
--   crm_workspace_phase1.sql      (colunas do workspace, histórico de campos)
-- Rodar no Supabase SQL Editor. Pode ser reaplicada sem efeito colateral.
--
-- O que faz:
--   1. tasks.status passa a aceitar 'aguardando' (continua aberta; só 'feita' encerra).
--   2. opportunities.status passa a aceitar 'arquivado' + colunas archived_at, archived_by e
--      archived_from_status (para restaurar o desfecho original).
--      Por que um status e não só archived_at: TODAS as buscas de "oportunidade aberta" do
--      servidor (reuso de lead do WhatsApp, create_manual_lead, automação do funil, SLA,
--      sugestão de IA) filtram status = 'aberto'. Com o status próprio, a arquivada sai de
--      todas elas sem reescrever nenhuma dessas funções.
--   3. RPCs SECURITY INVOKER (a RLS de quem chama vale): arquivar, restaurar, acrescentar
--      tags e duplicar oportunidades.

begin;

-- ---------------------------------------------------------------------------
-- 1. Tarefas: status 'aguardando'.
--    O check original é inline (nome gerado). Remove qualquer check de status de tasks e
--    recria com o conjunto ampliado — os valores antigos continuam válidos.
-- ---------------------------------------------------------------------------
do $$
declare c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.tasks'::regclass
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%status%'
      and pg_get_constraintdef(con.oid) ilike '%pendente%'
      and pg_get_constraintdef(con.oid) not ilike '%outcome%'
  loop
    execute format('alter table public.tasks drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.tasks
  add constraint tasks_status_check check (status in ('pendente', 'aguardando', 'feita'));

-- ---------------------------------------------------------------------------
-- 2. Oportunidades: status 'arquivado' (reversível).
-- ---------------------------------------------------------------------------
alter table public.opportunities add column if not exists archived_at timestamptz;
alter table public.opportunities add column if not exists archived_by uuid;
alter table public.opportunities add column if not exists archived_from_status text;

do $$
declare c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.opportunities'::regclass
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%status%'
      and pg_get_constraintdef(con.oid) ilike '%ganho%'
      and pg_get_constraintdef(con.oid) not ilike '%archived%'
  loop
    execute format('alter table public.opportunities drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.opportunities
  add constraint opportunities_status_check check (status in ('aberto', 'ganho', 'perdido', 'arquivado'));

do $$ begin
  begin
    -- Arquivada sempre sabe para onde voltar; não arquivada não carrega lixo de arquivamento.
    alter table public.opportunities
      add constraint opportunities_archived_consistency check (
        (status = 'arquivado' and archived_at is not null and archived_from_status in ('aberto', 'ganho', 'perdido'))
        or (status <> 'arquivado' and archived_at is null and archived_from_status is null)
      );
  exception when duplicate_object then null; end;
end $$;

-- ---------------------------------------------------------------------------
-- 3. RPCs. Todas SECURITY INVOKER: a policy "Opportunities clinic access" continua sendo a
--    barreira (user_id = data_owner_id()); o filtro explícito por data_owner_id() é defesa
--    em profundidade. Devolvem quantas linhas foram realmente alteradas.
-- ---------------------------------------------------------------------------
create or replace function public.crm_archive_opportunities(p_ids uuid[])
returns integer language plpgsql security invoker set search_path = public as $$
declare n integer;
begin
  update public.opportunities
  set archived_from_status = status,
      status = 'arquivado',
      archived_at = timezone('utc', now()),
      archived_by = auth.uid(),
      updated_at = timezone('utc', now())
  where id = any(coalesce(p_ids, '{}'))
    and user_id = public.data_owner_id()
    and status <> 'arquivado';
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.crm_restore_opportunities(p_ids uuid[])
returns integer language plpgsql security invoker set search_path = public as $$
declare n integer;
begin
  update public.opportunities
  set status = coalesce(archived_from_status, 'aberto'),
      archived_from_status = null,
      archived_at = null,
      archived_by = null,
      updated_at = timezone('utc', now())
  where id = any(coalesce(p_ids, '{}'))
    and user_id = public.data_owner_id()
    and status = 'arquivado';
  get diagnostics n = row_count;
  return n;
end $$;

-- Acrescenta tags (sem duplicar, preservando a ordem das existentes). Nunca remove tag.
create or replace function public.crm_add_opportunity_tags(p_ids uuid[], p_tags text[])
returns integer language plpgsql security invoker set search_path = public as $$
declare
  n integer;
  clean text[];
begin
  select coalesce(array_agg(t order by first_pos), '{}') into clean
  from (
    select left(btrim(t), 40) as t, min(ord) as first_pos
    from unnest(coalesce(p_tags, '{}')) with ordinality as x(t, ord)
    where btrim(coalesce(t, '')) <> ''
    group by left(btrim(t), 40)
  ) s;
  if array_length(clean, 1) is null then return 0; end if;

  update public.opportunities o
  set tags = coalesce(o.tags, '{}') || array(
        select t from unnest(clean) as t
        where not (t = any(coalesce(o.tags, '{}')))
      ),
      updated_at = timezone('utc', now())
  where o.id = any(coalesce(p_ids, '{}'))
    and o.user_id = public.data_owner_id()
    and exists (select 1 from unnest(clean) as t where not (t = any(coalesce(o.tags, '{}'))));
  get diagnostics n = row_count;
  return n;
end $$;

-- Duplica UMA oportunidade: nova linha aberta, mesma etapa, MESMO paciente/contato.
-- Copia apenas campos comerciais. NÃO copia: paciente/contato (só referencia), mensagens,
-- pagamentos, atendimentos, tarefas, notas, histórico, sugestão de IA, SLA nem vínculo Meta.
create or replace function public.crm_duplicate_opportunity(p_id uuid)
returns public.opportunities language plpgsql security invoker set search_path = public as $$
declare
  src public.opportunities;
  result public.opportunities;
begin
  select * into src from public.opportunities
  where id = p_id and user_id = public.data_owner_id();
  if src.id is null then raise exception 'Oportunidade não encontrada'; end if;

  insert into public.opportunities (
    user_id, patient_id, contact_id, title, stage, status, value, source, responsible_user_id, tags,
    procedure_id, probability, next_action, next_action_due, expected_surgery_date, custom_values,
    stage_entered_at
  ) values (
    src.user_id, src.patient_id, src.contact_id, src.title, src.stage, 'aberto', src.value, src.source,
    src.responsible_user_id, coalesce(src.tags, '{}'),
    src.procedure_id, src.probability, src.next_action, src.next_action_due, src.expected_surgery_date,
    coalesce(src.custom_values, '{}'::jsonb),
    timezone('utc', now())
  )
  returning * into result;
  return result;
end $$;

revoke all on function public.crm_archive_opportunities(uuid[]) from public, anon;
revoke all on function public.crm_restore_opportunities(uuid[]) from public, anon;
revoke all on function public.crm_add_opportunity_tags(uuid[], text[]) from public, anon;
revoke all on function public.crm_duplicate_opportunity(uuid) from public, anon;
grant execute on function public.crm_archive_opportunities(uuid[]) to authenticated;
grant execute on function public.crm_restore_opportunities(uuid[]) to authenticated;
grant execute on function public.crm_add_opportunity_tags(uuid[], text[]) to authenticated;
grant execute on function public.crm_duplicate_opportunity(uuid) to authenticated;

commit;

-- Verificação manual (opcional):
-- select status, count(*) from public.opportunities group by status;
-- select status, count(*) from public.tasks group by status;
