-- Spec: docs/superpowers/plans/2026-11-13-receita-vs-repasse-terceiros.md
-- Valor que o paciente paga DIRETO a hospital/anestesista/prótese, sem passar pela clínica.
-- Campo puramente informativo: default 0 preserva o comportamento de todas as cirurgias
-- existentes, e nenhum cálculo de receita/DRE/caixa/metas lê esta coluna (ver
-- src/lib/financialLedger.js, buildLedger -> surgeries.forEach).

begin;

alter table public.surgeries
  add column if not exists third_party_passthrough_value numeric(12,2) not null default 0
    check (third_party_passthrough_value >= 0);

comment on column public.surgeries.third_party_passthrough_value is
  'Valor que o paciente paga direto a terceiros (hospital/anestesista/prótese). Nunca é receita nem despesa da clínica — só soma em "valor total ao paciente" na exibição.';

commit;
