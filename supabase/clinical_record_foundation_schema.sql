-- Fase 4.0/4.1: fundacao clinica e prontuario imutavel.
-- Executar depois de patients_schema.sql, patients_anamnese_migration.sql e access_control_schema.sql.
-- A migracao e aditiva e idempotente. Dados clinicos legados sao copiados antes de serem
-- removidos da tabela administrativa de pacientes.

begin;

-- Acesso clinico e identidade profissional sao independentes do cargo administrativo.
alter table public.clinic_members
  add column if not exists clinical_access boolean not null default false,
  add column if not exists professional_name text,
  add column if not exists professional_registration text,
  add column if not exists professional_council text not null default 'CRM';

alter table public.clinics
  add column if not exists clinical_professional_name text,
  add column if not exists clinical_professional_registration text,
  add column if not exists clinical_professional_council text not null default 'CRM';

create or replace function public.has_clinical_access()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
    and public.data_owner_id() is not null
    and (
    auth.uid() = public.data_owner_id()
    or exists (
      select 1
      from public.clinic_members cm
      join public.clinics c on c.id = cm.clinic_id
      where cm.user_id = auth.uid()
        and cm.clinical_access is true
        and c.owner_id = public.data_owner_id()
    )
  )
$$;

revoke all on function public.has_clinical_access() from public;
grant execute on function public.has_clinical_access() to authenticated;

create or replace function public.clinical_author_identity()
returns table(author_name text, author_registration text, author_council text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select identity.author_name, identity.author_registration, identity.author_council
  from (
    select
      c.clinical_professional_name as author_name,
      c.clinical_professional_registration as author_registration,
      c.clinical_professional_council as author_council,
      1 as priority
    from public.clinics c
    where c.owner_id = auth.uid()
      and c.owner_id = public.data_owner_id()
    union all
    select
      cm.professional_name,
      cm.professional_registration,
      cm.professional_council,
      2 as priority
    from public.clinic_members cm
    join public.clinics c on c.id = cm.clinic_id
    where cm.user_id = auth.uid()
      and cm.clinical_access is true
      and c.owner_id = public.data_owner_id()
  ) identity
  where nullif(btrim(identity.author_name), '') is not null
    and nullif(btrim(identity.author_registration), '') is not null
  order by identity.priority
  limit 1
$$;

revoke all on function public.clinical_author_identity() from public;
grant execute on function public.clinical_author_identity() to authenticated;

-- O cadastro administrativo continua em patients; a parte de saude passa a ter RLS propria.
create table if not exists public.patient_clinical_profiles (
  patient_id uuid primary key references public.patients(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  chief_complaint text,
  hda text,
  previous_surgeries text,
  hospitalizations text,
  chronic_diseases text,
  allergies text,
  current_medications text,
  smoking text,
  alcohol text,
  physical_activity text,
  family_history text,
  gynecological_history text,
  clinical_notes text,
  consent_signed boolean not null default false,
  consent_date date,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint patient_clinical_profiles_consent_date check (consent_signed or consent_date is null)
);

-- Copia os campos existentes sem substituir um perfil que ja tenha sido migrado.
insert into public.patient_clinical_profiles (
  patient_id, user_id, chief_complaint, hda, previous_surgeries, hospitalizations,
  chronic_diseases, allergies, current_medications, smoking, alcohol,
  physical_activity, family_history, gynecological_history, clinical_notes,
  consent_signed, consent_date
)
select
  p.id, p.user_id, p.chief_complaint, p.hda, p.previous_surgeries, p.hospitalizations,
  p.chronic_diseases, p.allergies, p.current_medications, p.smoking, p.alcohol,
  p.physical_activity, p.family_history, p.gynecological_history, p.clinical_notes,
  coalesce(p.consent_signed, false), p.consent_date
from public.patients p
where p.chief_complaint is not null
   or p.hda is not null
   or p.previous_surgeries is not null
   or p.hospitalizations is not null
   or p.chronic_diseases is not null
   or p.allergies is not null
   or p.current_medications is not null
   or p.smoking is not null
   or p.alcohol is not null
   or p.physical_activity is not null
   or p.family_history is not null
   or p.gynecological_history is not null
   or p.clinical_notes is not null
   or coalesce(p.consent_signed, false) is true
on conflict (patient_id) do nothing;

-- Depois da copia, elimina a duplicidade sensivel da tabela visivel a perfis administrativos.
update public.patients
set chief_complaint = null,
    hda = null,
    previous_surgeries = null,
    hospitalizations = null,
    chronic_diseases = null,
    allergies = null,
    current_medications = null,
    smoking = null,
    alcohol = null,
    physical_activity = null,
    family_history = null,
    gynecological_history = null,
    clinical_notes = null,
    consent_signed = false,
    consent_date = null
where chief_complaint is not null
   or hda is not null
   or previous_surgeries is not null
   or hospitalizations is not null
   or chronic_diseases is not null
   or allergies is not null
   or current_medications is not null
   or smoking is not null
   or alcohol is not null
   or physical_activity is not null
   or family_history is not null
   or gynecological_history is not null
   or clinical_notes is not null
   or coalesce(consent_signed, false) is true;

alter table public.patient_clinical_profiles enable row level security;

do $$
declare policy_row record;
begin
  for policy_row in
    select policyname
    from pg_policies
    where schemaname = 'public' and tablename = 'patient_clinical_profiles'
  loop
    execute format('drop policy if exists %I on public.patient_clinical_profiles', policy_row.policyname);
  end loop;
end $$;

create policy "Clinical profiles authorized read"
on public.patient_clinical_profiles
for select to authenticated
using (user_id = public.data_owner_id() and public.has_clinical_access());

create policy "Clinical profiles authorized insert"
on public.patient_clinical_profiles
for insert to authenticated
with check (
  user_id = public.data_owner_id()
  and public.has_clinical_access()
  and exists (
    select 1 from public.patients p
    where p.id = patient_id and p.user_id = public.data_owner_id()
  )
);

create policy "Clinical profiles authorized update"
on public.patient_clinical_profiles
for update to authenticated
using (user_id = public.data_owner_id() and public.has_clinical_access())
with check (
  user_id = public.data_owner_id()
  and public.has_clinical_access()
  and exists (
    select 1 from public.patients p
    where p.id = patient_id and p.user_id = public.data_owner_id()
  )
);

revoke delete on public.patient_clinical_profiles from authenticated;

create index if not exists idx_patient_clinical_profiles_owner
  on public.patient_clinical_profiles(user_id, patient_id);

-- Compatibilidade de rollout: uma versao antiga do frontend ainda pode enviar os campos
-- clinicos em patients entre a aplicacao do SQL e o deploy. O trigger transfere esses valores
-- para a tabela protegida e limpa a copia administrativa na mesma transacao. Perfis sem acesso
-- clinico nao conseguem reintroduzir conteudo sensivel nessas colunas legadas.
create or replace function public.migrate_legacy_patient_clinical_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if pg_trigger_depth() > 1 then return null; end if;
  if new.chief_complaint is null
     and new.hda is null
     and new.previous_surgeries is null
     and new.hospitalizations is null
     and new.chronic_diseases is null
     and new.allergies is null
     and new.current_medications is null
     and new.smoking is null
     and new.alcohol is null
     and new.physical_activity is null
     and new.family_history is null
     and new.gynecological_history is null
     and new.clinical_notes is null
     and coalesce(new.consent_signed, false) is false
     and new.consent_date is null then
    return null;
  end if;

  if not public.has_clinical_access() then
    raise exception 'Perfil sem acesso para gravar dados clinicos.' using errcode = '42501';
  end if;

  insert into public.patient_clinical_profiles (
    patient_id, user_id, chief_complaint, hda, previous_surgeries, hospitalizations,
    chronic_diseases, allergies, current_medications, smoking, alcohol,
    physical_activity, family_history, gynecological_history, clinical_notes,
    consent_signed, consent_date, updated_at
  ) values (
    new.id, new.user_id, new.chief_complaint, new.hda, new.previous_surgeries, new.hospitalizations,
    new.chronic_diseases, new.allergies, new.current_medications, new.smoking, new.alcohol,
    new.physical_activity, new.family_history, new.gynecological_history, new.clinical_notes,
    coalesce(new.consent_signed, false), new.consent_date, timezone('utc', now())
  )
  on conflict (patient_id) do update set
    chief_complaint = coalesce(excluded.chief_complaint, patient_clinical_profiles.chief_complaint),
    hda = coalesce(excluded.hda, patient_clinical_profiles.hda),
    previous_surgeries = coalesce(excluded.previous_surgeries, patient_clinical_profiles.previous_surgeries),
    hospitalizations = coalesce(excluded.hospitalizations, patient_clinical_profiles.hospitalizations),
    chronic_diseases = coalesce(excluded.chronic_diseases, patient_clinical_profiles.chronic_diseases),
    allergies = coalesce(excluded.allergies, patient_clinical_profiles.allergies),
    current_medications = coalesce(excluded.current_medications, patient_clinical_profiles.current_medications),
    smoking = coalesce(excluded.smoking, patient_clinical_profiles.smoking),
    alcohol = coalesce(excluded.alcohol, patient_clinical_profiles.alcohol),
    physical_activity = coalesce(excluded.physical_activity, patient_clinical_profiles.physical_activity),
    family_history = coalesce(excluded.family_history, patient_clinical_profiles.family_history),
    gynecological_history = coalesce(excluded.gynecological_history, patient_clinical_profiles.gynecological_history),
    clinical_notes = coalesce(excluded.clinical_notes, patient_clinical_profiles.clinical_notes),
    consent_signed = patient_clinical_profiles.consent_signed or excluded.consent_signed,
    consent_date = coalesce(excluded.consent_date, patient_clinical_profiles.consent_date),
    updated_at = timezone('utc', now());

  update public.patients
  set chief_complaint = null,
      hda = null,
      previous_surgeries = null,
      hospitalizations = null,
      chronic_diseases = null,
      allergies = null,
      current_medications = null,
      smoking = null,
      alcohol = null,
      physical_activity = null,
      family_history = null,
      gynecological_history = null,
      clinical_notes = null,
      consent_signed = false,
      consent_date = null
  where id = new.id;
  return null;
end;
$$;

drop trigger if exists trg_migrate_legacy_patient_clinical_write on public.patients;
create trigger trg_migrate_legacy_patient_clinical_write
after insert or update of chief_complaint, hda, previous_surgeries, hospitalizations,
  chronic_diseases, allergies, current_medications, smoking, alcohol, physical_activity,
  family_history, gynecological_history, clinical_notes, consent_signed, consent_date
on public.patients
for each row execute function public.migrate_legacy_patient_clinical_write();

-- Autoria verificavel: actor_id vem da sessao; nome e registro sao snapshots da emissao.
alter table public.medical_records
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists author_name text,
  add column if not exists author_registration text,
  add column if not exists author_council text,
  add column if not exists authorship_source text not null default 'authenticated_user',
  add column if not exists recorded_at timestamptz not null default timezone('utc', now());

-- O schema legado usava cascata. Um prontuario nao pode desaparecer junto com a exclusao
-- acidental do paciente ou da conta proprietaria; a remocao deve falhar e exigir um fluxo
-- explicito de retencao/exportacao.
alter table public.medical_records
  drop constraint if exists medical_records_user_id_fkey,
  drop constraint if exists medical_records_patient_id_fkey;
alter table public.medical_records
  add constraint medical_records_user_id_fkey
    foreign key (user_id) references auth.users(id) on delete restrict,
  add constraint medical_records_patient_id_fkey
    foreign key (patient_id) references public.patients(id) on delete restrict;

update public.medical_records
set author_name = coalesce(nullif(btrim(professional_name), ''), 'Profissional não identificado'),
    author_council = coalesce(author_council, 'CRM'),
    authorship_source = 'legacy_unverified',
    recorded_at = coalesce(created_at, timezone('utc', now()))
where author_name is null;

alter table public.medical_records
  alter column author_name set not null,
  alter column author_council set default 'CRM';

create table if not exists public.medical_record_addenda (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  record_id uuid not null references public.medical_records(id) on delete restrict,
  created_by uuid references auth.users(id) on delete set null,
  addendum_text text not null check (length(btrim(addendum_text)) between 1 and 20000),
  author_name text not null,
  author_registration text,
  author_council text not null default 'CRM',
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.clinical_record_access_logs (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check (action in ('view_record', 'create_record', 'create_addendum')),
  occurred_at timestamptz not null default timezone('utc', now())
);

alter table public.medical_record_addenda enable row level security;
alter table public.clinical_record_access_logs enable row level security;
alter table public.medical_records enable row level security;

do $$
declare policy_row record;
begin
  for policy_row in
    select policyname
    from pg_policies
    where schemaname = 'public' and tablename = 'medical_records'
  loop
    execute format('drop policy if exists %I on public.medical_records', policy_row.policyname);
  end loop;
end $$;

create policy "Medical records authorized read"
on public.medical_records
for select to authenticated
using (user_id = public.data_owner_id() and public.has_clinical_access());

do $$
declare policy_row record;
begin
  for policy_row in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'medical_record_addenda'
  loop
    execute format('drop policy if exists %I on public.medical_record_addenda', policy_row.policyname);
  end loop;

  for policy_row in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'clinical_record_access_logs'
  loop
    execute format('drop policy if exists %I on public.clinical_record_access_logs', policy_row.policyname);
  end loop;
end $$;

create policy "Medical record addenda authorized read"
on public.medical_record_addenda
for select to authenticated
using (user_id = public.data_owner_id() and public.has_clinical_access());

create policy "Clinical access log authorized read"
on public.clinical_record_access_logs
for select to authenticated
using (user_id = public.data_owner_id() and public.has_clinical_access());

revoke insert, update, delete on public.medical_records from authenticated;
revoke insert, update, delete on public.medical_record_addenda from authenticated;
revoke insert, update, delete on public.clinical_record_access_logs from authenticated;
grant select, insert, update on public.patient_clinical_profiles to authenticated;
grant select on public.medical_records to authenticated;
grant select on public.medical_record_addenda to authenticated;
grant select on public.clinical_record_access_logs to authenticated;

create or replace function public.prevent_clinical_record_mutation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  raise exception 'Registros clinicos sao imutaveis; registre um adendo.' using errcode = '55000';
end;
$$;

drop trigger if exists trg_medical_records_immutable on public.medical_records;
create trigger trg_medical_records_immutable
before update or delete on public.medical_records
for each row execute function public.prevent_clinical_record_mutation();

drop trigger if exists trg_medical_record_addenda_immutable on public.medical_record_addenda;
create trigger trg_medical_record_addenda_immutable
before update or delete on public.medical_record_addenda
for each row execute function public.prevent_clinical_record_mutation();

drop trigger if exists trg_clinical_access_logs_immutable on public.clinical_record_access_logs;
create trigger trg_clinical_access_logs_immutable
before update or delete on public.clinical_record_access_logs
for each row execute function public.prevent_clinical_record_mutation();

create or replace function public.log_clinical_record_access(p_patient_id uuid, p_action text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  owner_id uuid;
begin
  if auth.uid() is null or not public.has_clinical_access() then
    raise exception 'Acesso clinico nao autorizado.' using errcode = '42501';
  end if;
  -- A chamada exposta ao navegador registra apenas leitura. Eventos de escrita sao criados
  -- exclusivamente dentro das RPCs transacionais correspondentes, evitando logs forjados.
  if p_action <> 'view_record' then
    raise exception 'A chamada publica de auditoria aceita somente leitura.' using errcode = '22023';
  end if;

  owner_id := public.data_owner_id();
  if not exists (
    select 1 from public.patients p where p.id = p_patient_id and p.user_id = owner_id
  ) then
    raise exception 'Paciente fora do escopo da clinica.' using errcode = '42501';
  end if;

  insert into public.clinical_record_access_logs(user_id, patient_id, actor_id, action)
  values (owner_id, p_patient_id, auth.uid(), p_action);
  return true;
end;
$$;

revoke all on function public.log_clinical_record_access(uuid, text) from public;
grant execute on function public.log_clinical_record_access(uuid, text) to authenticated;

drop function if exists public.create_clinical_record(uuid, date, text, text, date, text, text, text);
create or replace function public.create_clinical_record(
  p_patient_id uuid,
  p_session_date date,
  p_evolution_notes text,
  p_procedures_applied text,
  p_next_appointment_date date
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  owner_id uuid;
  record_id uuid;
  resolved_author_name text;
  resolved_author_registration text;
  resolved_author_council text;
begin
  if auth.uid() is null or not public.has_clinical_access() then
    raise exception 'Acesso clinico nao autorizado.' using errcode = '42501';
  end if;
  if p_patient_id is null or p_session_date is null or nullif(btrim(p_evolution_notes), '') is null then
    raise exception 'Paciente, data e evolucao sao obrigatorios.' using errcode = '22023';
  end if;
  if length(btrim(p_evolution_notes)) > 20000 then
    raise exception 'Evolucao excede o limite permitido.' using errcode = '22001';
  end if;
  owner_id := public.data_owner_id();
  if not exists (
    select 1 from public.patients p where p.id = p_patient_id and p.user_id = owner_id
  ) then
    raise exception 'Paciente fora do escopo da clinica.' using errcode = '42501';
  end if;

  select identity.author_name, identity.author_registration, identity.author_council
    into resolved_author_name, resolved_author_registration, resolved_author_council
  from public.clinical_author_identity() identity;
  if resolved_author_name is null or resolved_author_registration is null then
    raise exception 'Identidade profissional nao configurada.' using errcode = '22023';
  end if;

  insert into public.medical_records (
    user_id, patient_id, created_by, session_date, evolution_notes,
    procedures_applied, next_appointment_date, professional_name,
    author_name, author_registration, author_council, authorship_source
  ) values (
    owner_id, p_patient_id, auth.uid(), p_session_date, btrim(p_evolution_notes),
    nullif(btrim(p_procedures_applied), ''), p_next_appointment_date, btrim(resolved_author_name),
    btrim(resolved_author_name), btrim(resolved_author_registration), coalesce(nullif(btrim(resolved_author_council), ''), 'CRM'),
    'authenticated_user'
  ) returning id into record_id;

  insert into public.clinical_record_access_logs(user_id, patient_id, actor_id, action)
  values (owner_id, p_patient_id, auth.uid(), 'create_record');
  return record_id;
end;
$$;

drop function if exists public.create_medical_record_addendum(uuid, text, text, text, text);
create or replace function public.create_medical_record_addendum(
  p_record_id uuid,
  p_addendum_text text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  owner_id uuid;
  patient_id uuid;
  addendum_id uuid;
  resolved_author_name text;
  resolved_author_registration text;
  resolved_author_council text;
begin
  if auth.uid() is null or not public.has_clinical_access() then
    raise exception 'Acesso clinico nao autorizado.' using errcode = '42501';
  end if;
  if p_record_id is null or nullif(btrim(p_addendum_text), '') is null then
    raise exception 'Registro e texto do adendo sao obrigatorios.' using errcode = '22023';
  end if;
  if length(btrim(p_addendum_text)) > 20000 then
    raise exception 'Adendo excede o limite permitido.' using errcode = '22001';
  end if;
  owner_id := public.data_owner_id();
  select mr.patient_id into patient_id
  from public.medical_records mr
  where mr.id = p_record_id and mr.user_id = owner_id and mr.archived is false;
  if patient_id is null then
    raise exception 'Evolucao fora do escopo ou indisponivel para adendo.' using errcode = '42501';
  end if;

  select identity.author_name, identity.author_registration, identity.author_council
    into resolved_author_name, resolved_author_registration, resolved_author_council
  from public.clinical_author_identity() identity;
  if resolved_author_name is null or resolved_author_registration is null then
    raise exception 'Identidade profissional nao configurada.' using errcode = '22023';
  end if;

  insert into public.medical_record_addenda (
    user_id, record_id, created_by, addendum_text,
    author_name, author_registration, author_council
  ) values (
    owner_id, p_record_id, auth.uid(), btrim(p_addendum_text),
    btrim(resolved_author_name), btrim(resolved_author_registration), coalesce(nullif(btrim(resolved_author_council), ''), 'CRM')
  ) returning id into addendum_id;

  insert into public.clinical_record_access_logs(user_id, patient_id, actor_id, action)
  values (owner_id, patient_id, auth.uid(), 'create_addendum');
  return addendum_id;
end;
$$;

revoke all on function public.create_clinical_record(uuid, date, text, text, date) from public;
grant execute on function public.create_clinical_record(uuid, date, text, text, date) to authenticated;
revoke all on function public.create_medical_record_addendum(uuid, text) from public;
grant execute on function public.create_medical_record_addendum(uuid, text) to authenticated;

create index if not exists idx_medical_record_addenda_record
  on public.medical_record_addenda(record_id, created_at);
create index if not exists idx_clinical_record_access_patient
  on public.clinical_record_access_logs(patient_id, occurred_at desc);
create index if not exists idx_clinical_record_access_owner
  on public.clinical_record_access_logs(user_id, occurred_at desc);

-- Integra o historico tecnico global quando a infraestrutura de auditoria ja existe.
do $$
begin
  if to_regprocedure('public.log_record_change()') is not null then
    drop trigger if exists trg_record_audit on public.patient_clinical_profiles;
    create trigger trg_record_audit
      after insert or update or delete on public.patient_clinical_profiles
      for each row execute function public.log_record_change();

    drop trigger if exists trg_record_audit on public.medical_record_addenda;
    create trigger trg_record_audit
      after insert or update or delete on public.medical_record_addenda
      for each row execute function public.log_record_change();
  end if;
end $$;

commit;
