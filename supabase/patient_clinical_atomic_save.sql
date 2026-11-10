-- Cadastro de paciente + perfil clínico em uma única transação.
-- Executar depois de clinical_record_foundation_schema.sql.

create or replace function public.save_patient_with_clinical_profile(
  p_patient_id uuid,
  p_patient jsonb,
  p_clinical jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  owner_id uuid;
  saved_patient public.patients%rowtype;
  saved_profile public.patient_clinical_profiles%rowtype;
  patient_name text;
begin
  if auth.uid() is null then
    raise exception 'Sessao nao autenticada.' using errcode = '42501';
  end if;
  if p_patient is null or jsonb_typeof(p_patient) <> 'object' then
    raise exception 'Dados cadastrais invalidos.' using errcode = '22023';
  end if;
  if p_clinical is not null and jsonb_typeof(p_clinical) <> 'object' then
    raise exception 'Dados clinicos invalidos.' using errcode = '22023';
  end if;
  if p_clinical is not null and not public.has_clinical_access() then
    raise exception 'Perfil sem acesso para gravar dados clinicos.' using errcode = '42501';
  end if;

  owner_id := public.data_owner_id();
  patient_name := nullif(btrim(p_patient->>'full_name'), '');
  if owner_id is null or patient_name is null then
    raise exception 'Clinica e nome completo do paciente sao obrigatorios.' using errcode = '22023';
  end if;

  if p_patient_id is null then
    insert into public.patients (
      user_id, full_name, cpf, date_of_birth, sex, civil_status, profession,
      phone, email, emergency_contact_name, emergency_contact_phone,
      address_street, address_number, address_complement, address_district,
      address_city, address_state, address_zip, start_date
    ) values (
      owner_id,
      patient_name,
      nullif(btrim(p_patient->>'cpf'), ''),
      nullif(p_patient->>'date_of_birth', '')::date,
      nullif(btrim(p_patient->>'sex'), ''),
      nullif(btrim(p_patient->>'civil_status'), ''),
      nullif(btrim(p_patient->>'profession'), ''),
      nullif(btrim(p_patient->>'phone'), ''),
      nullif(btrim(p_patient->>'email'), ''),
      nullif(btrim(p_patient->>'emergency_contact_name'), ''),
      nullif(btrim(p_patient->>'emergency_contact_phone'), ''),
      nullif(btrim(p_patient->>'address_street'), ''),
      nullif(btrim(p_patient->>'address_number'), ''),
      nullif(btrim(p_patient->>'address_complement'), ''),
      nullif(btrim(p_patient->>'address_district'), ''),
      nullif(btrim(p_patient->>'address_city'), ''),
      nullif(btrim(p_patient->>'address_state'), ''),
      nullif(btrim(p_patient->>'address_zip'), ''),
      nullif(p_patient->>'start_date', '')::date
    ) returning * into saved_patient;
  else
    update public.patients set
      full_name = patient_name,
      cpf = nullif(btrim(p_patient->>'cpf'), ''),
      date_of_birth = nullif(p_patient->>'date_of_birth', '')::date,
      sex = nullif(btrim(p_patient->>'sex'), ''),
      civil_status = nullif(btrim(p_patient->>'civil_status'), ''),
      profession = nullif(btrim(p_patient->>'profession'), ''),
      phone = nullif(btrim(p_patient->>'phone'), ''),
      email = nullif(btrim(p_patient->>'email'), ''),
      emergency_contact_name = nullif(btrim(p_patient->>'emergency_contact_name'), ''),
      emergency_contact_phone = nullif(btrim(p_patient->>'emergency_contact_phone'), ''),
      address_street = nullif(btrim(p_patient->>'address_street'), ''),
      address_number = nullif(btrim(p_patient->>'address_number'), ''),
      address_complement = nullif(btrim(p_patient->>'address_complement'), ''),
      address_district = nullif(btrim(p_patient->>'address_district'), ''),
      address_city = nullif(btrim(p_patient->>'address_city'), ''),
      address_state = nullif(btrim(p_patient->>'address_state'), ''),
      address_zip = nullif(btrim(p_patient->>'address_zip'), ''),
      start_date = nullif(p_patient->>'start_date', '')::date
    where id = p_patient_id and user_id = owner_id
    returning * into saved_patient;

    if saved_patient.id is null then
      raise exception 'Paciente fora do escopo da clinica ou inexistente.' using errcode = '42501';
    end if;
  end if;

  if p_clinical is not null then
    insert into public.patient_clinical_profiles (
      patient_id, user_id, chief_complaint, hda, previous_surgeries,
      hospitalizations, chronic_diseases, allergies, current_medications,
      smoking, alcohol, physical_activity, family_history,
      gynecological_history, clinical_notes, consent_signed, consent_date,
      updated_at
    ) values (
      saved_patient.id,
      owner_id,
      nullif(btrim(p_clinical->>'chief_complaint'), ''),
      nullif(btrim(p_clinical->>'hda'), ''),
      nullif(btrim(p_clinical->>'previous_surgeries'), ''),
      nullif(btrim(p_clinical->>'hospitalizations'), ''),
      nullif(btrim(p_clinical->>'chronic_diseases'), ''),
      nullif(btrim(p_clinical->>'allergies'), ''),
      nullif(btrim(p_clinical->>'current_medications'), ''),
      nullif(btrim(p_clinical->>'smoking'), ''),
      nullif(btrim(p_clinical->>'alcohol'), ''),
      nullif(btrim(p_clinical->>'physical_activity'), ''),
      nullif(btrim(p_clinical->>'family_history'), ''),
      nullif(btrim(p_clinical->>'gynecological_history'), ''),
      nullif(btrim(p_clinical->>'clinical_notes'), ''),
      coalesce((p_clinical->>'consent_signed')::boolean, false),
      case when coalesce((p_clinical->>'consent_signed')::boolean, false)
        then nullif(p_clinical->>'consent_date', '')::date else null end,
      timezone('utc', now())
    )
    on conflict (patient_id) do update set
      chief_complaint = excluded.chief_complaint,
      hda = excluded.hda,
      previous_surgeries = excluded.previous_surgeries,
      hospitalizations = excluded.hospitalizations,
      chronic_diseases = excluded.chronic_diseases,
      allergies = excluded.allergies,
      current_medications = excluded.current_medications,
      smoking = excluded.smoking,
      alcohol = excluded.alcohol,
      physical_activity = excluded.physical_activity,
      family_history = excluded.family_history,
      gynecological_history = excluded.gynecological_history,
      clinical_notes = excluded.clinical_notes,
      consent_signed = excluded.consent_signed,
      consent_date = excluded.consent_date,
      updated_at = excluded.updated_at
    returning * into saved_profile;
  end if;

  return jsonb_build_object(
    'patient', to_jsonb(saved_patient),
    'clinical_profile', case when p_clinical is null then null else to_jsonb(saved_profile) end
  );
end;
$$;

revoke all on function public.save_patient_with_clinical_profile(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.save_patient_with_clinical_profile(uuid, jsonb, jsonb) to authenticated;
