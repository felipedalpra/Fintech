-- whatsapp_ownership_schema.sql
-- WhatsApp · Monitoramento + escopo por usuário. Cada número tem um DONO; equipe/gestão veem só as
-- conversas dos números delas; ADMIN (owner ou role='admin') vê todas (monitoramento).
-- Aditivo e idempotente. Executar DEPOIS de whatsapp_numbers_schema.sql e access_control_schema.sql.

begin;

-- 1. Dono do número (nullable: sem dono = visível só para admin).
alter table public.whatsapp_numbers
  add column if not exists assigned_user_id uuid references auth.users(id) on delete set null;
create index if not exists idx_whatsapp_numbers_assigned
  on public.whatsapp_numbers(assigned_user_id) where assigned_user_id is not null;

-- 2. É admin da clínica? (owner da conta OU membro com role='admin'). Security definer: a função
--    lê clinics/clinic_members ignorando a RLS delas. Primeira regra por PERFIL no dado do app —
--    justificada por ser conversa de paciente (sensível).
create or replace function public.is_clinic_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.clinics where owner_id = auth.uid())
      or exists (select 1 from public.clinic_members where user_id = auth.uid() and role = 'admin')
$$;
revoke all on function public.is_clinic_admin() from public, anon;
grant execute on function public.is_clinic_admin() to authenticated;

-- 3. Nova RLS de whatsapp_messages: admin vê tudo; os demais só os números atribuídos a eles.
--    (Substitui a policy clínica-ampla anterior.)
drop policy if exists "WhatsApp messages own rows" on public.whatsapp_messages;
drop policy if exists "WhatsApp messages clinic access" on public.whatsapp_messages;
drop policy if exists "WhatsApp messages scoped" on public.whatsapp_messages;
create policy "WhatsApp messages scoped" on public.whatsapp_messages
  for all to authenticated
  using (
    user_id = public.data_owner_id() and (
      public.is_clinic_admin()
      or whatsapp_number_id in (
        select id from public.whatsapp_numbers where assigned_user_id = auth.uid()
      )
    )
  )
  with check (user_id = public.data_owner_id());

commit;

-- Verificação pós-migração (executar separadamente):
-- select column_name from information_schema.columns
--  where table_schema='public' and table_name='whatsapp_numbers' and column_name='assigned_user_id';
-- select public.is_clinic_admin();
