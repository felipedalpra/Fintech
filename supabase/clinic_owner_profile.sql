-- O dono da clinica aparece na equipe.
-- Executar depois de clinic_admin_manages_team.sql.
--
-- Quando a clinica e criada, NENHUMA linha e inserida em clinic_members para o dono: ele existe
-- so em clinics.owner_id. A aba Equipe e o organograma leem clinic_members, entao a Dra. Vitoria
-- (dona) nunca apareceu em lugar nenhum -- nem para ela mesma.
--
-- Nao resolvemos inserindo uma linha de membro para o dono: isso mudaria dado existente em
-- producao, criaria uma linha que o proprio dono poderia apagar sem querer, e duplicaria a
-- fonte da verdade sobre quem e o dono. A tela passa a LER o dono de onde ele realmente mora.
--
-- security definer porque `clinics` tem RLS `auth.uid() = owner_id`: um admin que nao e dono
-- (o caso do Dr. Augusto) nao consegue ler a linha da clinica, e `auth.users` nao e legivel
-- pelo cliente de jeito nenhum.

begin;

create or replace function public.clinic_owner_profile()
returns table(
  user_id uuid,
  member_email text,
  professional_name text,
  professional_registration text,
  professional_council text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    c.owner_id,
    u.email,
    nullif(btrim(coalesce(c.clinical_professional_name, '')), ''),
    nullif(btrim(coalesce(c.clinical_professional_registration, '')), ''),
    coalesce(nullif(btrim(coalesce(c.clinical_professional_council, '')), ''), 'CRM')
  from public.clinics c
  join auth.users u on u.id = c.owner_id
  where c.owner_id = public.data_owner_id()
    and public.is_clinic_admin()
  order by c.created_at
  limit 1
$$;

revoke all on function public.clinic_owner_profile() from public, anon;
grant execute on function public.clinic_owner_profile() to authenticated;

commit;

-- Conferencia apos aplicar:
-- select * from public.clinic_owner_profile();
