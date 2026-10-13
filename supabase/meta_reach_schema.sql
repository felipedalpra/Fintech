-- meta_reach_schema.sql
-- CRM · Meta Ads — cache de ALCANCE e FREQUÊNCIA por período.
-- Aditivo e idempotente. Executar DEPOIS de meta_insights_schema.sql.
--
-- Por que uma tabela à parte: alcance é DEDUPLICADO por período (pessoas únicas), então NÃO pode
-- ser somado a partir dos snapshots diários de meta_insights. O Meta devolve o alcance/frequência
-- corretos só numa consulta por intervalo (sem time_increment). Guardamos um valor por
-- (nível, ref, período). level='account' guarda o alcance deduplicado da conta inteira (para o KPI).

begin;

create table if not exists public.meta_reach (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  level      text not null check (level in ('account','campaign','adset','ad')),
  ref_id     text not null,
  period     text not null check (period in ('month','30d','quarter')),
  reach      bigint not null default 0,
  frequency  numeric(12,4) not null default 0,
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, level, ref_id, period)
);
create index if not exists idx_meta_reach_lookup
  on public.meta_reach(user_id, level, period);

alter table public.meta_reach enable row level security;
do $$ begin
  begin
    create policy "Meta reach clinic access" on public.meta_reach
      for all to authenticated
      using (user_id = public.data_owner_id())
      with check (user_id = public.data_owner_id());
  exception when duplicate_object then null; end;
end $$;

-- Frontend só lê; escrita exclusiva do service_role (o motor de sync).
revoke all on table public.meta_reach from anon, authenticated;
grant select on table public.meta_reach to authenticated;
grant all on table public.meta_reach to service_role;

commit;

-- Verificação pós-migração (executar separadamente):
-- select to_regclass('public.meta_reach');
