-- operation_financials_schema.sql
-- Razão financeiro · Fase 9 — Impostos, taxas, descontos e comissões por operação (aditivo, idempotente).
-- Preserva os valores REAIS de cada operação (bruto, desconto, taxas, comissão, imposto, líquido) e
-- CONGELA a alíquota/valor do imposto de NF — para que uma mudança futura de configuração NÃO altere
-- relatórios antigos. Campos nullable: enquanto não forem capturados no formulário, o razão deriva.
-- Executar DEPOIS de erp_relational_schema.sql. Rodar no SQL Editor.

do $$
declare t text;
  tables text[] := array['surgeries','consultations','product_sales'];
begin
  foreach t in array tables loop
    execute format('alter table public.%I add column if not exists discount_amount    numeric(12,2)', t);
    execute format('alter table public.%I add column if not exists fees_amount        numeric(12,2)', t);
    execute format('alter table public.%I add column if not exists commission_amount  numeric(12,2)', t);
    execute format('alter table public.%I add column if not exists tax_amount         numeric(12,2)', t);
    execute format('alter table public.%I add column if not exists net_amount         numeric(12,2)', t);
    execute format('alter table public.%I add column if not exists invoice_tax_rate   numeric(5,2)', t);
    execute format('alter table public.%I add column if not exists invoice_tax_amount numeric(12,2)', t);
  end loop;
end $$;
