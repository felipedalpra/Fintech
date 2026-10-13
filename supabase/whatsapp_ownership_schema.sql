-- whatsapp_ownership_schema.sql
-- WhatsApp · Monitoramento + escopo por usuário. Cada número tem um DONO; equipe/gestão veem só as
-- conversas dos números delas; ADMIN (owner ou role='admin') vê todas (monitoramento).
-- Aditivo e idempotente. Executar DEPOIS de whatsapp_numbers_schema.sql e access_control_schema.sql.

begin;

-- 1. Dono do número (nullable: sem dono = só admin vê/usa).
alter table public.whatsapp_numbers
  add column if not exists assigned_user_id uuid references auth.users(id) on delete set null;
create index if not exists idx_whatsapp_numbers_assigned
  on public.whatsapp_numbers(assigned_user_id) where assigned_user_id is not null;

-- 2. É admin da clínica? (owner da conta OU membro com role='admin'). Security definer: lê
--    clinics/clinic_members ignorando a RLS delas. Primeira regra por PERFIL no dado (conversa de paciente).
create or replace function public.is_clinic_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.clinics where owner_id = auth.uid())
      or exists (select 1 from public.clinic_members where user_id = auth.uid() and role = 'admin')
$$;
revoke all on function public.is_clinic_admin() from public, anon;
grant execute on function public.is_clinic_admin() to authenticated;

-- 3. Roster do time da clínica (para chips/filtro/atribuição). Security definer: um admin-membro
--    (ex.: Augusto, que NÃO é owner) também enxerga todos os membros — o SELECT normal de
--    clinic_members só devolve a própria linha para quem não é owner.
create or replace function public.clinic_team()
returns table(user_id uuid, member_email text, role text)
language sql stable security definer set search_path = public as $$
  select cm.user_id, cm.member_email, cm.role
  from public.clinic_members cm
  where cm.clinic_id in (select c.id from public.clinics c where c.owner_id = public.data_owner_id())
$$;
revoke all on function public.clinic_team() from public, anon;
grant execute on function public.clinic_team() to authenticated;

-- 4. whatsapp_numbers: LEITURA escopada (admin vê todos; os demais só os números deles) e
--    ESCRITA só do admin (fecha a brecha de auto-atribuição via supabase-js).
drop policy if exists "WhatsApp numbers clinic access" on public.whatsapp_numbers;
drop policy if exists "WhatsApp numbers read scoped" on public.whatsapp_numbers;
drop policy if exists "WhatsApp numbers admin write" on public.whatsapp_numbers;
create policy "WhatsApp numbers read scoped" on public.whatsapp_numbers
  for select to authenticated
  using (user_id = public.data_owner_id() and (public.is_clinic_admin() or assigned_user_id = auth.uid()));
create policy "WhatsApp numbers admin write" on public.whatsapp_numbers
  for all to authenticated
  using (user_id = public.data_owner_id() and public.is_clinic_admin())
  with check (user_id = public.data_owner_id() and public.is_clinic_admin());

-- 5. whatsapp_messages: SELECT escopado. Admin vê tudo; os demais só os números atribuídos a eles.
--    Mensagens SEM número (legadas ou número removido) continuam visíveis à clínica, como antes
--    (não some histórico). Escrita só pelo service_role (o endpoint/automação) — o front nunca grava.
drop policy if exists "WhatsApp messages own rows" on public.whatsapp_messages;
drop policy if exists "WhatsApp messages clinic access" on public.whatsapp_messages;
drop policy if exists "WhatsApp messages scoped" on public.whatsapp_messages;
create policy "WhatsApp messages scoped" on public.whatsapp_messages
  for select to authenticated
  using (
    user_id = public.data_owner_id() and (
      public.is_clinic_admin()
      or whatsapp_number_id is null
      or whatsapp_number_id in (
        select id from public.whatsapp_numbers where assigned_user_id = auth.uid()
      )
    )
  );

commit;

-- Verificação pós-migração (executar separadamente):
-- select public.is_clinic_admin();
-- select * from public.clinic_team();
