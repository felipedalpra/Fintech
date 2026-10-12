-- product_sales_settlement.sql
-- Razão financeiro · Fase 3 — Vendas de produto: cliente vinculado + situação de recebimento.
-- Aditivo, idempotente. Regra do Codex: dado ANTIGO não vira "pago" automaticamente — nasce como
-- `legacy_unverified` (a conferir), nunca como recebido sem comprovação.
-- Executar DEPOIS de erp_relational_schema.sql e patients_schema.sql. Rodar no SQL Editor.

-- Cliente (paciente) vinculado à venda. Nullable; o patient_name existente segue como snapshot.
alter table public.product_sales add column if not exists patient_id uuid references public.patients(id) on delete set null;

-- Situação de recebimento. DEFAULT 'legacy_unverified' → as linhas JÁ existentes ficam "a conferir"
-- (não assumimos que foram recebidas). Vendas novas gravam o status escolhido no formulário.
alter table public.product_sales add column if not exists status text not null default 'legacy_unverified';
alter table public.product_sales add column if not exists canceled_at timestamptz;

create index if not exists idx_product_sales_patient on public.product_sales(patient_id);
create index if not exists idx_product_sales_status  on public.product_sales(status);

-- Conferência: quantas vendas antigas estão a verificar?
--   select status, count(*) from public.product_sales group by status;
