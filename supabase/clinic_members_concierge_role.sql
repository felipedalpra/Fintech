-- clinic_members_concierge_role.sql
-- Adiciona o perfil 'concierge' ao CHECK da coluna role em clinic_members.
-- A aba Equipe (Settings) e o UserRoleContext já usam 'concierge' (ex.: Jonas),
-- mas o CHECK original só aceitava admin/gestao/equipe — convidar ou alterar um
-- membro para concierge falhava com violação de constraint.
-- Migração segura (não altera dados existentes). Executar no Supabase SQL Editor.

alter table public.clinic_members
  drop constraint if exists clinic_members_role_check;

alter table public.clinic_members
  add constraint clinic_members_role_check
  check (role in ('admin', 'gestao', 'concierge', 'equipe'));
