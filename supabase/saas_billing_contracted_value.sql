-- Preço contratual por clínica, sobrepondo o preço padrão do plano em src/billing/plans.js.
-- Usado para preços de entrada enquanto parte da plataforma ainda não está pronta
-- (ex.: financeiro), reajustado depois por marco pela ferramenta de admin da Zentri
-- (/zentri-admin), nunca pela própria clínica. NULL = usa o preço padrão do plano.
-- Aditiva; seguro para executar múltiplas vezes.

alter table public.billing_accounts
  add column if not exists contracted_monthly_value_cents integer
  check (contracted_monthly_value_cents is null or contracted_monthly_value_cents > 0);
