-- Administrador que NÃO é dono da clínica passa a gerenciar a equipe.
-- Executar depois de access_control_schema.sql e whatsapp_ownership_schema.sql.
--
-- Problema: as policies de clinic_members só conhecem DONO (clinics.owner_id = auth.uid()) ou
-- EU MESMO (user_id = auth.uid()). O perfil "Administrador" que entrou como membro — o caso do
-- Augusto na clínica da Dra. Vitória — caía na segunda e via apenas a própria linha, sem conseguir
-- listar a equipe nem marcar "Acesso ao prontuário clínico" de ninguém.
--
-- Duas armadilhas que estas funções existem para evitar:
--   1. RECURSÃO: uma policy de clinic_members que consulta clinic_members entra em loop. Por isso
--      a checagem vive em função `security definer`, que não reentra na RLS.
--   2. CLINICS TAMBÉM TEM RLS: subconsulta dentro de policy roda com a RLS de quem pergunta, e a
--      policy de `clinics` é `auth.uid() = owner_id`. Para um admin-membro um `select ... from
--      clinics` devolveria VAZIO — e um guard que silenciosamente dá vazio viraria "pode tudo" ou
--      "não pode nada", dependendo de onde estivesse. `security definer` também resolve isso.

begin;

-- Admin (dono OU membro com role 'admin') enxerga a equipe inteira daquela clínica.
create or replace function public.clinic_admin_can_see_members(p_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_clinic_admin()
    and exists (
      select 1 from public.clinics c
      where c.id = p_clinic_id
        and c.owner_id = public.data_owner_id()
    )
$$;

-- Escrita: mesma regra, MENOS a linha do dono. Sem isto um admin-membro poderia rebaixar ou
-- remover a dona da própria clínica.
create or replace function public.clinic_admin_can_manage_member(p_clinic_id uuid, p_member_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_clinic_admin()
    and p_member_user_id is not null
    and exists (
      select 1 from public.clinics c
      where c.id = p_clinic_id
        and c.owner_id = public.data_owner_id()
        and c.owner_id <> p_member_user_id
    )
$$;

revoke all on function public.clinic_admin_can_see_members(uuid) from public, anon;
revoke all on function public.clinic_admin_can_manage_member(uuid, uuid) from public, anon;
grant execute on function public.clinic_admin_can_see_members(uuid) to authenticated;
grant execute on function public.clinic_admin_can_manage_member(uuid, uuid) to authenticated;

-- As policies existentes (dono e "vejo a minha linha") continuam intactas: policies são OR, então
-- o dono não perde nada e nenhum membro comum ganha nada.
drop policy if exists "Clinic members admin roster" on public.clinic_members;
create policy "Clinic members admin roster" on public.clinic_members
  for select to authenticated
  using (public.clinic_admin_can_see_members(clinic_id));

drop policy if exists "Clinic members admin insert" on public.clinic_members;
create policy "Clinic members admin insert" on public.clinic_members
  for insert to authenticated
  with check (public.clinic_admin_can_manage_member(clinic_id, user_id));

drop policy if exists "Clinic members admin update" on public.clinic_members;
create policy "Clinic members admin update" on public.clinic_members
  for update to authenticated
  using (public.clinic_admin_can_manage_member(clinic_id, user_id))
  with check (public.clinic_admin_can_manage_member(clinic_id, user_id));

drop policy if exists "Clinic members admin delete" on public.clinic_members;
create policy "Clinic members admin delete" on public.clinic_members
  for delete to authenticated
  using (public.clinic_admin_can_manage_member(clinic_id, user_id));

commit;

-- Conferência após aplicar:
-- select policyname, cmd from pg_policies
-- where tablename = 'clinic_members' order by policyname;
