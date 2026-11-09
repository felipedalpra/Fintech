-- tasks_workspace_phase4.sql
-- Tarefas — reformulação estilo Monday (Fase 4).
-- Migração ADITIVA e idempotente: não apaga, não reescreve tarefas, não muda os status existentes.
--
-- Executar DEPOIS de (a migração confere e para com mensagem clara se faltar algo):
--   tasks_timeline_schema.sql     (tasks)
--   crm_tasks_work_queue.sql      (tasks.task_type / outcome / outcome_at / outcome_by)
--   crm_workspace_phase1.sql      (crm_can_manage_workspace)
--   crm_workspace_phase2.sql      (tasks.status aceita 'aguardando')
-- Rodar no Supabase SQL Editor. Pode ser reaplicada sem efeito colateral.
--
-- Por que colunas configuráveis NÃO mudam tasks.status:
--   Sino, Meu Dia, subitens do CRM, último contato, esteiras de cuidado e índices usam
--   pendente / aguardando / feita. Cada coluna do Kanban (task_stages) aponta para um desses
--   status ("Em andamento" é uma coluna de status 'pendente'). Mover o card troca a coluna e o
--   banco ajusta o status; mudar o status por outra tela tira a tarefa de uma coluna incompatível.
--   Tarefa sem coluna aparece na coluna padrão do seu status — nada precisa ser migrado.
--
-- O que cria:
--   1. task_stages: colunas do Kanban por clínica (nome, cor, ordem, status base). Sem DELETE.
--   2. tasks: stage_id, priority, description, board_position (todas opcionais).
--   3. Trigger de sincronia coluna ↔ status.
--   4. task_move(): mover/reordenar cards numa chamada.
--   5. task_checklist_items: subtarefas (checklist) da tarefa.
--   6. task_comments: comentários com resposta e @menção (Realtime).
--   7. task_history: histórico append-only das alterações da tarefa.
--   8. task_ensure_default_stages(): cria A fazer / Em andamento / Aguardando / Concluída.

begin;

-- ---------------------------------------------------------------------------
-- 0. Pré-requisitos (falha cedo, dentro da transação: nada é aplicado).
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'tasks' and column_name = 'outcome_at') then
    raise exception 'Aplique crm_tasks_work_queue.sql antes desta migração';
  end if;
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.tasks'::regclass and contype = 'c'
                   and pg_get_constraintdef(oid) ilike '%aguardando%') then
    raise exception 'Aplique crm_workspace_phase2.sql antes desta migração';
  end if;
  if to_regprocedure('public.crm_can_manage_workspace()') is null then
    raise exception 'Aplique crm_workspace_phase1.sql antes desta migração';
  end if;
end $$;

-- Pessoa da equipe da clínica (mesma definição de crm_workspace_phase3.sql; repetida para esta
-- migração não depender da ordem). Uso interno, não exposta.
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
revoke all on function public.crm_is_clinic_person(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. Colunas do Kanban de tarefas.
-- ---------------------------------------------------------------------------
create table if not exists public.task_stages (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,  -- dono/clínica
  label       text not null check (length(trim(label)) between 1 and 40),
  color       text not null default '#64748b' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  base_status text not null check (base_status in ('pendente', 'aguardando', 'feita')),
  position    int not null default 0,
  -- Coluna onde aparece a tarefa sem coluna própria (uma por status base). Não pode ser arquivada.
  is_default  boolean not null default false,
  seed_key    text,   -- colunas iniciais: todo / doing / waiting / done
  archived_at timestamptz,
  created_by  uuid references auth.users(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default timezone('utc', now()),
  updated_at  timestamptz not null default timezone('utc', now())
);

create unique index if not exists uq_task_stages_seed on public.task_stages(user_id, seed_key) where seed_key is not null;
create unique index if not exists uq_task_stages_default on public.task_stages(user_id, base_status) where is_default;
create index if not exists idx_task_stages_owner on public.task_stages(user_id, position) where archived_at is null;

alter table public.task_stages enable row level security;
drop policy if exists "Task stages read" on public.task_stages;
create policy "Task stages read" on public.task_stages
  for select to authenticated
  using (user_id = (select public.data_owner_id()));
drop policy if exists "Task stages insert" on public.task_stages;
create policy "Task stages insert" on public.task_stages
  for insert to authenticated
  with check (user_id = (select public.data_owner_id()) and (select public.crm_can_manage_workspace()) and not is_default);
drop policy if exists "Task stages update" on public.task_stages;
create policy "Task stages update" on public.task_stages
  for update to authenticated
  using (user_id = (select public.data_owner_id()) and (select public.crm_can_manage_workspace()))
  with check (user_id = (select public.data_owner_id()) and (select public.crm_can_manage_workspace()));

revoke all on public.task_stages from anon;
revoke delete on public.task_stages from authenticated;
grant select, insert, update on public.task_stages to authenticated;

create or replace function public.task_stages_guard()
returns trigger language plpgsql as $$
begin
  if new.user_id is distinct from old.user_id then
    raise exception 'Não é permitido mover a coluna para outra clínica';
  end if;
  if new.base_status is distinct from old.base_status then
    raise exception 'O status base da coluna não muda (as tarefas dela ficariam inconsistentes)';
  end if;
  if new.is_default is distinct from old.is_default then
    raise exception 'Não é permitido trocar a coluna padrão';
  end if;
  if old.is_default and new.archived_at is not null then
    raise exception 'A coluna padrão do status não pode ser removida';
  end if;
  new.updated_at := timezone('utc', now());
  return new;
end $$;

drop trigger if exists trg_task_stages_guard on public.task_stages;
create trigger trg_task_stages_guard
  before update on public.task_stages
  for each row execute function public.task_stages_guard();

-- ---------------------------------------------------------------------------
-- 2. Tarefas: campos novos (todos opcionais — tarefas existentes ficam como estão).
-- ---------------------------------------------------------------------------
alter table public.tasks add column if not exists stage_id uuid references public.task_stages(id) on delete set null;
alter table public.tasks add column if not exists priority text;
alter table public.tasks add column if not exists description text;
alter table public.tasks add column if not exists board_position double precision;

do $$ begin
  begin
    alter table public.tasks add constraint tasks_priority_check
      check (priority is null or priority in ('urgente', 'alta', 'media', 'baixa'));
  exception when duplicate_object then null; end;
  begin
    alter table public.tasks add constraint tasks_description_length
      check (description is null or length(description) <= 5000);
  exception when duplicate_object then null; end;
end $$;

create index if not exists idx_tasks_stage on public.tasks(stage_id) where stage_id is not null;

-- ---------------------------------------------------------------------------
-- 3. Sincronia coluna ↔ status.
--    - Coluna escolhida → status passa a ser o status base dela (e conclusão/desfecho seguem a
--      mesma regra de updateTask: sair de 'feita' limpa done_at e desfecho).
--    - Status mudado por outra tela (CRM, Meu Dia, desfecho) → se a coluna atual não combina,
--      a tarefa volta para a coluna padrão do novo status (stage_id nulo).
-- ---------------------------------------------------------------------------
create or replace function public.tasks_stage_sync()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_stage public.task_stages%rowtype;
begin
  if new.stage_id is not null and (tg_op = 'INSERT' or new.stage_id is distinct from old.stage_id) then
    select * into v_stage from public.task_stages where id = new.stage_id;
    if not found or v_stage.user_id <> new.user_id or v_stage.archived_at is not null then
      raise exception 'Coluna de tarefas não encontrada nesta clínica';
    end if;
    if tg_op = 'INSERT' or new.status is distinct from v_stage.base_status or old.status is distinct from v_stage.base_status then
      new.status := v_stage.base_status;
      if v_stage.base_status = 'feita' then
        if tg_op = 'INSERT' or old.status <> 'feita' then
          new.done_at := coalesce(new.done_at, timezone('utc', now()));
        end if;
      else
        new.done_at := null;
        new.outcome := null;
        new.outcome_at := null;
        new.outcome_by := null;
      end if;
    end if;
  elsif tg_op = 'UPDATE' and new.stage_id is not null and new.status is distinct from old.status then
    if (select base_status from public.task_stages where id = new.stage_id) is distinct from new.status then
      new.stage_id := null;
    end if;
  end if;
  return new;
end $$;
revoke all on function public.tasks_stage_sync() from public, anon, authenticated;

drop trigger if exists trg_tasks_stage_sync on public.tasks;
create trigger trg_tasks_stage_sync
  before insert or update on public.tasks
  for each row execute function public.tasks_stage_sync();

-- ---------------------------------------------------------------------------
-- 4. Mover / reordenar no Kanban numa única chamada (RLS de quem chama vale).
--    p_stage_id nulo = só reordenar. p_ordered_ids = ordem final dos cards da coluna de destino.
-- ---------------------------------------------------------------------------
create or replace function public.task_move(p_task_id uuid, p_stage_id uuid, p_ordered_ids uuid[])
returns int language plpgsql security invoker set search_path = public as $$
declare
  v_owner uuid := public.data_owner_id();
  n int;
begin
  if v_owner is null then raise exception 'Sem clínica'; end if;
  if p_stage_id is not null then
    update public.tasks set stage_id = p_stage_id, updated_at = timezone('utc', now())
    where id = p_task_id and user_id = v_owner;
    if not found then raise exception 'Tarefa não encontrada'; end if;
  end if;
  update public.tasks t set board_position = o.ord * 1024
  from unnest(coalesce(p_ordered_ids, '{}'::uuid[])) with ordinality as o(id, ord)
  where t.id = o.id and t.user_id = v_owner;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.task_move(uuid, uuid, uuid[]) from public, anon;
grant execute on function public.task_move(uuid, uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Subtarefas (checklist). Somem junto com a tarefa.
-- ---------------------------------------------------------------------------
create table if not exists public.task_checklist_items (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  task_id    uuid not null references public.tasks(id) on delete cascade,
  title      text not null check (length(trim(title)) between 1 and 300),
  done       boolean not null default false,
  position   int not null default 0,
  done_at    timestamptz,
  done_by    uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now())
);
create index if not exists idx_task_checklist_task on public.task_checklist_items(task_id, position);
create index if not exists idx_task_checklist_owner on public.task_checklist_items(user_id);

alter table public.task_checklist_items enable row level security;
drop policy if exists "Task checklist clinic access" on public.task_checklist_items;
create policy "Task checklist clinic access" on public.task_checklist_items
  for all to authenticated
  using (user_id = (select public.data_owner_id()))
  with check (
    user_id = (select public.data_owner_id())
    and exists (select 1 from public.tasks t where t.id = task_checklist_items.task_id and t.user_id = task_checklist_items.user_id)
  );
revoke all on public.task_checklist_items from anon;
grant select, insert, update, delete on public.task_checklist_items to authenticated;

create or replace function public.task_checklist_guard()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and (new.task_id is distinct from old.task_id or new.user_id is distinct from old.user_id) then
    raise exception 'Não é permitido mover a subtarefa para outra tarefa';
  end if;
  if new.done and (tg_op = 'INSERT' or not old.done) then
    new.done_at := timezone('utc', now());
    new.done_by := auth.uid();
  elsif not new.done then
    new.done_at := null;
    new.done_by := null;
  end if;
  return new;
end $$;
drop trigger if exists trg_task_checklist_guard on public.task_checklist_items;
create trigger trg_task_checklist_guard
  before insert or update on public.task_checklist_items
  for each row execute function public.task_checklist_guard();

-- ---------------------------------------------------------------------------
-- 6. Comentários da tarefa (mesmo modelo das Atualizações da oportunidade).
--    Sem UPDATE/DELETE: comentário registrado não muda.
-- ---------------------------------------------------------------------------
create table if not exists public.task_comments (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  task_id    uuid not null references public.tasks(id) on delete cascade,
  parent_id  uuid references public.task_comments(id) on delete cascade,
  body       text not null check (length(trim(body)) between 1 and 5000),
  author_id  uuid references auth.users(id) on delete set null default auth.uid(),
  mentions   uuid[] not null default '{}'::uuid[],
  created_at timestamptz not null default timezone('utc', now())
);
create index if not exists idx_task_comments_task on public.task_comments(task_id, created_at);
create index if not exists idx_task_comments_mentions on public.task_comments using gin (mentions);
create index if not exists idx_task_comments_owner_created on public.task_comments(user_id, created_at desc);

alter table public.task_comments enable row level security;
drop policy if exists "Task comments read" on public.task_comments;
create policy "Task comments read" on public.task_comments
  for select to authenticated
  using (user_id = (select public.data_owner_id()));
drop policy if exists "Task comments insert" on public.task_comments;
create policy "Task comments insert" on public.task_comments
  for insert to authenticated
  with check (user_id = (select public.data_owner_id()));
revoke all on public.task_comments from anon;
revoke update, delete on public.task_comments from authenticated;
grant select, insert on public.task_comments to authenticated;

create or replace function public.task_comments_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_parent public.task_comments%rowtype;
begin
  if auth.uid() is not null then
    new.author_id := auth.uid();
  end if;
  if not exists (select 1 from public.tasks t where t.id = new.task_id and t.user_id = new.user_id) then
    raise exception 'Tarefa não encontrada nesta clínica';
  end if;
  if new.parent_id is not null then
    select * into v_parent from public.task_comments where id = new.parent_id;
    if not found or v_parent.task_id <> new.task_id or v_parent.user_id <> new.user_id then
      raise exception 'Comentário original não encontrado nesta tarefa';
    end if;
    new.parent_id := coalesce(v_parent.parent_id, v_parent.id);
  end if;
  select coalesce(array_agg(distinct m), '{}'::uuid[]) into new.mentions
  from unnest(coalesce(new.mentions, '{}'::uuid[])) as m
  where public.crm_is_clinic_person(new.user_id, m);
  return new;
end $$;
revoke all on function public.task_comments_guard() from public, anon, authenticated;
drop trigger if exists trg_task_comments_guard on public.task_comments;
create trigger trg_task_comments_guard
  before insert on public.task_comments
  for each row execute function public.task_comments_guard();

do $$
begin
  begin
    execute 'alter publication supabase_realtime add table public.task_comments';
  exception
    when duplicate_object then null;
    when undefined_object then null;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Histórico da tarefa (append-only, gravado por trigger com o autor).
-- ---------------------------------------------------------------------------
create table if not exists public.task_history (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references public.tasks(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  field      text not null,
  old_value  jsonb,
  new_value  jsonb,
  changed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now())
);
create index if not exists idx_task_history_task on public.task_history(task_id, created_at desc);

alter table public.task_history enable row level security;
drop policy if exists "Task history read" on public.task_history;
create policy "Task history read" on public.task_history
  for select to authenticated
  using (user_id = (select public.data_owner_id()));
revoke all on public.task_history from anon;
revoke insert, update, delete on public.task_history from authenticated;
grant select on public.task_history to authenticated;

create or replace function public.task_history_capture()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  f text;
  o jsonb;
  n jsonb := to_jsonb(new);
  tracked text[] := array[
    'title','description','status','stage_id','priority','assigned_user_id',
    'due_date','due_time','task_type','outcome'
  ];
begin
  if tg_op = 'INSERT' then
    insert into public.task_history (task_id, user_id, field, old_value, new_value, changed_by)
    values (new.id, new.user_id, 'created', null, to_jsonb(new.title), auth.uid());
    return new;
  end if;
  o := to_jsonb(old);
  foreach f in array tracked loop
    if (o -> f) is distinct from (n -> f) then
      insert into public.task_history (task_id, user_id, field, old_value, new_value, changed_by)
      values (new.id, new.user_id, f, o -> f, n -> f, auth.uid());
    end if;
  end loop;
  return new;
end $$;
revoke all on function public.task_history_capture() from public, anon, authenticated;

drop trigger if exists trg_task_history on public.tasks;
create trigger trg_task_history
  after insert or update on public.tasks
  for each row execute function public.task_history_capture();

-- ---------------------------------------------------------------------------
-- 8. Colunas iniciais (uma vez por clínica; as padrão não podem ser removidas).
-- ---------------------------------------------------------------------------
create or replace function public.task_ensure_default_stages()
returns int language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := public.data_owner_id();
  v_count int;
begin
  if v_owner is null or auth.uid() is null then
    return 0;
  end if;
  insert into public.task_stages (user_id, label, color, base_status, position, is_default, seed_key, created_by)
  values
    (v_owner, 'A fazer',      '#579bfc', 'pendente',   1, true,  'todo',    v_owner),
    (v_owner, 'Em andamento', '#fdab3d', 'pendente',   2, false, 'doing',   v_owner),
    (v_owner, 'Aguardando',   '#a25ddc', 'aguardando', 3, true,  'waiting', v_owner),
    (v_owner, 'Concluída',    '#00c875', 'feita',      4, true,  'done',    v_owner)
  on conflict (user_id, seed_key) where seed_key is not null do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end $$;
revoke all on function public.task_ensure_default_stages() from public, anon;
grant execute on function public.task_ensure_default_stages() to authenticated;

commit;

-- Verificação (rodar separado, depois de aplicar):
-- select column_name from information_schema.columns
--   where table_name = 'tasks' and column_name in ('stage_id','priority','description','board_position');  → 4 linhas
-- select status, count(*) from public.tasks group by status;      → igual a antes (nenhum status mudou)
-- select count(*) from public.tasks where stage_id is not null;   → 0 (nada foi movido)
-- As 4 colunas iniciais aparecem no primeiro acesso à página Tarefas depois do deploy.
