-- crm_workspace_phase3.sql
-- CRM — Gestão de Oportunidades (workspace estilo Monday), Fase 3.
-- Migração ADITIVA e idempotente: não apaga, não reescreve dados existentes, não cria dado fictício.
--
-- Executar DEPOIS de (já aplicados em produção):
--   tasks_timeline_schema.sql   (opportunity_notes)
--   crm_workspace_phase1.sql    (crm_views, crm_can_manage_workspace)
--   crm_workspace_phase2.sql
-- Rodar no Supabase SQL Editor. Pode ser reaplicada sem efeito colateral.
--
-- O que faz:
--   1. Atualizações (comentários) da oportunidade = as MESMAS notas internas (opportunity_notes),
--      que ganham resposta (parent_id) e menções (mentions). Nenhuma tabela nova de comentário:
--      as notas antigas viram atualizações sem migração de dados.
--   2. Trigger de integridade das notas: autor = quem está logado, oportunidade da mesma clínica,
--      resposta sempre no mesmo fio (um nível) e menções só de pessoas da equipe da clínica.
--   3. opportunity_notes entra no Realtime (atualizações aparecem sem recarregar).
--   4. Visualizações iniciais (Meus leads, Follow-ups pendentes, Orçamentos em negociação) criadas
--      UMA vez por clínica pela RPC crm_ensure_default_views(). Se a gestão excluir uma delas,
--      ela não volta sozinha.

begin;

-- ---------------------------------------------------------------------------
-- 1. Notas da oportunidade: resposta e menções (colunas novas, retrocompatíveis).
-- ---------------------------------------------------------------------------
alter table public.opportunity_notes
  add column if not exists parent_id uuid references public.opportunity_notes(id) on delete cascade;
alter table public.opportunity_notes
  add column if not exists mentions uuid[] not null default '{}'::uuid[];

create index if not exists idx_opp_notes_parent on public.opportunity_notes(parent_id) where parent_id is not null;
create index if not exists idx_opp_notes_mentions on public.opportunity_notes using gin (mentions);
create index if not exists idx_opp_notes_owner_created on public.opportunity_notes(user_id, created_at desc);

-- Pessoa pertence à equipe da clínica (dono ou membro) — mesmo universo de clinic_team().
create or replace function public.crm_is_clinic_person(p_owner uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_user is not null and (
    p_user = p_owner
    or exists (
      select 1 from public.clinic_members cm
      join public.clinics c on c.id = cm.clinic_id
      where cm.user_id = p_user and c.owner_id = p_owner
    )
  )
$$;
-- Uso interno (trigger abaixo, que já roda como dono): não exposta, para ninguém sondar a equipe
-- de outra clínica.
revoke all on function public.crm_is_clinic_person(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Integridade das notas/atualizações.
-- ---------------------------------------------------------------------------
create or replace function public.opportunity_notes_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_parent public.opportunity_notes%rowtype;
  v_clean uuid[];
begin
  if tg_op = 'UPDATE' then
    -- Vínculos e autoria são imutáveis (o texto segue a regra que já existia).
    if new.user_id is distinct from old.user_id
       or new.opportunity_id is distinct from old.opportunity_id
       or new.parent_id is distinct from old.parent_id
       or new.author_id is distinct from old.author_id
       or new.created_at is distinct from old.created_at then
      raise exception 'Não é permitido mover ou trocar o autor de uma atualização';
    end if;
  else
    -- Autor é sempre quem está logado (quando há sessão).
    if auth.uid() is not null then
      new.author_id := auth.uid();
    end if;
    -- A oportunidade precisa ser da mesma clínica da nota.
    if not exists (select 1 from public.opportunities o where o.id = new.opportunity_id and o.user_id = new.user_id) then
      raise exception 'Oportunidade não encontrada nesta clínica';
    end if;
    -- Resposta: mesmo fio (um nível — responder a uma resposta vai para a atualização original).
    if new.parent_id is not null then
      select * into v_parent from public.opportunity_notes where id = new.parent_id;
      if not found or v_parent.opportunity_id <> new.opportunity_id or v_parent.user_id <> new.user_id then
        raise exception 'Atualização original não encontrada nesta oportunidade';
      end if;
      new.parent_id := coalesce(v_parent.parent_id, v_parent.id);
    end if;
  end if;

  -- Menções: sem repetição e só pessoas da equipe desta clínica.
  select coalesce(array_agg(distinct m), '{}'::uuid[]) into v_clean
  from unnest(coalesce(new.mentions, '{}'::uuid[])) as m
  where public.crm_is_clinic_person(new.user_id, m);
  if tg_op = 'UPDATE' and new.mentions is distinct from old.mentions then
    raise exception 'Não é permitido alterar as menções de uma atualização';
  end if;
  new.mentions := v_clean;
  return new;
end $$;
revoke all on function public.opportunity_notes_guard() from public, anon, authenticated;

drop trigger if exists trg_opportunity_notes_guard on public.opportunity_notes;
create trigger trg_opportunity_notes_guard
  before insert or update on public.opportunity_notes
  for each row execute function public.opportunity_notes_guard();

-- ---------------------------------------------------------------------------
-- 3. Realtime (a RLS de leitura continua valendo para quem recebe o evento).
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    execute 'alter publication supabase_realtime add table public.opportunity_notes';
  exception
    when duplicate_object then null;
    when undefined_object then null;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Visualizações iniciais (uma vez por clínica).
-- ---------------------------------------------------------------------------
alter table public.crm_views add column if not exists preset_key text;
create unique index if not exists uq_crm_views_preset
  on public.crm_views(user_id, preset_key) where preset_key is not null;

-- Marca de "já criei as visualizações iniciais desta clínica". Sem política: só a RPC escreve/lê.
create table if not exists public.crm_view_presets_seeded (
  user_id   uuid primary key references auth.users(id) on delete cascade,
  seeded_at timestamptz not null default timezone('utc', now())
);
alter table public.crm_view_presets_seeded enable row level security;
revoke all on public.crm_view_presets_seeded from public, anon, authenticated;

-- Configuração no mesmo formato de normalizeViewConfig (src/lib/crmWorkspace.js).
-- "me" no filtro de responsável = quem estiver vendo (cada pessoa vê os próprios leads).
create or replace function public.crm_ensure_default_views()
returns int language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := public.data_owner_id();
  v_pos int;
  v_count int := 0;
begin
  if v_owner is null or auth.uid() is null then
    return 0;
  end if;
  insert into public.crm_view_presets_seeded(user_id) values (v_owner) on conflict do nothing;
  if not found then
    return 0;  -- já criadas antes (ou outra pessoa da equipe criou agora)
  end if;

  select coalesce(max(position), 0) into v_pos from public.crm_views where user_id = v_owner;

  insert into public.crm_views (user_id, owner_id, name, scope, view_type, config, position, preset_key)
  values
    (v_owner, v_owner, 'Meus leads', 'shared', 'table', jsonb_build_object(
       'columns', '[]'::jsonb, 'groupBy', 'stage', 'groupOrder', '[]'::jsonb,
       'collapsed', '{}'::jsonb, 'sort', null,
       'filters', jsonb_build_object('responsible', jsonb_build_array('me'), 'status', 'aberto')
     ), v_pos + 1, 'my_leads'),
    (v_owner, v_owner, 'Follow-ups pendentes', 'shared', 'table', jsonb_build_object(
       'columns', '[]'::jsonb, 'groupBy', 'responsible', 'groupOrder', '[]'::jsonb,
       'collapsed', '{}'::jsonb, 'sort', jsonb_build_object('col', 'next_action_due', 'dir', 'asc'),
       'filters', jsonb_build_object('openTasks', true, 'status', 'aberto')
     ), v_pos + 2, 'pending_followups'),
    (v_owner, v_owner, 'Orçamentos em negociação', 'shared', 'table', jsonb_build_object(
       'columns', '[]'::jsonb, 'groupBy', 'responsible', 'groupOrder', '[]'::jsonb,
       'collapsed', '{}'::jsonb, 'sort', jsonb_build_object('col', 'value', 'dir', 'desc'),
       'filters', jsonb_build_object('stage', jsonb_build_array('orcamento_enviado'), 'status', 'aberto')
     ), v_pos + 3, 'quotes_in_negotiation')
  on conflict (user_id, preset_key) where preset_key is not null do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end $$;
revoke all on function public.crm_ensure_default_views() from public, anon;
grant execute on function public.crm_ensure_default_views() to authenticated;

commit;

-- Verificação (rodar separado, depois de aplicar):
-- select column_name from information_schema.columns
--   where table_name = 'opportunity_notes' and column_name in ('parent_id','mentions');      → 2 linhas
-- select count(*) from public.opportunity_notes where parent_id is not null or mentions <> '{}';  → 0 (nada mudou)
-- select tgname from pg_trigger where tgname = 'trg_opportunity_notes_guard';                   → 1 linha
-- select tablename from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'opportunity_notes';
-- As 3 visualizações iniciais aparecem no primeiro acesso ao CRM depois do deploy.
