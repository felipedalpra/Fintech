-- tasks_timeline_schema.sql
-- CRM Fase 2 · sub-projeto 2a — Tarefas (gerais) + Notas da oportunidade.
-- A timeline NÃO tem tabela própria: é derivada no cliente (stage_history + whatsapp + tasks + notes).
-- Executar DEPOIS de opportunities_schema.sql e access_control_schema.sql (usa data_owner_id()).
-- Rodar no Supabase SQL Editor.

-- 1. Tarefas — gerais: podem ligar a uma oportunidade, a um paciente, ou nenhuma (avulsa).
create table if not exists public.tasks (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,     -- dono/clínica
  opportunity_id   uuid references public.opportunities(id) on delete cascade,    -- nullable (avulsa)
  patient_id       uuid references public.patients(id) on delete set null,        -- nullable
  title            text not null,
  due_date         date,
  status           text not null default 'pendente' check (status in ('pendente','feita')),
  assigned_user_id uuid references auth.users(id) on delete set null,
  created_by       uuid references auth.users(id) on delete set null,
  done_at          timestamptz,
  created_at       timestamptz not null default timezone('utc', now()),
  updated_at       timestamptz not null default timezone('utc', now())
);

-- 2. Notas manuais da oportunidade (único "evento" da timeline sem fonte própria).
create table if not exists public.opportunity_notes (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,       -- dono/clínica
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  body           text not null,
  author_id      uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default timezone('utc', now())
);

-- 3. RLS por clínica (membro acessa as do dono).
alter table public.tasks enable row level security;
alter table public.opportunity_notes enable row level security;

do $$ begin
  begin
    create policy "Tasks clinic access" on public.tasks
      for all to authenticated
      using (user_id = public.data_owner_id())
      with check (user_id = public.data_owner_id());
  exception when duplicate_object then null; end;
  begin
    create policy "Opportunity notes clinic access" on public.opportunity_notes
      for all to authenticated
      using (user_id = public.data_owner_id())
      with check (user_id = public.data_owner_id());
  exception when duplicate_object then null; end;
end $$;

-- 4. Índices.
create index if not exists idx_tasks_owner_status on public.tasks(user_id, status, due_date);
create index if not exists idx_tasks_opportunity  on public.tasks(opportunity_id);
create index if not exists idx_tasks_assigned      on public.tasks(assigned_user_id, status);
create index if not exists idx_opp_notes_opp       on public.opportunity_notes(opportunity_id, created_at desc);

-- Verificação (rodar separado):
-- select status, count(*) from public.tasks group by status;
