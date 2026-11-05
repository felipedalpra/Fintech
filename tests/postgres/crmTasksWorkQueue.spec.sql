-- Executar somente em banco local descartavel e vazio:
--   createdb surgi_tasks_test
--   psql -v ON_ERROR_STOP=1 -d surgi_tasks_test -f tests/postgres/crmTasksWorkQueue.spec.sql
\set ON_ERROR_STOP on

create extension if not exists pgcrypto;
create schema auth;
create table auth.users(id uuid primary key);
insert into auth.users(id) values ('10000000-0000-4000-8000-000000000001');

-- data_owner_id e usada pela policy de task_attempts.
create or replace function public.data_owner_id() returns uuid language sql stable
as $$ select '10000000-0000-4000-8000-000000000001'::uuid $$;

create table public.opportunities(id uuid primary key default gen_random_uuid(), title text);
create table public.patients(id uuid primary key default gen_random_uuid(), full_name text);

-- Recorte fiel de tasks_timeline_schema.sql (estado ANTES da migration).
create table public.tasks (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  opportunity_id   uuid references public.opportunities(id) on delete cascade,
  patient_id       uuid references public.patients(id) on delete set null,
  title            text not null,
  due_date         date,
  status           text not null default 'pendente' check (status in ('pendente','feita')),
  assigned_user_id uuid references auth.users(id) on delete set null,
  created_by       uuid references auth.users(id) on delete set null,
  done_at          timestamptz,
  created_at       timestamptz not null default timezone('utc', now()),
  updated_at       timestamptz not null default timezone('utc', now())
);

-- Tarefas que JA existiam antes da migration.
insert into public.tasks(user_id, title, due_date, status, done_at) values
  ('10000000-0000-4000-8000-000000000001', 'Ligar para paciente antigo', '2026-10-01', 'pendente', null),
  ('10000000-0000-4000-8000-000000000001', 'Tarefa ja concluida', '2026-09-01', 'feita', now());

\ir ../../supabase/crm_tasks_work_queue.sql
-- Idempotencia: reaplicar nao pode falhar nem duplicar constraint.
\ir ../../supabase/crm_tasks_work_queue.sql

-- ---------------------------------------------------------------------------
-- 1. Nenhum dado existente foi perdido ou reescrito.
-- ---------------------------------------------------------------------------
do $$
begin
  if (select count(*) from public.tasks) <> 2 then
    raise exception 'A migration mexeu na quantidade de tarefas.';
  end if;
  if not exists (select 1 from public.tasks where title = 'Ligar para paciente antigo' and due_date = '2026-10-01' and status = 'pendente') then
    raise exception 'Tarefa existente foi alterada pela migration.';
  end if;
  if (select count(*) from public.tasks where task_type = 'outro') <> 2 then
    raise exception 'Tarefas antigas nao receberam o tipo padrao.';
  end if;
  if (select count(*) from public.tasks where outcome is not null) <> 0 then
    raise exception 'A migration inventou desfecho para tarefa antiga.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Tipo e desfecho sao fechados: valor invalido e recusado pelo banco.
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    insert into public.tasks(user_id, title, task_type) values ('10000000-0000-4000-8000-000000000001', 'x', 'telepatia');
    raise exception 'Tipo invalido foi aceito.';
  exception when check_violation then null; end;
  begin
    insert into public.tasks(user_id, title, status, outcome) values ('10000000-0000-4000-8000-000000000001', 'x', 'feita', 'talvez');
    raise exception 'Desfecho invalido foi aceito.';
  exception when check_violation then null; end;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Desfecho so existe em tarefa encerrada.
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    insert into public.tasks(user_id, title, status, outcome)
    values ('10000000-0000-4000-8000-000000000001', 'pendente com desfecho', 'pendente', 'atendeu');
    raise exception 'Tarefa pendente aceitou desfecho.';
  exception when check_violation then null; end;

  insert into public.tasks(user_id, title, status, outcome, outcome_at, task_type, due_time)
  values ('10000000-0000-4000-8000-000000000001', 'ok', 'feita', 'nao_atendeu', now(), 'ligar', '09:30');
  if not exists (select 1 from public.tasks where title = 'ok' and task_type = 'ligar' and due_time = '09:30' and outcome = 'nao_atendeu') then
    raise exception 'Tarefa rica nao persistiu os campos novos.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Tentativas: a tarefa continua pendente enquanto o desfecho nao encerra.
-- ---------------------------------------------------------------------------
do $$
declare v_task uuid;
begin
  insert into public.tasks(user_id, title, task_type, due_date)
  values ('10000000-0000-4000-8000-000000000001', 'Ligar 3x', 'ligar', '2026-11-05')
  returning id into v_task;

  insert into public.task_attempts(user_id, task_id, outcome, notes) values
    ('10000000-0000-4000-8000-000000000001', v_task, 'nao_atendeu', 'caixa postal'),
    ('10000000-0000-4000-8000-000000000001', v_task, 'nao_atendeu', 'nao atendeu de novo');

  if (select count(*) from public.task_attempts where task_id = v_task) <> 2 then
    raise exception 'As tentativas nao foram registradas.';
  end if;
  if (select status from public.tasks where id = v_task) <> 'pendente' then
    raise exception 'Tentativa sem desfecho encerrador fechou a tarefa.';
  end if;

  -- Desfecho que encerra: ai sim a tarefa fecha e guarda o desfecho final.
  insert into public.task_attempts(user_id, task_id, outcome) values ('10000000-0000-4000-8000-000000000001', v_task, 'atendeu');
  update public.tasks set status = 'feita', outcome = 'atendeu', outcome_at = now(), done_at = now() where id = v_task;

  if (select count(*) from public.task_attempts where task_id = v_task) <> 3 then
    raise exception 'O historico de tentativas foi perdido ao encerrar.';
  end if;
  if not exists (select 1 from public.tasks where id = v_task and status = 'feita' and outcome = 'atendeu') then
    raise exception 'O desfecho final nao persistiu.';
  end if;

  begin
    insert into public.task_attempts(user_id, task_id, outcome) values ('10000000-0000-4000-8000-000000000001', v_task, 'talvez');
    raise exception 'Desfecho invalido foi aceito na tentativa.';
  exception when check_violation then null; end;
end $$;

select 'crmTasksWorkQueue: OK' as resultado;
