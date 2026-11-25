-- Campos aditivos para preservar a conta bancária usada na baixa operacional.
begin;

alter table public.expenses
  add column if not exists financial_account_id uuid;

alter table public.product_purchases
  add column if not exists financial_account_id uuid;

alter table public.extra_revenues
  add column if not exists financial_account_id uuid;

alter table public.product_sales
  add column if not exists financial_account_id uuid;

commit;
