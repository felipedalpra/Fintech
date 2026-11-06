-- crm_workspace_phase1.sql
-- CRM — Gestão de Oportunidades (workspace estilo Monday), Fase 1.
-- Migração ADITIVA e idempotente: não apaga, não reescreve etapas, não cria dados fictícios.
--
-- Executar DEPOIS de (já aplicados em produção):
--   access_control_schema.sql      (data_owner_id)
--   opportunities_schema.sql       (opportunities, opportunity_stage_history)
--   funnel_automation_schema.sql   (as 8 etapas atuais — a constraint NÃO é alterada aqui)
--   whatsapp_ownership_schema.sql  (is_clinic_admin)
--   crm_contacts_schema.sql        (crm_contacts, opportunities.contact_id)
--   tasks_timeline_schema.sql      (tasks, opportunity_notes)
--   operational_workspace_schema.sql (crm_contact_notes)
-- Rodar no Supabase SQL Editor. Pode ser reaplicada sem efeito colateral.
--
-- O que cria:
--   1. Colunas novas em opportunities (procedimento, probabilidade, próxima ação, prazo,
--      data prevista de cirurgia, valores de campos personalizados).
--   2. crm_can_manage_workspace(): admin OU gestão da clínica atual.
--   3. crm_stage_settings: rótulo/cor/ordem/probabilidade por clínica (sem etapas novas).
--   4. crm_custom_fields: definição de colunas personalizadas (arquivar, nunca apagar).
--   5. crm_views: visualizações salvas pessoais e compartilhadas.
--   6. opportunity_field_history: trilha append-only das alterações de campo (trigger).
--   7. crm_last_contact(): último contato DERIVADO (WhatsApp, tarefas concluídas, notas) —
--      nada é armazenado em paralelo; respeita a RLS de quem chama (security invoker).

begin;

-- ---------------------------------------------------------------------------
-- 1. Oportunidades: colunas novas (todas nullable / com default — retrocompatível).
-- ---------------------------------------------------------------------------
alter table public.opportunities
  add column if not exists procedure_id uuid references public.procedures(id) on delete set null;
-- Probabilidade em % (0–100). NULL = usa a probabilidade padrão da etapa (crm_stage_settings
-- ou o padrão do sistema). Só é preenchida quando alguém define explicitamente.
alter table public.opportunities
  add column if not exists probability numeric(5,2);
alter table public.opportunities
  add column if not exists next_action text;
alter table public.opportunities
  add column if not exists next_action_due date;
alter table public.opportunities
  add column if not exists expected_surgery_date date;
-- Valores dos campos personalizados: { "<crm_custom_fields.id>": valor }.
alter table public.opportunities
  add column if not exists custom_values jsonb not null default '{}'::jsonb;

do $$ begin
  begin
    alter table public.opportunities
      add constraint opportunities_probability_range
      check (probability is null or (probability >= 0 and probability <= 100));
  exception when duplicate_object then null; end;
  begin
    alter table public.opportunities
      add constraint opportunities_custom_values_object
      check (jsonb_typeof(custom_values) = 'object');
  exception when duplicate_object then null; end;
end $$;

create index if not exists idx_opportunities_procedure on public.opportunities(procedure_id);
create index if not exists idx_opportunities_next_due
  on public.opportunities(user_id, next_action_due) where next_action_due is not null;

-- ---------------------------------------------------------------------------
-- 2. Quem pode configurar o workspace (campos, etapas, visões compartilhadas):
--    owner da conta, membro admin ou membro gestão DA CLÍNICA ATUAL.
-- ---------------------------------------------------------------------------
create or replace function public.crm_can_manage_workspace()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.clinics where owner_id = auth.uid())
      or exists (
        select 1
        from public.clinic_members cm
        join public.clinics c on c.id = cm.clinic_id
        where cm.user_id = auth.uid()
          and cm.role in ('admin', 'gestao')
          and c.owner_id = public.data_owner_id()
      )
$$;
revoke all on function public.crm_can_manage_workspace() from public, anon;
grant execute on function public.crm_can_manage_workspace() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Configuração das etapas por clínica. As CHAVES continuam as 8 atuais
--    (constraint opportunities_stage_check intocada); aqui só apresentação + probabilidade.
--    Sem linha = padrão do sistema.
-- ---------------------------------------------------------------------------
create table if not exists public.crm_stage_settings (
  user_id     uuid not null references auth.users(id) on delete cascade,  -- dono/clínica
  stage_key   text not null check (stage_key in (
                'primeiro_contato','consulta_agendada','consultado','orcamento_enviado',
                'reserva_paga','cirurgia_marcada','cirurgia_feita','follow_up')),
  label       text check (label is null or length(trim(label)) between 1 and 60),
  color       text check (color is null or color ~ '^#[0-9A-Fa-f]{6}$'),
  position    int,
  probability numeric(5,2) check (probability is null or (probability >= 0 and probability <= 100)),
  updated_by  uuid references auth.users(id) on delete set null default auth.uid(),
  updated_at  timestamptz not null default timezone('utc', now()),
  primary key (user_id, stage_key)
);

alter table public.crm_stage_settings enable row level security;
drop policy if exists "CRM stage settings read" on public.crm_stage_settings;
create policy "CRM stage settings read" on public.crm_stage_settings
  for select to authenticated
  using (user_id = (select public.data_owner_id()));
drop policy if exists "CRM stage settings manage" on public.crm_stage_settings;
create policy "CRM stage settings manage" on public.crm_stage_settings
  for all to authenticated
  using (user_id = (select public.data_owner_id()) and (select public.crm_can_manage_workspace()))
  with check (user_id = (select public.data_owner_id()) and (select public.crm_can_manage_workspace()));

revoke all on public.crm_stage_settings from anon;
grant select, insert, update on public.crm_stage_settings to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Campos personalizados (definição). Valores ficam em opportunities.custom_values.
--    Não há DELETE: campo removido é arquivado (os valores antigos continuam no registro).
-- ---------------------------------------------------------------------------
create table if not exists public.crm_custom_fields (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,  -- dono/clínica
  label       text not null check (length(trim(label)) between 1 and 60),
  field_type  text not null check (field_type in (
                'text','number','currency','date','status','select','multiselect',
                'person','checkbox','percent','link')),
  -- Para status/select/multiselect: [{ "id": "...", "label": "...", "color": "#RRGGBB" }].
  options     jsonb not null default '[]'::jsonb check (jsonb_typeof(options) = 'array'),
  position    int not null default 0,
  width       int check (width is null or width between 60 and 640),
  archived_at timestamptz,
  created_by  uuid references auth.users(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default timezone('utc', now()),
  updated_at  timestamptz not null default timezone('utc', now())
);

create index if not exists idx_crm_custom_fields_owner
  on public.crm_custom_fields(user_id, position) where archived_at is null;

alter table public.crm_custom_fields enable row level security;
drop policy if exists "CRM custom fields read" on public.crm_custom_fields;
create policy "CRM custom fields read" on public.crm_custom_fields
  for select to authenticated
  using (user_id = (select public.data_owner_id()));
drop policy if exists "CRM custom fields insert" on public.crm_custom_fields;
create policy "CRM custom fields insert" on public.crm_custom_fields
  for insert to authenticated
  with check (user_id = (select public.data_owner_id()) and (select public.crm_can_manage_workspace()));
drop policy if exists "CRM custom fields update" on public.crm_custom_fields;
create policy "CRM custom fields update" on public.crm_custom_fields
  for update to authenticated
  using (user_id = (select public.data_owner_id()) and (select public.crm_can_manage_workspace()))
  with check (user_id = (select public.data_owner_id()) and (select public.crm_can_manage_workspace()));

revoke all on public.crm_custom_fields from anon;
revoke delete on public.crm_custom_fields from authenticated;
grant select, insert, update on public.crm_custom_fields to authenticated;

-- Tipo só muda entre tipos compatíveis (o valor salvo continua legível).
create or replace function public.crm_custom_fields_guard()
returns trigger language plpgsql as $$
begin
  if new.user_id is distinct from old.user_id then
    raise exception 'Não é permitido mover o campo para outra clínica';
  end if;
  if new.field_type is distinct from old.field_type and not (
       (old.field_type in ('text','link') and new.field_type in ('text','link'))
    or (old.field_type in ('number','currency','percent') and new.field_type in ('number','currency','percent'))
    or (old.field_type in ('status','select') and new.field_type in ('status','select'))
  ) then
    raise exception 'Tipo de campo incompatível: % → %', old.field_type, new.field_type;
  end if;
  new.updated_at := timezone('utc', now());
  return new;
end $$;

drop trigger if exists trg_crm_custom_fields_guard on public.crm_custom_fields;
create trigger trg_crm_custom_fields_guard
  before update on public.crm_custom_fields
  for each row execute function public.crm_custom_fields_guard();

-- ---------------------------------------------------------------------------
-- 5. Visualizações salvas (colunas, ordem, larguras, filtros, ordenação, agrupamento).
--    personal → só o criador vê/edita. shared → toda a clínica vê; admin/gestão edita.
-- ---------------------------------------------------------------------------
create table if not exists public.crm_views (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,  -- dono/clínica
  owner_id    uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name        text not null check (length(trim(name)) between 1 and 60),
  scope       text not null default 'personal' check (scope in ('personal','shared')),
  view_type   text not null default 'table' check (view_type in ('table','kanban','agenda')),
  config      jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  position    int not null default 0,
  created_at  timestamptz not null default timezone('utc', now()),
  updated_at  timestamptz not null default timezone('utc', now())
);

create index if not exists idx_crm_views_owner on public.crm_views(user_id, scope, position);

alter table public.crm_views enable row level security;
drop policy if exists "CRM views read" on public.crm_views;
create policy "CRM views read" on public.crm_views
  for select to authenticated
  using (
    user_id = (select public.data_owner_id())
    and (scope = 'shared' or owner_id = (select auth.uid()))
  );
drop policy if exists "CRM views write" on public.crm_views;
create policy "CRM views write" on public.crm_views
  for all to authenticated
  using (
    user_id = (select public.data_owner_id())
    and (
      (scope = 'personal' and owner_id = (select auth.uid()))
      or (scope = 'shared' and (select public.crm_can_manage_workspace()))
    )
  )
  with check (
    user_id = (select public.data_owner_id())
    and (
      (scope = 'personal' and owner_id = (select auth.uid()))
      or (scope = 'shared' and (select public.crm_can_manage_workspace()))
    )
  );

revoke all on public.crm_views from anon;
grant select, insert, update, delete on public.crm_views to authenticated;

create or replace function public.crm_views_touch()
returns trigger language plpgsql as $$
begin
  if new.user_id is distinct from old.user_id then
    raise exception 'Não é permitido mover a visualização para outra clínica';
  end if;
  new.updated_at := timezone('utc', now());
  return new;
end $$;

drop trigger if exists trg_crm_views_touch on public.crm_views;
create trigger trg_crm_views_touch
  before update on public.crm_views
  for each row execute function public.crm_views_touch();

-- ---------------------------------------------------------------------------
-- 6. Histórico de alterações de campo da oportunidade (append-only).
--    Etapa continua em opportunity_stage_history (RPC move_opportunity) — não duplicamos.
-- ---------------------------------------------------------------------------
create table if not exists public.opportunity_field_history (
  id             uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  user_id        uuid not null references auth.users(id) on delete cascade,  -- dono/clínica
  field          text not null,
  old_value      jsonb,
  new_value      jsonb,
  changed_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default timezone('utc', now())
);

create index if not exists idx_opp_field_history_opp
  on public.opportunity_field_history(opportunity_id, created_at desc);

alter table public.opportunity_field_history enable row level security;
drop policy if exists "Opportunity field history read" on public.opportunity_field_history;
create policy "Opportunity field history read" on public.opportunity_field_history
  for select to authenticated
  using (user_id = (select public.data_owner_id()));

revoke all on public.opportunity_field_history from anon;
revoke insert, update, delete on public.opportunity_field_history from authenticated;
grant select on public.opportunity_field_history to authenticated;

create or replace function public.opportunity_field_history_capture()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  f text;
  o jsonb := to_jsonb(old);
  n jsonb := to_jsonb(new);
  tracked text[] := array[
    'title','value','source','responsible_user_id','status','lost_reason','tags',
    'procedure_id','probability','next_action','next_action_due','expected_surgery_date'
  ];
  k text;
begin
  foreach f in array tracked loop
    if (o -> f) is distinct from (n -> f) then
      insert into public.opportunity_field_history (opportunity_id, user_id, field, old_value, new_value, changed_by)
      values (new.id, new.user_id, f, o -> f, n -> f, auth.uid());
    end if;
  end loop;
  -- Campos personalizados: uma linha por chave alterada (custom:<field_id>).
  if (o -> 'custom_values') is distinct from (n -> 'custom_values') then
    for k in
      select key from jsonb_object_keys(coalesce(o -> 'custom_values', '{}'::jsonb)) as t(key)
      union
      select key from jsonb_object_keys(coalesce(n -> 'custom_values', '{}'::jsonb)) as t(key)
    loop
      if (o -> 'custom_values' -> k) is distinct from (n -> 'custom_values' -> k) then
        insert into public.opportunity_field_history (opportunity_id, user_id, field, old_value, new_value, changed_by)
        values (new.id, new.user_id, 'custom:' || k, o -> 'custom_values' -> k, n -> 'custom_values' -> k, auth.uid());
      end if;
    end loop;
  end if;
  return new;
end $$;
revoke all on function public.opportunity_field_history_capture() from public, anon, authenticated;

drop trigger if exists trg_opportunity_field_history on public.opportunities;
create trigger trg_opportunity_field_history
  after update on public.opportunities
  for each row execute function public.opportunity_field_history_capture();

-- ---------------------------------------------------------------------------
-- 7. Último contato DERIVADO por oportunidade (nunca armazenado).
--    Fontes: mensagens de WhatsApp do paciente/contato, tarefas concluídas da oportunidade,
--    notas da oportunidade e notas do contato/paciente. SECURITY INVOKER: cada fonte passa
--    pela RLS de quem chama (ex.: equipe só enxerga mensagens dos números dela).
-- ---------------------------------------------------------------------------
create or replace function public.crm_last_contact(p_opportunity_ids uuid[])
returns table(opportunity_id uuid, last_contact_at timestamptz, last_contact_source text)
language sql stable security invoker set search_path = public as $$
  with opp as (
    select o.id, o.patient_id, o.contact_id
    from public.opportunities o
    where o.id = any(p_opportunity_ids)
      and o.user_id = public.data_owner_id()
  ),
  events as (
    select opp.id as opportunity_id, m.created_at as at, 'whatsapp'::text as source
    from opp join public.whatsapp_messages m
      on (opp.patient_id is not null and m.patient_id = opp.patient_id)
      or (opp.contact_id is not null and m.contact_id = opp.contact_id)
    union all
    select t.opportunity_id, t.done_at, 'tarefa'
    from public.tasks t join opp on opp.id = t.opportunity_id
    where t.status = 'feita' and t.done_at is not null
    union all
    select n.opportunity_id, n.created_at, 'nota'
    from public.opportunity_notes n join opp on opp.id = n.opportunity_id
    union all
    select opp.id, cn.created_at, 'nota'
    from opp join public.crm_contact_notes cn
      on cn.opportunity_id = opp.id
      or (opp.contact_id is not null and cn.contact_id = opp.contact_id)
      or (opp.patient_id is not null and cn.patient_id = opp.patient_id)
  )
  select distinct on (e.opportunity_id) e.opportunity_id, e.at, e.source
  from events e
  where e.at is not null
  order by e.opportunity_id, e.at desc
$$;
revoke all on function public.crm_last_contact(uuid[]) from public, anon;
grant execute on function public.crm_last_contact(uuid[]) to authenticated;

commit;

-- Verificação (rodar separado, depois de aplicar):
-- select column_name from information_schema.columns
--   where table_name = 'opportunities'
--     and column_name in ('procedure_id','probability','next_action','next_action_due','expected_surgery_date','custom_values');
--   → 6 linhas
-- select count(*) from public.opportunities where custom_values <> '{}'::jsonb;   → 0 (nada foi preenchido)
-- select public.crm_can_manage_workspace();                                         → true para admin/gestão
-- select * from public.crm_last_contact(array(select id from public.opportunities limit 5));
