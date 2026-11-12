-- finance_role_access_equipe_surgery.sql
-- Corrige regressão de 2026-11-12: o perfil Equipe ganhou acesso à tela de Cirurgias
-- (ROLE_ACCESS.equipe no app, igualado ao concierge — pedido da Dra. Vitória), mas a RLS
-- de financial_entries/financial_installments só liberava INSERT/UPDATE de origem
-- 'surgery' para o concierge. Resultado real: a secretária (Sumary) tentou lançar uma
-- cirurgia e recebeu "new row violates row-level security policy for table
-- financial_entries" — a tela deixava criar, mas o banco recusava a gravação.
--
-- Esta migração só troca a função financial_source_allowed_for_current_user (criada em
-- finance_role_access_schema.sql): o bloco de 'surgery' passa a aceitar também 'equipe',
-- igual já valia para 'consultation'/'product_sale'/'product_purchase'. Idempotente —
-- substitui a função existente, não cria nem apaga tabela, policy ou dado nenhum.
-- Executar DEPOIS de finance_role_access_schema.sql.

begin;

create or replace function public.financial_source_allowed_for_current_user(
  source_kind text,
  source_record_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  member_role text;
  owner_now uuid := public.data_owner_id();
begin
  if owner_now is null or auth.uid() is null then
    return false;
  end if;
  if public.finance_role_can_manage() then
    return true;
  end if;

  select member.role into member_role
  from public.clinic_members member
  join public.clinics clinic on clinic.id = member.clinic_id
  where member.user_id = auth.uid()
    and clinic.owner_id = owner_now
  limit 1;

  if source_kind = 'surgery' and member_role in ('concierge', 'equipe') then
    return exists (select 1 from public.surgeries source where source.id = source_record_id and source.user_id = owner_now);
  end if;
  if source_kind = 'consultation' and member_role in ('concierge', 'equipe') then
    return exists (select 1 from public.consultations source where source.id = source_record_id and source.user_id = owner_now);
  end if;
  if source_kind = 'product_sale' and member_role in ('concierge', 'equipe') then
    return exists (select 1 from public.product_sales source where source.id = source_record_id and source.user_id = owner_now);
  end if;
  if source_kind = 'product_purchase' and member_role in ('concierge', 'equipe') then
    return exists (select 1 from public.product_purchases source where source.id = source_record_id and source.user_id = owner_now);
  end if;
  return false;
end;
$$;

commit;

-- Verificação manual por sessão (logado como membro Equipe da clínica):
-- select public.financial_source_allowed_for_current_user('surgery', '<id de uma cirurgia da própria clínica>');
-- Esperado: true (antes desta migração: false).
