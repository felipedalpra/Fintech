-- Registra a forma efetiva de pagamento das saídas e compras de produtos.
-- Aplicar depois de erp_relational_schema.sql / financial_ledger_schema.sql.
begin;

alter table public.expenses
  add column if not exists payment_method text;

alter table public.product_purchases
  add column if not exists payment_method text;

commit;
