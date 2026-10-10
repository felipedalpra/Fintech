-- patient_funnel_schema.sql
-- Adiciona o estágio de funil (jornada do paciente) à tabela patients.
-- Migração ADITIVA e não destrutiva: todos os pacientes existentes recebem o
-- estágio default 'consulta_agendada'. Executar no Supabase SQL Editor ANTES do deploy.

alter table public.patients
  add column if not exists funnel_stage text not null default 'consulta_agendada'
  check (funnel_stage in (
    'consulta_agendada',
    'consultado',
    'orcamento_enviado',
    'reserva_paga',
    'follow_up'
  ));

-- Índice para listar/filtrar por estágio dentro da clínica (user_id = owner dos dados).
create index if not exists idx_patients_funnel_stage
  on public.patients(user_id, funnel_stage);

-- Verificação pós-migração (rodar separadamente):
-- select funnel_stage, count(*) from public.patients group by funnel_stage;
-- Esperado: todos os pacientes existentes em 'consulta_agendada'.
