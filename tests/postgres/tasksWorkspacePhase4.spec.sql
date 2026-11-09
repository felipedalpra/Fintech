-- Executar somente em banco local descartavel e vazio:
--   createdb surgi_tasks_workspace4_test
--   psql -v ON_ERROR_STOP=1 -d surgi_tasks_workspace4_test -f tests/postgres/tasksWorkspacePhase4.spec.sql
\set ON_ERROR_STOP on

create extension if not exists pgcrypto;
create schema auth;
create table auth.users(id uuid primary key);
-- Clinica A: owner A (admin), equipe E. Clinica B: owner B.
insert into auth.users(id) values
  ('a0000000-0000-4000-8000-000000000001'),
  ('a0000000-0000-4000-8000-0000000000e1'),
  ('b0000000-0000-4000-8000-000000000001');
create or replace function auth.uid() returns uuid language sql stable
as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;

create table public.clinics(id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id));
create table public.clinic_members(
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id),
  user_id uuid not null references auth.users(id),
  role text not null
);
insert into public.clinics(id, owner_id) values
  ('c0000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-000000000001'),
  ('c0000000-0000-4000-8000-00000000000b', 'b0000000-0000-4000-8000-000000000001');
insert into public.clinic_members(clinic_id, user_id, role) values
  ('c0000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-0000000000e1', 'equipe');

create or replace function public.data_owner_id() returns uuid language sql stable security definer as $$
  select coalesce(
    (select owner_id from public.clinics where owner_id = auth.uid() limit 1),
    (select c.owner_id from public.clinic_members cm join public.clinics c on c.id = cm.clinic_id
      where cm.user_id = auth.uid() limit 1))
$$;
-- Mesmo criterio de crm_workspace_phase1.sql.
create or replace function public.crm_can_manage_workspace() returns boolean language sql stable security definer as $$
  select exists (select 1 from public.clinics where owner_id = auth.uid())
      or exists (select 1 from public.clinic_members cm join public.clinics c on c.id = cm.clinic_id
                 where cm.user_id = auth.uid() and cm.role in ('admin','gestao') and c.owner_id = public.data_owner_id())
$$;

-- Espelha tasks reais (timeline + work_queue + phase2).
create table public.tasks(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  opportunity_id uuid, patient_id uuid,
  title text not null default 't',
  due_date date, due_time time,
  status text not null default 'pendente',
  task_type text not null default 'outro',
  assigned_user_id uuid, created_by uuid,
  outcome text, outcome_notes text, outcome_at timestamptz, outcome_by uuid,
  done_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.tasks add constraint tasks_status_check check (status in ('pendente','aguardando','feita'));
alter table public.tasks add constraint tasks_outcome_requires_done check (outcome is null or status = 'feita');

do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
grant usage on schema public, auth to authenticated;
grant execute on function auth.uid() to authenticated;
grant select, insert, update, delete on public.tasks to authenticated;
alter table public.tasks enable row level security;
create policy "Tasks clinic access" on public.tasks for all to authenticated
  using (user_id = public.data_owner_id()) with check (user_id = public.data_owner_id());

-- Tarefas existentes antes da migration (uma concluida com desfecho).
insert into public.tasks(id, user_id, title, status, done_at, outcome) values
  ('10000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'Ligar Ana', 'pendente', null, null),
  ('10000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'Enviar orcamento', 'feita', '2026-11-01T10:00:00Z', 'atendeu'),
  ('10000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000001', 'Tarefa B', 'pendente', null, null);

\ir ../../supabase/tasks_workspace_phase4.sql
-- Reaplicar a migration nao pode falhar nem duplicar objeto.
\ir ../../supabase/tasks_workspace_phase4.sql

-- 1. Nada existente mudou.
do $$ begin
  if (select count(*) from public.tasks where stage_id is not null or priority is not null or description is not null or board_position is not null) <> 0 then
    raise exception 'Migration preencheu campos novos';
  end if;
  if (select status || coalesce(outcome, '') from public.tasks where id = '10000000-0000-4000-8000-000000000002') <> 'feitaatendeu' then
    raise exception 'Tarefa concluida alterada';
  end if;
  if (select count(*) from public.task_history) <> 0 then raise exception 'Historico inventado'; end if;
  if (select count(*) from pg_constraint where conrelid = 'public.tasks'::regclass and conname = 'tasks_priority_check') <> 1 then
    raise exception 'Check de prioridade duplicado ou ausente';
  end if;
end $$;

-- 2. Colunas iniciais: equipe dispara a criacao (uma vez), com as 3 padrao.
set test.uid = 'a0000000-0000-4000-8000-0000000000e1';
set role authenticated;
do $$ begin
  if public.task_ensure_default_stages() <> 4 then raise exception 'Deveria criar 4 colunas'; end if;
  if public.task_ensure_default_stages() <> 0 then raise exception 'Reexecutar criou colunas'; end if;
  if (select count(*) from public.task_stages where is_default) <> 3 then raise exception 'Padrao por status incorreto'; end if;
  if (select string_agg(label, ',' order by position) from public.task_stages) <> 'A fazer,Em andamento,Aguardando,Concluída' then
    raise exception 'Colunas iniciais erradas';
  end if;
end $$;

-- 3. Equipe NAO configura colunas; gestao/dono sim.
do $$ begin
  begin
    insert into public.task_stages(user_id, label, base_status) values ('a0000000-0000-4000-8000-000000000001', 'Revisao', 'pendente');
    raise exception 'Equipe criou coluna';
  exception when insufficient_privilege then null; end;
  update public.task_stages set label = 'X' where seed_key = 'todo';
  if (select label from public.task_stages where seed_key = 'todo') <> 'A fazer' then raise exception 'Equipe renomeou coluna'; end if;
end $$;
reset role;
set test.uid = 'a0000000-0000-4000-8000-000000000001';
set role authenticated;
do $$
declare v uuid;
begin
  insert into public.task_stages(user_id, label, color, base_status, position)
  values ('a0000000-0000-4000-8000-000000000001', 'Revisao medica', '#ff0000', 'pendente', 5) returning id into v;
  update public.task_stages set label = 'Revisão médica', color = '#00ff00', position = 0 where id = v;
  begin
    update public.task_stages set base_status = 'feita' where id = v;
    raise exception 'Status base alterado';
  exception when raise_exception then if sqlerrm not like 'O status base%' then raise; end if; end;
  begin
    update public.task_stages set archived_at = now() where seed_key = 'done';
    raise exception 'Coluna padrao arquivada';
  exception when raise_exception then if sqlerrm not like 'A coluna padrão%' then raise; end if; end;
  begin
    insert into public.task_stages(user_id, label, base_status, is_default) values ('a0000000-0000-4000-8000-000000000001', 'Outra', 'feita', true);
    raise exception 'Criou coluna padrao';
  exception when insufficient_privilege then null; end;
  begin
    delete from public.task_stages where id = v;
    raise exception 'Coluna apagada';
  exception when insufficient_privilege then null; end;
end $$;

-- 4. Mover para coluna muda o status; sair de concluida limpa conclusao/desfecho.
do $$
declare s_doing uuid; s_done uuid; s_todo uuid; t public.tasks;
begin
  select id into s_doing from public.task_stages where seed_key = 'doing';
  select id into s_done from public.task_stages where seed_key = 'done';
  select id into s_todo from public.task_stages where seed_key = 'todo';
  perform public.task_move('10000000-0000-4000-8000-000000000001', s_done, array['10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001']::uuid[]);
  select * into t from public.tasks where id = '10000000-0000-4000-8000-000000000001';
  if t.status <> 'feita' or t.done_at is null or t.stage_id <> s_done or t.board_position <> 2048 then
    raise exception 'Mover para Concluida falhou: % % %', t.status, t.done_at, t.board_position;
  end if;
  perform public.task_move('10000000-0000-4000-8000-000000000002', s_doing, array['10000000-0000-4000-8000-000000000002']::uuid[]);
  select * into t from public.tasks where id = '10000000-0000-4000-8000-000000000002';
  if t.status <> 'pendente' or t.done_at is not null or t.outcome is not null or t.stage_id <> s_doing then
    raise exception 'Sair de Concluida nao limpou: % % %', t.status, t.done_at, t.outcome;
  end if;
  -- Em andamento -> A fazer: mesmo status, nada de conclusao muda.
  update public.tasks set stage_id = s_todo where id = '10000000-0000-4000-8000-000000000002';
  if (select status from public.tasks where id = '10000000-0000-4000-8000-000000000002') <> 'pendente' then raise exception 'Status mudou entre colunas pendentes'; end if;
  -- Status mudado por outra tela (CRM): coluna incompativel e liberada.
  update public.tasks set stage_id = s_doing where id = '10000000-0000-4000-8000-000000000002';
  update public.tasks set status = 'aguardando' where id = '10000000-0000-4000-8000-000000000002';
  if (select stage_id from public.tasks where id = '10000000-0000-4000-8000-000000000002') is not null then
    raise exception 'Coluna incompativel mantida';
  end if;
  -- Reordenar nao toca tarefa de outra clinica.
  if public.task_move('10000000-0000-4000-8000-000000000001', null, array['10000000-0000-4000-8000-000000000003']::uuid[]) <> 0 then
    raise exception 'Reordenou tarefa da clinica B';
  end if;
  begin
    perform public.task_move('10000000-0000-4000-8000-000000000003', s_todo, null);
    raise exception 'Moveu tarefa da clinica B';
  exception when raise_exception then if sqlerrm <> 'Tarefa não encontrada' then raise; end if; end;
end $$;
reset role;

-- Coluna de outra clinica e rejeitada (id conhecido, mesmo sem enxerga-la).
select set_config('test.stage_a', (select id::text from public.task_stages where seed_key = 'todo'), false);
set test.uid = 'b0000000-0000-4000-8000-000000000001';
set role authenticated;
do $$ begin
  begin
    update public.tasks set stage_id = current_setting('test.stage_a')::uuid where id = '10000000-0000-4000-8000-000000000003';
    raise exception 'Usou coluna invisivel';
  exception when raise_exception then if sqlerrm not like 'Coluna de tarefas%' then raise; end if; end;
  if (select count(*) from public.task_stages) <> 0 then raise exception 'Clinica B ve colunas da A'; end if;
end $$;
reset role;
do $$ begin
  begin
    update public.tasks set stage_id = (select id from public.task_stages where user_id = 'a0000000-0000-4000-8000-000000000001' limit 1)
      where id = '10000000-0000-4000-8000-000000000003';
    raise exception 'Usou coluna da clinica A';
  exception when raise_exception then if sqlerrm not like 'Coluna de tarefas%' then raise; end if; end;
end $$;

-- 5. Historico: alteracoes com autor; ninguem escreve direto.
do $$ begin
  if (select count(*) from public.task_history where task_id = '10000000-0000-4000-8000-000000000001' and field = 'status') < 1 then
    raise exception 'Historico de status ausente';
  end if;
  if (select count(*) from public.task_history where field = 'board_position') <> 0 then raise exception 'Historico de posicao'; end if;
  if exists (select 1 from public.task_history where field = 'stage_id' and changed_by is distinct from 'a0000000-0000-4000-8000-000000000001') then
    raise exception 'Autor do historico incorreto';
  end if;
end $$;
set test.uid = 'a0000000-0000-4000-8000-0000000000e1';
set role authenticated;
do $$ begin
  begin
    insert into public.task_history(task_id, user_id, field) values ('10000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'x');
    raise exception 'Escreveu historico';
  exception when insufficient_privilege then null; end;
end $$;

-- 6. Checklist: conclusao registra quem/quando; nao pendura em tarefa de outra clinica.
do $$
declare i public.task_checklist_items;
begin
  insert into public.task_checklist_items(user_id, task_id, title) values ('a0000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Pedir exames') returning * into i;
  update public.task_checklist_items set done = true where id = i.id returning * into i;
  if i.done_at is null or i.done_by <> 'a0000000-0000-4000-8000-0000000000e1' then raise exception 'Conclusao sem autor'; end if;
  update public.task_checklist_items set done = false where id = i.id returning * into i;
  if i.done_at is not null then raise exception 'Reabrir nao limpou'; end if;
  begin
    insert into public.task_checklist_items(user_id, task_id, title) values ('a0000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', 'x');
    raise exception 'Checklist em tarefa de outra clinica';
  exception when insufficient_privilege then null; end;
end $$;

-- 7. Comentarios: autor forcado, fio normalizado, mencoes limpas, imutaveis.
do $$
declare c1 public.task_comments; c2 public.task_comments; c3 public.task_comments;
begin
  insert into public.task_comments(user_id, task_id, body, author_id, mentions)
  values ('a0000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Oi', 'a0000000-0000-4000-8000-000000000001',
          array['a0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001']::uuid[]) returning * into c1;
  if c1.author_id <> 'a0000000-0000-4000-8000-0000000000e1' then raise exception 'Autor nao forcado'; end if;
  if c1.mentions <> array['a0000000-0000-4000-8000-000000000001']::uuid[] then raise exception 'Mencoes nao limpas'; end if;
  insert into public.task_comments(user_id, task_id, body, parent_id) values ('a0000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'r1', c1.id) returning * into c2;
  insert into public.task_comments(user_id, task_id, body, parent_id) values ('a0000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'r2', c2.id) returning * into c3;
  if c3.parent_id <> c1.id then raise exception 'Fio nao normalizado'; end if;
  begin
    insert into public.task_comments(user_id, task_id, body) values ('a0000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', 'x');
    raise exception 'Comentou em tarefa de outra clinica';
  exception when raise_exception then if sqlerrm <> 'Tarefa não encontrada nesta clínica' then raise; end if; end;
  begin
    update public.task_comments set body = 'editado' where id = c1.id;
    raise exception 'Comentario editado';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- 8. Excluir a tarefa leva checklist/comentarios/historico junto (sem orfao).
delete from public.tasks where id = '10000000-0000-4000-8000-000000000001';
do $$ begin
  if exists (select 1 from public.task_checklist_items where task_id = '10000000-0000-4000-8000-000000000001')
     or exists (select 1 from public.task_comments where task_id = '10000000-0000-4000-8000-000000000001')
     or exists (select 1 from public.task_history where task_id = '10000000-0000-4000-8000-000000000001') then
    raise exception 'Orfaos apos excluir tarefa';
  end if;
end $$;

-- 9. Insercao de outros modulos (esteiras/regras: sem coluna) continua igual e entra no historico.
insert into public.tasks(user_id, title, status) values ('a0000000-0000-4000-8000-000000000001', 'Pos-op D+7', 'pendente');
do $$ begin
  if (select stage_id from public.tasks where title = 'Pos-op D+7') is not null then raise exception 'Insercao ganhou coluna'; end if;
  if not exists (select 1 from public.task_history h join public.tasks t on t.id = h.task_id where t.title = 'Pos-op D+7' and h.field = 'created') then
    raise exception 'Criacao fora do historico';
  end if;
end $$;

select 'tasksWorkspacePhase4 OK' as resultado;
