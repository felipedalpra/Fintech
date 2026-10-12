-- suppliers_schema.sql
-- Razão financeiro · Fase 2 — Fornecedores normalizados (aditivo, idempotente).
-- Substitui o fornecedor em texto livre (que fragmenta relatórios) por um cadastro com id estável.
-- O nome original é preservado como snapshot no registro de origem (compra/título), para não
-- reescrever o histórico se o cadastro do fornecedor mudar depois.
-- Executar DEPOIS de access_control_schema.sql e erp_relational_schema.sql. Rodar no SQL Editor.

create table if not exists public.suppliers (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,  -- dono/clínica
  name        text not null,
  document    text,          -- CNPJ/CPF
  email       text,
  phone       text,
  notes       text,
  active      boolean not null default true,
  created_at  timestamptz not null default timezone('utc', now()),
  updated_at  timestamptz not null default timezone('utc', now()),
  archived_at timestamptz
);

alter table public.suppliers enable row level security;
do $$ begin
  begin
    create policy "Suppliers clinic access" on public.suppliers
      for all to authenticated
      using (user_id = public.data_owner_id())
      with check (user_id = public.data_owner_id());
  exception when duplicate_object then null; end;
end $$;
create index if not exists idx_suppliers_owner on public.suppliers(user_id) where archived_at is null;

-- Vínculo nas compras e nas despesas (títulos a pagar). Nullable (retrocompatível); o texto
-- livre existente (product_purchases.supplier) segue como snapshot do nome.
alter table public.product_purchases add column if not exists supplier_id uuid references public.suppliers(id) on delete set null;
alter table public.expenses          add column if not exists supplier_id uuid references public.suppliers(id) on delete set null;

create index if not exists idx_product_purchases_supplier on public.product_purchases(supplier_id);
create index if not exists idx_expenses_supplier          on public.expenses(supplier_id);
