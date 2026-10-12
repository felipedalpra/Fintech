-- clinical_cost_settlements_schema.sql
-- Metadados independentes de liquidação para cada componente de custo clínico.
-- O valor continua no campo operacional; o JSON guarda credor, situação e as três datas por
-- componente, projetadas em títulos separados no razão. Aditivo, idempotente e sem backfill falso.

alter table public.surgeries
  add column if not exists cost_settlements jsonb not null default '{}'::jsonb;

alter table public.consultations
  add column if not exists cost_settlements jsonb not null default '{}'::jsonb;

comment on column public.surgeries.cost_settlements is
  'Liquidação por componente: hospital_cost, anesthesia_cost, material_cost, other_cost, invoice_tax.';
comment on column public.consultations.cost_settlements is
  'Liquidação independente do componente invoice_tax.';
