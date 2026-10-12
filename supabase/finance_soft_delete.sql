-- finance_soft_delete.sql
-- Resiliência / fidedignidade (regra #1): exclusão de registros do núcleo financeiro/operacional
-- passa a ser SOFT-DELETE (reversível). Em vez de DELETE físico, o app marca `archived_at`.
-- A leitura oculta os arquivados; recuperar = `update ... set archived_at = null`.
-- Idempotente. Rodar no SQL Editor do Supabase. Pode rodar ANTES ou DEPOIS do deploy do código
-- (o código é tolerante: filtra arquivados em JS e, sem a coluna, a exclusão apenas não propaga —
-- nada é apagado de qualquer forma).

alter table public.surgeries         add column if not exists archived_at timestamptz;
alter table public.consultations     add column if not exists archived_at timestamptz;
alter table public.expenses          add column if not exists archived_at timestamptz;
alter table public.extra_revenues    add column if not exists archived_at timestamptz;
alter table public.product_sales     add column if not exists archived_at timestamptz;
alter table public.product_purchases add column if not exists archived_at timestamptz;
alter table public.procedures        add column if not exists archived_at timestamptz;
alter table public.products          add column if not exists archived_at timestamptz;
alter table public.assets            add column if not exists archived_at timestamptz;
alter table public.liabilities       add column if not exists archived_at timestamptz;
alter table public.goals             add column if not exists archived_at timestamptz;

-- Índices parciais: consultas de registros ativos (a maioria) ficam rápidas.
create index if not exists idx_surgeries_active      on public.surgeries(user_id)      where archived_at is null;
create index if not exists idx_consultations_active  on public.consultations(user_id)  where archived_at is null;
create index if not exists idx_expenses_active       on public.expenses(user_id)       where archived_at is null;
create index if not exists idx_extra_revenues_active on public.extra_revenues(user_id) where archived_at is null;

-- Recuperar um registro arquivado por engano (exemplo):
--   update public.extra_revenues set archived_at = null where id = '<id>';
-- Ver arquivados de uma tabela:
--   select id, archived_at from public.expenses where archived_at is not null order by archived_at desc;
