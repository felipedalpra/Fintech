-- COMPETÊNCIA x VENCIMENTO — regime de competência explícito
--
-- Conceito (contabilidade):
--   competence_date (competência) -> em qual mês o fato entra na DRE/resultado
--   due_date        (vencimento)  -> quando a cobrança vence (contas a pagar/receber e aging)
--   *_payment/sale/purchase date  -> quando o dinheiro mexe (fluxo de caixa)
--
-- Rode no SQL Editor do Supabase (projeto SurgiMetrics).

-- 1) Novas colunas
ALTER TABLE surgeries         ADD COLUMN IF NOT EXISTS competence_date date;
ALTER TABLE surgeries         ADD COLUMN IF NOT EXISTS due_date        date;
ALTER TABLE consultations     ADD COLUMN IF NOT EXISTS competence_date date;
ALTER TABLE consultations     ADD COLUMN IF NOT EXISTS due_date        date;
ALTER TABLE product_sales     ADD COLUMN IF NOT EXISTS competence_date date;
ALTER TABLE product_purchases ADD COLUMN IF NOT EXISTS competence_date date;
ALTER TABLE product_purchases ADD COLUMN IF NOT EXISTS due_date        date;
ALTER TABLE extra_revenues    ADD COLUMN IF NOT EXISTS competence_date date;
ALTER TABLE extra_revenues    ADD COLUMN IF NOT EXISTS due_date        date;
ALTER TABLE expenses          ADD COLUMN IF NOT EXISTS competence_date date;

-- 2) Backfill dos registros já existentes
--    (competência = data do fato gerador; vencimento = data base de cobrança)
UPDATE surgeries         SET competence_date = COALESCE(competence_date, date),
                             due_date        = COALESCE(due_date, date);
UPDATE consultations     SET competence_date = COALESCE(competence_date, date),
                             due_date        = COALESCE(due_date, forecast_payment_date, date);
UPDATE product_sales     SET competence_date = COALESCE(competence_date, sale_date);
UPDATE product_purchases SET competence_date = COALESCE(competence_date, purchase_date),
                             due_date        = COALESCE(due_date, purchase_date);
UPDATE extra_revenues    SET competence_date = COALESCE(competence_date, date),
                             due_date        = COALESCE(due_date, date);
UPDATE expenses          SET competence_date = COALESCE(competence_date, due_date);
