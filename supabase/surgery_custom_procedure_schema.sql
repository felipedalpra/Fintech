-- Spec: docs/superpowers/plans/2026-11-13-procedimento-personalizado-cirurgia.md
-- Procedimento combinado/personalizado na cirurgia: texto livre quando não está no catálogo
-- (ex.: "mama + braço"). Puramente de exibição — não afeta receita, custo nem chartOfAccounts.
-- procedure_id já era nullable (on delete set null) em erp_relational_schema.sql; não precisa
-- de ALTER para isso.

begin;

alter table public.surgeries
  add column if not exists custom_procedure_name text
    check (custom_procedure_name is null or length(btrim(custom_procedure_name)) between 1 and 160);

comment on column public.surgeries.custom_procedure_name is
  'Nome digitado livremente quando o procedimento não está no catálogo (ex.: "Mamoplastia + Braquioplastia"). Exclusivo com procedure_id — a regra é validada no app, não aqui, pra não quebrar linhas antigas.';

commit;
