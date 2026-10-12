-- inventory_costing_schema.sql
-- Razão financeiro · Fase 6 — Custo histórico / CMV (aditivo, idempotente).
-- Congela o custo aplicado em cada venda, para a margem e a DRE NÃO mudarem retroativamente quando
-- o preço de compra do produto for alterado no futuro.
-- CMV = quantidade vendida × custo histórico aplicado na venda (custo médio móvel até a data da venda).
-- Executar DEPOIS de erp_relational_schema.sql e inventory_movements_schema.sql. Rodar no SQL Editor.

alter table public.product_sales add column if not exists unit_cost_at_sale  numeric(12,2);
alter table public.product_sales add column if not exists total_cost_at_sale numeric(12,2);

-- Enquanto não for capturado na venda (fase de autoridade), o custo é DERIVADO do histórico de
-- movimentos (src/lib/inventoryCosting.js) — projeção que bate com o custo médio móvel por construção.
