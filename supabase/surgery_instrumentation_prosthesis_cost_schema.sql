-- Pedido do Felipe (13/11/2026): cirurgia precisa registrar custo de instrumentadora e de
-- prótese separadamente — hoje caiam dentro de "Custo material" ou "Outros custos", sem
-- rastreio próprio. Mesmo mecanismo dos demais custos clínicos (CLINICAL_COST_COMPONENTS):
-- vira conta a pagar/saída quando liquidado, via cost_settlements existente.

begin;

alter table public.surgeries
  add column if not exists instrumentation_cost numeric(12,2) not null default 0 check (instrumentation_cost >= 0);
alter table public.surgeries
  add column if not exists prosthesis_cost numeric(12,2) not null default 0 check (prosthesis_cost >= 0);

comment on column public.surgeries.instrumentation_cost is 'Custo de instrumentadora/equipe de apoio da cirurgia. Vira conta a pagar/saída (mesmo mecanismo de hospital/anestesia/material).';
comment on column public.surgeries.prosthesis_cost is 'Custo de prótese da cirurgia. Vira conta a pagar/saída (mesmo mecanismo de hospital/anestesia/material).';

commit;
