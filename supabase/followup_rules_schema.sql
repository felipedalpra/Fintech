-- followup_rules_schema.sql
-- CRM Fase 2 · sub-projeto 2b — Régua de follow-up.
-- Modelos de tarefa por estágio; ao ENTRAR num estágio, o trigger cria as tarefas automaticamente.
-- Executar DEPOIS de opportunities_schema.sql, opportunity_move_rpc.sql e tasks_timeline_schema.sql.
-- Rodar no Supabase SQL Editor.

-- 1. Regras (modelos por estágio).
create table if not exists public.followup_rules (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,   -- dono/clínica
  stage            text not null,
  title            text not null,
  offset_days      int not null default 0,                                      -- vencimento = entrada + N dias
  assigned_user_id uuid references auth.users(id) on delete set null,
  active           boolean not null default true,
  created_at       timestamptz not null default timezone('utc', now())
);

alter table public.followup_rules enable row level security;
do $$ begin
  begin
    create policy "Followup rules clinic access" on public.followup_rules
      for all to authenticated
      using (user_id = public.data_owner_id())
      with check (user_id = public.data_owner_id());
  exception when duplicate_object then null; end;
end $$;
create index if not exists idx_followup_rules_owner_stage on public.followup_rules(user_id, stage, active);

-- 2. Marca na tarefa qual regra a gerou (dedupe idempotente por oportunidade).
alter table public.tasks
  add column if not exists origin_rule_id uuid references public.followup_rules(id) on delete set null;

-- 3. Trigger: ao gravar mudança de estágio, cria as tarefas das regras ativas daquele estágio.
--    SECURITY DEFINER para inserir em tasks independentemente do chamador; idempotente por (opp, rule).
create or replace function public.apply_followup_rules()
returns trigger
language plpgsql
security definer
as $$
declare
  r record;
  pid uuid;
begin
  select patient_id into pid from public.opportunities where id = NEW.opportunity_id;

  for r in
    select * from public.followup_rules
    where user_id = NEW.user_id and stage = NEW.to_stage and active = true
  loop
    if not exists (
      select 1 from public.tasks
      where opportunity_id = NEW.opportunity_id and origin_rule_id = r.id
    ) then
      insert into public.tasks (user_id, opportunity_id, patient_id, title, due_date, assigned_user_id, origin_rule_id, status, created_by)
      values (
        NEW.user_id, NEW.opportunity_id, pid, r.title,
        (current_date + (r.offset_days || ' days')::interval)::date,
        r.assigned_user_id, r.id, 'pendente', NEW.moved_by
      );
    end if;
  end loop;

  return NEW;
end $$;

drop trigger if exists trg_apply_followup_rules on public.opportunity_stage_history;
create trigger trg_apply_followup_rules
  after insert on public.opportunity_stage_history
  for each row execute function public.apply_followup_rules();

-- Verificação (rodar separado): depois de criar uma regra e mover uma oportunidade,
-- select title, due_date, origin_rule_id from public.tasks where origin_rule_id is not null;
