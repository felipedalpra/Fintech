-- Metadados mínimos para as visões transversais do workspace clínico.
-- Executar depois de clinical_record_foundation_schema.sql.
-- O conteúdo da evolução permanece fora desta projeção.

begin;

create or replace function public.list_clinical_workspace_record_metadata()
returns table (
  id uuid,
  user_id uuid,
  patient_id uuid,
  session_date date,
  next_appointment_date date,
  author_name text,
  recorded_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
select
  mr.id,
  mr.user_id,
  mr.patient_id,
  mr.session_date,
  mr.next_appointment_date,
  mr.author_name,
  mr.recorded_at
from public.medical_records mr
where mr.archived is false
  and mr.user_id = public.data_owner_id()
  and public.has_clinical_access()
$$;

comment on function public.list_clinical_workspace_record_metadata() is
  'Projeção clínica somente leitura para continuidade do cuidado. Não expõe evolução, conduta, diagnóstico ou outro texto do prontuário e valida proprietário e acesso clínico explicitamente.';

revoke all on function public.list_clinical_workspace_record_metadata() from public, anon;
grant execute on function public.list_clinical_workspace_record_metadata() to authenticated;

commit;
