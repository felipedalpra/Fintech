-- Spec: docs/superpowers/plans/2026-11-13-cidade-local-agenda.md
-- Cidade/local estruturado em cirurgia e consulta. Aditiva: city nasce nulo em todas as
-- linhas existentes — a Agenda trata city nulo como "cidade a definir", nunca classifica
-- errado por default. Puramente de agenda/localização, não afeta financeiro.

begin;

alter table public.surgeries
  add column if not exists city text check (city is null or city in ('goiania', 'brasilia'));
alter table public.surgeries
  add column if not exists location_detail text check (location_detail is null or length(location_detail) <= 160);

alter table public.consultations
  add column if not exists city text check (city is null or city in ('goiania', 'brasilia'));
alter table public.consultations
  add column if not exists location_detail text check (location_detail is null or length(location_detail) <= 160);

comment on column public.surgeries.city is 'Goiânia ou Brasília — fonte da verdade da Agenda interna, não depende de cor do Google.';
comment on column public.consultations.city is 'Goiânia ou Brasília — fonte da verdade da Agenda interna, não depende de cor do Google.';

commit;
