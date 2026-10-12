-- inventory_movements_schema.sql
-- Razão financeiro · Fase 5 — Ledger de movimentação de estoque (aditivo, idempotente).
-- O saldo passa a ser a SOMA dos movimentos (não mais "inicial + compras - vendas"), o que permite
-- registrar perdas, devoluções, inventário e ajustes — impossíveis no modelo atual.
-- Executar DEPOIS de erp_relational_schema.sql. Rodar no SQL Editor.

create table if not exists public.inventory_movements (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  product_id    uuid not null references public.products(id) on delete cascade,
  movement_type text not null check (movement_type in (
    'opening','purchase','sale','adjustment_in','adjustment_out','loss','return_in','return_out'
  )),
  quantity      numeric(12,2) not null,         -- sempre POSITIVO; o sinal vem do movement_type (in/out)
  unit_cost     numeric(12,2),
  total_cost    numeric(12,2),
  movement_date date,
  source_type   text,                            -- opening | product_purchase | product_sale | manual ...
  source_id     uuid,
  notes         text,
  created_at    timestamptz not null default timezone('utc', now())
);

alter table public.inventory_movements enable row level security;
do $$ begin
  begin
    create policy "Inventory movements clinic access" on public.inventory_movements
      for all to authenticated
      using (user_id = public.data_owner_id())
      with check (user_id = public.data_owner_id());
  exception when duplicate_object then null; end;
end $$;

-- Unicidade por origem: evita duplicar o mesmo movimento (backfill/sync repetível).
create unique index if not exists uq_inventory_movements_source
  on public.inventory_movements(user_id, product_id, source_type, source_id, movement_type)
  where source_id is not null;
create index if not exists idx_inventory_movements_product on public.inventory_movements(user_id, product_id, movement_date);
