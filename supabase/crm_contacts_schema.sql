-- crm_contacts_schema.sql
-- Separa contato/lead de paciente. Mensagens novas do WhatsApp passam a criar
-- um contato CRM; paciente só nasce por conversão explícita do usuário.
-- Aditivo e idempotente. Executar DEPOIS de whatsapp_conversation_identity_schema.sql,
-- opportunities_schema.sql e crm_manual_lead.sql.

create table if not exists public.crm_contacts (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade,
  source                text not null default 'whatsapp',
  full_name             text,
  phone                 text,
  email                 text,
  photo_url             text,
  status                text not null default 'contact'
                          check (status in ('contact','lead','ignored','patient')),
  patient_id            uuid references public.patients(id) on delete set null,
  whatsapp_number_id    uuid references public.whatsapp_numbers(id) on delete set null,
  whatsapp_identity_key text,
  created_at            timestamptz not null default timezone('utc', now()),
  updated_at            timestamptz not null default timezone('utc', now())
);

alter table public.crm_contacts enable row level security;

drop policy if exists "CRM contacts clinic access" on public.crm_contacts;
create policy "CRM contacts clinic access" on public.crm_contacts
  for all to authenticated
  using (user_id = public.data_owner_id())
  with check (user_id = public.data_owner_id());

create unique index if not exists uq_crm_contacts_whatsapp_identity
  on public.crm_contacts(user_id, whatsapp_number_id, whatsapp_identity_key)
  where whatsapp_number_id is not null and whatsapp_identity_key is not null;
create index if not exists idx_crm_contacts_phone
  on public.crm_contacts(user_id, phone);
create index if not exists idx_crm_contacts_patient
  on public.crm_contacts(patient_id);

alter table public.whatsapp_messages
  add column if not exists contact_id uuid references public.crm_contacts(id) on delete set null;
create index if not exists idx_whatsapp_contact
  on public.whatsapp_messages(contact_id, created_at desc);

alter table public.opportunities
  alter column patient_id drop not null;
alter table public.opportunities
  add column if not exists contact_id uuid references public.crm_contacts(id) on delete set null;
create index if not exists idx_opportunities_contact
  on public.opportunities(contact_id);

-- Toda oportunidade precisa continuar ligada a uma pessoa: paciente ou contato.
alter table public.opportunities drop constraint if exists opportunities_person_check;
alter table public.opportunities
  add constraint opportunities_person_check check (patient_id is not null or contact_id is not null);

-- Contatos individuais já salvos são materializados sem tocar nos pacientes.
-- Se uma conversa já estava ligada a paciente, o contato nasce como "patient".
insert into public.crm_contacts (
  user_id, source, full_name, phone, photo_url, status, patient_id,
  whatsapp_number_id, whatsapp_identity_key, created_at, updated_at
)
select distinct on (m.user_id, m.whatsapp_number_id, coalesce(nullif(m.chat_lid, ''), nullif(m.contact_phone, ''), m.phone))
  m.user_id,
  'whatsapp',
  coalesce(nullif(m.chat_name, ''), nullif(p.full_name, '')),
  coalesce(nullif(m.contact_phone, ''), case when m.phone !~ '@lid$' then m.phone end),
  coalesce(nullif(m.chat_photo, ''), nullif(m.sender_photo, '')),
  case when m.patient_id is not null then 'patient' else 'contact' end,
  m.patient_id,
  m.whatsapp_number_id,
  coalesce(nullif(m.chat_lid, ''), nullif(m.contact_phone, ''), m.phone),
  m.created_at,
  timezone('utc', now())
from public.whatsapp_messages m
left join public.patients p on p.id = m.patient_id
where m.whatsapp_number_id is not null
  and coalesce(m.is_group, false) = false
  and m.phone !~ '(-group|@g\.us)$'
  and coalesce(nullif(m.chat_lid, ''), nullif(m.contact_phone, ''), nullif(m.phone, '')) is not null
order by
  m.user_id,
  m.whatsapp_number_id,
  coalesce(nullif(m.chat_lid, ''), nullif(m.contact_phone, ''), m.phone),
  (m.patient_id is not null) desc,
  m.created_at desc
on conflict (user_id, whatsapp_number_id, whatsapp_identity_key)
  where whatsapp_number_id is not null and whatsapp_identity_key is not null
do update set
  full_name = coalesce(public.crm_contacts.full_name, excluded.full_name),
  phone = coalesce(public.crm_contacts.phone, excluded.phone),
  photo_url = coalesce(public.crm_contacts.photo_url, excluded.photo_url),
  patient_id = coalesce(public.crm_contacts.patient_id, excluded.patient_id),
  status = case when coalesce(public.crm_contacts.patient_id, excluded.patient_id) is not null
    then 'patient' else public.crm_contacts.status end,
  updated_at = timezone('utc', now());

update public.whatsapp_messages m
set contact_id = c.id
from public.crm_contacts c
where m.contact_id is null
  and c.user_id = m.user_id
  and c.whatsapp_number_id = m.whatsapp_number_id
  and c.whatsapp_identity_key = coalesce(nullif(m.chat_lid, ''), nullif(m.contact_phone, ''), m.phone)
  and coalesce(m.is_group, false) = false;

-- Upsert usado pelo endpoint consolidado /api/whatsapp. Não cria paciente nem
-- oportunidade e nunca desfaz um vínculo de paciente já confirmado.
create or replace function public.ensure_crm_whatsapp_contact(
  p_owner uuid,
  p_whatsapp_number uuid,
  p_identity_key text,
  p_phone text default null,
  p_chat_lid text default null,
  p_name text default null,
  p_photo text default null,
  p_patient uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  cid uuid;
  verified_patient uuid;
begin
  if p_owner is null or p_whatsapp_number is null or nullif(btrim(coalesce(p_identity_key, '')), '') is null then
    return null;
  end if;

  if not exists (
    select 1 from public.whatsapp_numbers n
    where n.id = p_whatsapp_number and n.user_id = p_owner
  ) then
    return null;
  end if;

  if p_patient is not null then
    select id into verified_patient
    from public.patients
    where id = p_patient and user_id = p_owner;
  end if;

  insert into public.crm_contacts (
    user_id, source, full_name, phone, photo_url, status, patient_id,
    whatsapp_number_id, whatsapp_identity_key
  ) values (
    p_owner, 'whatsapp', nullif(btrim(coalesce(p_name, '')), ''),
    nullif(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), ''),
    nullif(btrim(coalesce(p_photo, '')), ''),
    case when verified_patient is not null then 'patient' else 'contact' end,
    verified_patient, p_whatsapp_number, btrim(p_identity_key)
  )
  on conflict (user_id, whatsapp_number_id, whatsapp_identity_key)
    where whatsapp_number_id is not null and whatsapp_identity_key is not null
  do update set
    full_name = coalesce(nullif(excluded.full_name, ''), public.crm_contacts.full_name),
    phone = coalesce(nullif(excluded.phone, ''), public.crm_contacts.phone),
    photo_url = coalesce(nullif(excluded.photo_url, ''), public.crm_contacts.photo_url),
    patient_id = coalesce(public.crm_contacts.patient_id, excluded.patient_id),
    status = case when coalesce(public.crm_contacts.patient_id, excluded.patient_id) is not null
      then 'patient' else public.crm_contacts.status end,
    updated_at = timezone('utc', now())
  returning id into cid;

  return cid;
end $$;

-- Compatibilidade durante o deploy: versões antigas do webhook ainda podem
-- chamar esta RPC. Ela deixa de criar paciente/oportunidade e apenas devolve NULL.
create or replace function public.ensure_whatsapp_lead(p_owner uuid, p_phone text, p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  return null;
end $$;

revoke all on function public.ensure_whatsapp_lead(uuid, text, text) from public, anon, authenticated;
grant execute on function public.ensure_whatsapp_lead(uuid, text, text) to service_role;

-- Converte ou vincula um contato a paciente de forma atômica. Nada é apagado:
-- mensagens e oportunidades apenas recebem o patient_id confirmado.
create or replace function public.convert_crm_contact_to_patient(
  p_contact uuid,
  p_patient uuid default null,
  p_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_now uuid := public.data_owner_id();
  contact_row public.crm_contacts;
  pid uuid := p_patient;
begin
  if owner_now is null then raise exception 'Sessão inválida'; end if;

  select * into contact_row
  from public.crm_contacts
  where id = p_contact and user_id = owner_now
  for update;
  if contact_row.id is null then raise exception 'Contato não encontrado'; end if;

  -- Repetir uma conversão já concluída devolve o vínculo existente, em vez de
  -- criar um segundo paciente para o mesmo contato.
  if pid is null then pid := contact_row.patient_id; end if;

  if pid is not null and not exists (
    select 1 from public.patients where id = pid and user_id = owner_now
  ) then
    raise exception 'Paciente inválido para esta clínica';
  end if;

  if pid is null then
    insert into public.patients (user_id, full_name, phone, active)
    values (
      owner_now,
      coalesce(nullif(btrim(coalesce(p_name, '')), ''), contact_row.full_name, contact_row.phone, 'Paciente'),
      contact_row.phone,
      true
    ) returning id into pid;
  end if;

  update public.crm_contacts
  set patient_id = pid, status = 'patient', updated_at = timezone('utc', now())
  where id = contact_row.id;

  update public.whatsapp_messages
  set patient_id = pid
  where contact_id = contact_row.id and user_id = owner_now;

  update public.opportunities
  set patient_id = pid, updated_at = timezone('utc', now())
  where contact_id = contact_row.id and user_id = owner_now;

  return pid;
end $$;

-- Adiciona explicitamente o contato ao funil. É idempotente: se já houver uma
-- oportunidade aberta para esse contato, devolve a existente.
create or replace function public.create_whatsapp_contact_lead(
  p_contact uuid,
  p_title text default null
)
returns public.opportunities
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_now uuid := public.data_owner_id();
  contact_row public.crm_contacts;
  result public.opportunities;
begin
  if owner_now is null then raise exception 'Sessão inválida'; end if;

  select * into contact_row
  from public.crm_contacts
  where id = p_contact and user_id = owner_now
  for update;
  if contact_row.id is null then raise exception 'Contato não encontrado'; end if;

  select * into result
  from public.opportunities
  where user_id = owner_now and contact_id = contact_row.id and status = 'aberto'
  order by created_at desc
  limit 1;
  if result.id is not null then return result; end if;

  insert into public.opportunities (
    user_id, patient_id, contact_id, title, stage, status, source, stage_entered_at
  ) values (
    owner_now, contact_row.patient_id, contact_row.id,
    coalesce(nullif(btrim(coalesce(p_title, '')), ''), 'Lead WhatsApp'),
    'primeiro_contato', 'aberto', 'whatsapp', timezone('utc', now())
  ) returning * into result;

  update public.crm_contacts
  set status = case when patient_id is not null then 'patient' else 'lead' end,
      updated_at = timezone('utc', now())
  where id = contact_row.id;

  insert into public.opportunity_stage_history (
    opportunity_id, user_id, from_stage, to_stage, moved_by, source
  ) values (
    result.id, owner_now, null, 'primeiro_contato', auth.uid(), 'manual'
  );

  return result;
end $$;

revoke all on function public.ensure_crm_whatsapp_contact(uuid, uuid, text, text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.ensure_crm_whatsapp_contact(uuid, uuid, text, text, text, text, text, uuid) to service_role;
revoke all on function public.convert_crm_contact_to_patient(uuid, uuid, text) from public, anon;
grant execute on function public.convert_crm_contact_to_patient(uuid, uuid, text) to authenticated;
revoke all on function public.create_whatsapp_contact_lead(uuid, text) from public, anon;
grant execute on function public.create_whatsapp_contact_lead(uuid, text) to authenticated;

-- Lead manual também passa a ser contato CRM, nunca paciente automático.
drop function if exists public.create_manual_lead(uuid, text, text, text, text, numeric, uuid, text);
create or replace function public.create_manual_lead(
  p_owner uuid,
  p_name text,
  p_phone text default null,
  p_title text default null,
  p_source text default null,
  p_value numeric default null,
  p_responsible uuid default null,
  p_stage text default 'primeiro_contato'
)
returns public.opportunities
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_now uuid := public.data_owner_id();
  cid uuid;
  pid uuid;
  resp uuid := p_responsible;
  val numeric := p_value;
  result public.opportunities;
  phone_digits text := nullif(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), '');
  clean_name text := nullif(btrim(coalesce(p_name, '')), '');
begin
  if p_owner is null or owner_now is null or p_owner is distinct from owner_now then
    raise exception 'Sem permissão para criar lead nesta clínica';
  end if;
  if clean_name is null and phone_digits is null then
    raise exception 'Informe ao menos nome ou telefone';
  end if;
  if resp is not null and resp <> p_owner and not exists (
    select 1 from public.clinic_members cm
    join public.clinics c on c.id = cm.clinic_id
    where cm.user_id = resp and c.owner_id = p_owner
  ) then resp := null; end if;
  if val is not null and val < 0 then val := null; end if;

  if phone_digits is not null then
    select id into pid from public.patients
    where user_id = p_owner and active = true
      and regexp_replace(coalesce(phone, ''), '\D', '', 'g') = phone_digits
    limit 1;
  end if;

  if pid is null then
    if phone_digits is not null then
      select id into cid from public.crm_contacts
      where user_id = p_owner and phone = phone_digits and patient_id is null
      order by created_at asc limit 1;
    end if;
    if cid is null then
      insert into public.crm_contacts (user_id, source, full_name, phone, status)
      values (p_owner, coalesce(nullif(btrim(coalesce(p_source, '')), ''), 'manual'), clean_name, phone_digits, 'lead')
      returning id into cid;
    else
      update public.crm_contacts
      set full_name = coalesce(clean_name, full_name), status = 'lead', updated_at = timezone('utc', now())
      where id = cid;
    end if;
  end if;

  insert into public.opportunities (
    user_id, patient_id, contact_id, title, stage, status, source, value,
    responsible_user_id, stage_entered_at
  ) values (
    p_owner, pid, cid,
    coalesce(nullif(btrim(coalesce(p_title, '')), ''), 'Oportunidade'),
    coalesce(nullif(p_stage, ''), 'primeiro_contato'), 'aberto',
    nullif(btrim(coalesce(p_source, '')), ''), val, resp, timezone('utc', now())
  ) returning * into result;

  insert into public.opportunity_stage_history (opportunity_id, user_id, from_stage, to_stage, moved_by, source)
  values (result.id, p_owner, null, coalesce(nullif(p_stage, ''), 'primeiro_contato'), auth.uid(), 'manual');
  return result;
end $$;

revoke all on function public.create_manual_lead(uuid, text, text, text, text, numeric, uuid, text) from public, anon;
grant execute on function public.create_manual_lead(uuid, text, text, text, text, numeric, uuid, text) to authenticated;
