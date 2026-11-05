-- Esteiras de acompanhamento configuraveis pela clinica (pre e pos-operatorio).
-- Executar depois de crm_tasks_work_queue.sql.
--
-- A clinica monta as proprias trilhas: cada passo e um deslocamento em dias em relacao a data da
-- cirurgia (negativo = antes). Nada e fixo no codigo -- o protocolo de pos-operatorio muda por
-- procedimento e por cirurgiao, e engessar isso tornaria a feature inutil.
--
-- TRES GARANTIAS DE FIDEDIGNIDADE:
-- 1. IDEMPOTENTE: `care_track_runs` tem chave unica (passo, cirurgia). A mesma condicao nunca
--    gera duas tarefas, por mais vezes que o autosave regrave a cirurgia.
-- 2. NAO RETROATIVO: passo cujo vencimento cairia mais de 7 dias no passado NAO e criado.
--    Sem isso, tocar numa cirurgia antiga despejaria dezenas de tarefas vencidas na fila.
-- 3. NUNCA APAGA: mudanca de data REAGENDA a tarefa pendente gerada; tarefa ja concluida e
--    tarefa editada a mao nao sao tocadas. Nenhum caminho aqui faz DELETE em tarefa.

begin;

create table if not exists public.care_tracks (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  name         text not null check (length(btrim(name)) between 1 and 120),
  anchor       text not null default 'surgery' check (anchor in ('surgery')),
  procedure_id uuid references public.procedures(id) on delete set null,
  active       boolean not null default true,
  created_at   timestamptz not null default timezone('utc', now()),
  created_by   uuid references auth.users(id) on delete set null
);

create table if not exists public.care_track_steps (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  track_id         uuid not null references public.care_tracks(id) on delete cascade,
  offset_days      integer not null,
  title            text not null check (length(btrim(title)) between 1 and 200),
  task_type        text not null default 'pos_op'
                     check (task_type in ('ligar','whatsapp','retorno','orcamento','exames','documento','pos_op','outro')),
  assigned_user_id uuid references auth.users(id) on delete set null,
  active           boolean not null default true,
  sort_order       integer not null default 0,
  created_at       timestamptz not null default timezone('utc', now())
);

-- O vinculo que garante a idempotencia. Guarda qual passo gerou qual tarefa para qual cirurgia.
create table if not exists public.care_track_runs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  step_id     uuid not null references public.care_track_steps(id) on delete cascade,
  anchor_type text not null default 'surgery' check (anchor_type in ('surgery')),
  anchor_id   uuid not null,
  task_id     uuid not null references public.tasks(id) on delete cascade,
  created_at  timestamptz not null default timezone('utc', now()),
  unique (user_id, step_id, anchor_type, anchor_id)
);

create index if not exists idx_care_track_steps_track on public.care_track_steps(track_id, sort_order);
create index if not exists idx_care_track_runs_anchor on public.care_track_runs(user_id, anchor_type, anchor_id);

alter table public.care_tracks enable row level security;
alter table public.care_track_steps enable row level security;
alter table public.care_track_runs enable row level security;

do $$ begin
  begin
    create policy "Care tracks clinic access" on public.care_tracks for all to authenticated
      using (user_id = (select public.data_owner_id())) with check (user_id = (select public.data_owner_id()));
  exception when duplicate_object then null; end;
  begin
    create policy "Care track steps clinic access" on public.care_track_steps for all to authenticated
      using (user_id = (select public.data_owner_id())) with check (user_id = (select public.data_owner_id()));
  exception when duplicate_object then null; end;
  begin
    -- Somente leitura pelo cliente: as execucoes sao escritas pelo trigger (security definer).
    create policy "Care track runs clinic read" on public.care_track_runs for select to authenticated
      using (user_id = (select public.data_owner_id()));
  exception when duplicate_object then null; end;
end $$;

revoke all on table public.care_tracks, public.care_track_steps, public.care_track_runs from public, anon;
grant select, insert, update, delete on table public.care_tracks, public.care_track_steps to authenticated;
grant select on table public.care_track_runs to authenticated;

-- Materializa as tarefas de uma cirurgia. Chamada pelo trigger e reutilizavel manualmente.
create or replace function public.apply_care_tracks_for_surgery(p_surgery_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_surgery public.surgeries%rowtype;
  v_step record;
  v_due date;
  v_task uuid;
  v_created integer := 0;
begin
  select * into v_surgery from public.surgeries where id = p_surgery_id;
  if not found or v_surgery.date is null then return 0; end if;

  for v_step in
    select s.*, t.procedure_id as track_procedure
    from public.care_track_steps s
    join public.care_tracks t on t.id = s.track_id
    where t.user_id = v_surgery.user_id
      and t.active and s.active
      and t.anchor = 'surgery'
      -- Trilha sem procedimento vale para todas; com procedimento, so para o dela.
      and (t.procedure_id is null or t.procedure_id = v_surgery.procedure_id)
    order by s.sort_order, s.offset_days
  loop
    v_due := v_surgery.date + v_step.offset_days;

    -- NAO RETROATIVO: passo muito no passado nao entra na fila.
    if v_due < current_date - 7 then continue; end if;

    -- Ja existe execucao deste passo para esta cirurgia? Entao so reagenda se fizer sentido.
    select r.task_id into v_task
    from public.care_track_runs r
    where r.user_id = v_surgery.user_id and r.step_id = v_step.id
      and r.anchor_type = 'surgery' and r.anchor_id = v_surgery.id;

    if found then
      -- A data da cirurgia mudou: acompanha, mas SO em tarefa ainda pendente. Tarefa concluida
      -- e historico e nao se reescreve.
      update public.tasks
      set due_date = v_due, updated_at = timezone('utc', now())
      where id = v_task and status = 'pendente' and due_date is distinct from v_due;
      continue;
    end if;

    insert into public.tasks (user_id, patient_id, title, due_date, task_type, assigned_user_id, status)
    values (
      v_surgery.user_id, v_surgery.patient_id,
      v_step.title || ' · ' || coalesce(nullif(btrim(v_surgery.patient), ''), 'Paciente'),
      v_due, v_step.task_type, v_step.assigned_user_id, 'pendente'
    )
    returning id into v_task;

    insert into public.care_track_runs (user_id, step_id, anchor_type, anchor_id, task_id)
    values (v_surgery.user_id, v_step.id, 'surgery', v_surgery.id, v_task)
    -- Corrida entre dois saves simultaneos: a segunda insercao perde e a tarefa extra e removida.
    on conflict (user_id, step_id, anchor_type, anchor_id) do nothing;

    if not found then
      delete from public.tasks where id = v_task;
    else
      v_created := v_created + 1;
    end if;
  end loop;

  return v_created;
end
$$;

revoke all on function public.apply_care_tracks_for_surgery(uuid) from public, anon;
grant execute on function public.apply_care_tracks_for_surgery(uuid) to authenticated;

create or replace function public.trg_apply_care_tracks()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.apply_care_tracks_for_surgery(new.id);
  return new;
end
$$;

drop trigger if exists trg_surgeries_care_tracks on public.surgeries;
create trigger trg_surgeries_care_tracks
after insert or update of date, patient_id, procedure_id on public.surgeries
for each row execute function public.trg_apply_care_tracks();

comment on table public.care_tracks is 'Esteiras de acompanhamento definidas pela clinica. Nada e fixo no codigo.';
comment on table public.care_track_runs is 'Vinculo passo x cirurgia x tarefa. E o que torna a geracao idempotente.';

commit;

-- Conferencia apos aplicar:
-- select count(*) from public.care_tracks;        -- 0 ate a clinica criar a primeira
-- select tgname from pg_trigger where tgname = 'trg_surgeries_care_tracks';
