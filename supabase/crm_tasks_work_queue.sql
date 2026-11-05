-- Tarefa do CRM com tipo, hora e desfecho.
-- Executar depois de tasks_timeline_schema.sql.
--
-- ESTRITAMENTE ADITIVA: nenhuma coluna removida, renomeada ou convertida; nenhum registro
-- reescrito. Tarefas existentes continuam validas -- ganham tipo 'outro' e seguem sem hora e sem
-- desfecho, exatamente como estao hoje.
--
-- Por que desfecho: hoje a tarefa so tem 'pendente'/'feita'. Uma ligacao nao atendida e uma
-- concluida terminam iguais, e a clinica perde a informacao que decide o proximo passo.
-- 'nao_atendeu' e 'remarcou' NAO encerram a tarefa: o trabalho continua pendente.

begin;

alter table public.tasks
  add column if not exists task_type text not null default 'outro',
  add column if not exists due_time time,
  add column if not exists outcome text,
  add column if not exists outcome_notes text,
  add column if not exists outcome_at timestamptz,
  add column if not exists outcome_by uuid references auth.users(id) on delete set null;

-- Constraints criadas a parte e de forma idempotente: `add column if not exists` nao reaplica
-- o check quando a coluna ja existe de uma execucao anterior.
do $$ begin
  begin
    alter table public.tasks add constraint tasks_task_type_check
      check (task_type in ('ligar','whatsapp','retorno','orcamento','exames','documento','pos_op','outro'));
  exception when duplicate_object then null; end;
  begin
    alter table public.tasks add constraint tasks_outcome_check
      check (outcome is null or outcome in ('concluido','atendeu','nao_atendeu','remarcou','sem_interesse'));
  exception when duplicate_object then null; end;
  -- Desfecho so existe em tarefa encerrada, e tarefa encerrada registra QUANDO foi encerrada.
  begin
    alter table public.tasks add constraint tasks_outcome_requires_done
      check (outcome is null or status = 'feita');
  exception when duplicate_object then null; end;
end $$;

-- A fila de trabalho busca por dono + status + vencimento. Sem este indice, uma clinica com
-- milhares de tarefas varre a tabela a cada abertura da tela.
create index if not exists idx_tasks_queue
  on public.tasks(user_id, status, due_date)
  where status = 'pendente';

-- Log de tentativas. Uma coluna `outcome` sozinha nao expressa "ligamos 3 vezes, nao atenderam":
-- ela guarda so o desfecho FINAL. Cada tentativa vira uma linha aqui, e a tarefa continua
-- pendente ate um desfecho que encerra. E append-only: tentativa registrada nao se apaga.
create table if not exists public.task_attempts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  task_id    uuid not null references public.tasks(id) on delete cascade,
  outcome    text not null check (outcome in ('concluido','atendeu','nao_atendeu','remarcou','sem_interesse')),
  notes      text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_task_attempts_task on public.task_attempts(task_id, created_at desc);

alter table public.task_attempts enable row level security;
do $$ begin
  begin
    create policy "Task attempts clinic access" on public.task_attempts
      for all to authenticated
      using (user_id = (select public.data_owner_id()))
      with check (user_id = (select public.data_owner_id()));
  exception when duplicate_object then null; end;
end $$;

revoke all on table public.task_attempts from public, anon;
grant select, insert on table public.task_attempts to authenticated;

comment on table public.task_attempts is 'Append-only: cada tentativa de contato de uma tarefa, com desfecho. A tarefa so encerra num desfecho que encerra.';
comment on column public.tasks.task_type is 'Tipo da tarefa: ligar, whatsapp, retorno, orcamento, exames, documento, pos_op, outro.';
comment on column public.tasks.outcome is 'Desfecho ao encerrar. nao_atendeu/remarcou nao encerram o trabalho: a tela reabre ou reagenda.';

commit;

-- Conferencia apos aplicar (nenhuma linha deve ter perdido dado):
-- select count(*) as total,
--        count(*) filter (where task_type = 'outro') as sem_tipo_definido,
--        count(*) filter (where outcome is not null) as com_desfecho
-- from public.tasks;
