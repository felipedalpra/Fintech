-- Registra a forma efetiva de recebimento das receitas adicionais.
-- Aplicar depois de erp_relational_schema.sql / financial_ledger_schema.sql.
begin;

alter table public.extra_revenues
  add column if not exists payment_method text;

commit;
