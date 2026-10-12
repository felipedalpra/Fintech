-- product_purchases_settlement.sql
-- Razão financeiro · Fase 4 — Compras de produto: situação de pagamento do título a pagar.
-- Aditivo, idempotente. O supplier_id já foi adicionado na Fase 2 (suppliers_schema.sql).
-- Regra do Codex: compra ANTIGA não é assumida como paga → nasce `legacy_unverified`.
-- Executar DEPOIS de erp_relational_schema.sql e suppliers_schema.sql. Rodar no SQL Editor.

alter table public.product_purchases add column if not exists status text not null default 'legacy_unverified';
alter table public.product_purchases add column if not exists payment_date date;
alter table public.product_purchases add column if not exists document_number text;
alter table public.product_purchases add column if not exists canceled_at timestamptz;

create index if not exists idx_product_purchases_status on public.product_purchases(status);

-- Conferência: quantas compras antigas estão a verificar?
--   select status, count(*) from public.product_purchases group by status;
