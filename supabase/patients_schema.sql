-- Pacientes (CFP Resolução 1/2009)
create table if not exists public.patients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  -- Identificação obrigatória CFP
  full_name text not null,
  cpf text,
  date_of_birth date,
  sex text,
  civil_status text,
  profession text,

  -- Contato
  phone text,
  email text,
  emergency_contact_name text,
  emergency_contact_phone text,

  -- Endereço
  address_street text,
  address_number text,
  address_complement text,
  address_district text,
  address_city text,
  address_state text,
  address_zip text,

  -- Clínico
  start_date date,
  chief_complaint text,
  clinical_notes text,

  -- TCLE (Termo de Consentimento Livre e Esclarecido)
  consent_signed boolean not null default false,
  consent_date date,

  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now())
);

-- Prontuário eletrônico: nunca deletar, apenas arquivar
create table if not exists public.medical_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,

  session_date date not null,
  evolution_notes text not null,
  procedures_applied text,
  next_appointment_date date,
  professional_name text,

  archived boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

-- Documentos do paciente (laudos, exames, TCLE assinado)
create table if not exists public.patient_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,

  file_name text not null,
  file_path text not null,
  file_type text,
  uploaded_at timestamptz not null default timezone('utc', now())
);

-- FKs backward-compatible: registros existentes continuam funcionando
alter table public.surgeries
  add column if not exists patient_id uuid references public.patients(id) on delete set null;

alter table public.consultations
  add column if not exists patient_id uuid references public.patients(id) on delete set null;

-- RLS
alter table public.patients enable row level security;
alter table public.medical_records enable row level security;
alter table public.patient_documents enable row level security;

do $$ begin
  begin
    create policy "Patients own rows" on public.patients
      for all to authenticated
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  exception when duplicate_object then null; end;
end $$;

-- medical_records: sem DELETE (exigência CFP)
do $$ begin
  begin
    create policy "Medical records select" on public.medical_records
      for select to authenticated using (auth.uid() = user_id);
  exception when duplicate_object then null; end;
  begin
    create policy "Medical records insert" on public.medical_records
      for insert to authenticated with check (auth.uid() = user_id);
  exception when duplicate_object then null; end;
  begin
    create policy "Medical records update" on public.medical_records
      for update to authenticated
      using (auth.uid() = user_id) with check (auth.uid() = user_id);
  exception when duplicate_object then null; end;
end $$;

do $$ begin
  begin
    create policy "Patient documents own rows" on public.patient_documents
      for all to authenticated
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  exception when duplicate_object then null; end;
end $$;

create index if not exists idx_patients_user_name on public.patients(user_id, full_name);
create index if not exists idx_medical_records_patient on public.medical_records(patient_id, session_date desc);
create index if not exists idx_surgeries_patient_id on public.surgeries(patient_id);
create index if not exists idx_consultations_patient_id on public.consultations(patient_id);
