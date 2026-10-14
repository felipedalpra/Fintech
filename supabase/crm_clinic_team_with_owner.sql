-- crm_clinic_team_with_owner.sql
-- Corrige a atribuição de responsável: a gestão (role não-admin) só enxergava a PRÓPRIA linha de
-- clinic_members (RLS), então só conseguia atribuir tarefa a si mesma. A RPC clinic_team() (security
-- definer) já devolve o time todo para qualquer membro — aqui ela passa a INCLUIR o DONO da clínica
-- (que normalmente não está em clinic_members, pois é owner, não membro convidado), para que admin,
-- gestão e equipe possam atribuir a qualquer pessoa, inclusive aos dois administradores.
-- Executar DEPOIS de whatsapp_ownership_schema.sql. Supabase SQL Editor.

create or replace function public.clinic_team()
returns table(user_id uuid, member_email text, role text)
language sql stable security definer set search_path = public as $$
  select cm.user_id, cm.member_email, cm.role
  from public.clinic_members cm
  where cm.clinic_id in (select c.id from public.clinics c where c.owner_id = public.data_owner_id())
  union
  -- Dono da clínica (aparece como admin), caso ainda não esteja listado como membro.
  select u.id, u.email, 'admin'
  from auth.users u
  where u.id = public.data_owner_id()
    and not exists (
      select 1 from public.clinic_members cm2
      where cm2.user_id = public.data_owner_id()
        and cm2.clinic_id in (select c.id from public.clinics c where c.owner_id = public.data_owner_id())
    )
$$;

revoke all on function public.clinic_team() from public, anon;
grant execute on function public.clinic_team() to authenticated;

-- Conferir: select * from public.clinic_team();  -- deve listar todos (equipe/gestão/admin + dono)
