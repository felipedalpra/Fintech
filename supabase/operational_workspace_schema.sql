-- operational_workspace_schema.sql
-- Estado operacional aditivo para atendimento, notas internas e preferências.
-- Idempotente, sem DELETE físico e isolado por clínica via data_owner_id().

create extension if not exists pgcrypto;

create table if not exists public.whatsapp_conversation_states (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  conversation_key text not null,
  whatsapp_number_id uuid null references public.whatsapp_numbers(id) on delete set null,
  assigned_user_id uuid null references auth.users(id) on delete set null,
  last_read_at timestamptz null,
  marked_unread_at timestamptz null,
  archived_at timestamptz null,
  muted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_conversation_states_key_not_blank check (length(trim(conversation_key)) > 0),
  unique (user_id, conversation_key)
);

create index if not exists idx_whatsapp_conversation_states_owner
  on public.whatsapp_conversation_states(user_id, archived_at, updated_at desc);
create index if not exists idx_whatsapp_conversation_states_assignee
  on public.whatsapp_conversation_states(user_id, assigned_user_id);

create table if not exists public.crm_contact_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  contact_id uuid null references public.crm_contacts(id) on delete set null,
  patient_id uuid null references public.patients(id) on delete set null,
  opportunity_id uuid null references public.opportunities(id) on delete set null,
  author_id uuid not null references auth.users(id) on delete restrict default auth.uid(),
  body text not null,
  created_at timestamptz not null default now(),
  constraint crm_contact_notes_body_not_blank check (length(trim(body)) > 0),
  constraint crm_contact_notes_has_subject check (contact_id is not null or patient_id is not null or opportunity_id is not null)
);

create index if not exists idx_crm_contact_notes_contact
  on public.crm_contact_notes(user_id, contact_id, created_at desc);
create index if not exists idx_crm_contact_notes_patient
  on public.crm_contact_notes(user_id, patient_id, created_at desc);

create table if not exists public.whatsapp_saved_replies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  title text not null,
  body text not null,
  active boolean not null default true,
  created_by uuid not null references auth.users(id) on delete restrict default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_saved_replies_title_not_blank check (length(trim(title)) > 0),
  constraint whatsapp_saved_replies_body_not_blank check (length(trim(body)) > 0)
);

create index if not exists idx_whatsapp_saved_replies_owner
  on public.whatsapp_saved_replies(user_id, active, title);

create table if not exists public.workspace_preferences (
  user_id uuid not null references auth.users(id) on delete restrict,
  actor_user_id uuid not null references auth.users(id) on delete restrict default auth.uid(),
  onboarding_dismissed_at timestamptz null,
  notification_state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, actor_user_id)
);

alter table public.whatsapp_conversation_states enable row level security;
alter table public.crm_contact_notes enable row level security;
alter table public.whatsapp_saved_replies enable row level security;
alter table public.workspace_preferences enable row level security;

drop policy if exists "Conversation states clinic access" on public.whatsapp_conversation_states;
create policy "Conversation states clinic access" on public.whatsapp_conversation_states
  for all to authenticated
  using (user_id = public.data_owner_id())
  with check (
    user_id = public.data_owner_id()
    and (
      whatsapp_number_id is null
      or exists (
        select 1 from public.whatsapp_numbers wa_number
        where wa_number.id = whatsapp_conversation_states.whatsapp_number_id
          and wa_number.user_id = whatsapp_conversation_states.user_id
      )
    )
  );

drop policy if exists "Contact notes clinic access" on public.crm_contact_notes;
create policy "Contact notes clinic access" on public.crm_contact_notes
  for all to authenticated
  using (user_id = public.data_owner_id())
  with check (
    user_id = public.data_owner_id()
    and author_id = auth.uid()
    and (contact_id is null or exists (select 1 from public.crm_contacts contact where contact.id = crm_contact_notes.contact_id and contact.user_id = crm_contact_notes.user_id))
    and (patient_id is null or exists (select 1 from public.patients patient where patient.id = crm_contact_notes.patient_id and patient.user_id = crm_contact_notes.user_id))
    and (opportunity_id is null or exists (select 1 from public.opportunities opportunity where opportunity.id = crm_contact_notes.opportunity_id and opportunity.user_id = crm_contact_notes.user_id))
  );

drop policy if exists "Saved replies clinic access" on public.whatsapp_saved_replies;
create policy "Saved replies clinic access" on public.whatsapp_saved_replies
  for all to authenticated
  using (user_id = public.data_owner_id())
  with check (user_id = public.data_owner_id());

drop policy if exists "Workspace preferences own access" on public.workspace_preferences;
create policy "Workspace preferences own access" on public.workspace_preferences
  for all to authenticated
  using (user_id = public.data_owner_id() and actor_user_id = auth.uid())
  with check (user_id = public.data_owner_id() and actor_user_id = auth.uid());

revoke all on public.whatsapp_conversation_states from anon;
revoke all on public.crm_contact_notes from anon;
revoke all on public.whatsapp_saved_replies from anon;
revoke all on public.workspace_preferences from anon;

grant select, insert, update on public.whatsapp_conversation_states to authenticated;
grant select, insert on public.crm_contact_notes to authenticated;
grant select, insert, update on public.whatsapp_saved_replies to authenticated;
grant select, insert, update on public.workspace_preferences to authenticated;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'whatsapp_conversation_states',
    'crm_contact_notes',
    'whatsapp_saved_replies',
    'workspace_preferences'
  ] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    exception
      when duplicate_object then null;
      when undefined_object then null;
    end;
  end loop;
end $$;
