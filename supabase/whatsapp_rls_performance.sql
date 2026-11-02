-- whatsapp_rls_performance.sql
-- Evita reavaliar identidade e escopo da clínica para cada linha lida nas tabelas quentes do WhatsApp.
-- Não altera, apaga ou reescreve nenhum dado. Apenas recria as policies com initPlans escalares.
-- Executar depois de whatsapp_ownership_schema.sql.

begin;

drop policy if exists "WhatsApp numbers read scoped" on public.whatsapp_numbers;
drop policy if exists "WhatsApp numbers admin write" on public.whatsapp_numbers;

create policy "WhatsApp numbers read scoped" on public.whatsapp_numbers
  for select to authenticated
  using (
    user_id = (select public.data_owner_id())
    and ((select public.is_clinic_admin()) or assigned_user_id = (select auth.uid()))
  );

create policy "WhatsApp numbers admin write" on public.whatsapp_numbers
  for all to authenticated
  using (user_id = (select public.data_owner_id()) and (select public.is_clinic_admin()))
  with check (user_id = (select public.data_owner_id()) and (select public.is_clinic_admin()));

drop policy if exists "WhatsApp messages scoped" on public.whatsapp_messages;

create policy "WhatsApp messages scoped" on public.whatsapp_messages
  for select to authenticated
  using (
    user_id = (select public.data_owner_id()) and (
      (select public.is_clinic_admin())
      or whatsapp_number_id is null
      or whatsapp_number_id in (
        select id
        from public.whatsapp_numbers
        where assigned_user_id = (select auth.uid())
      )
    )
  );

-- O polling lento continua como defesa de autorização, mas estas tabelas precisam estar na
-- publication para que mensagens e reatribuições apareçam imediatamente na aba aberta.
do $$
declare
  table_name text;
begin
  foreach table_name in array array['whatsapp_messages', 'whatsapp_numbers'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    exception
      when duplicate_object then null;
      when undefined_object then null;
    end;
  end loop;
end $$;

commit;

-- Rollback funcional: reaplicar a versão anterior de whatsapp_ownership_schema.sql.
-- Antes de produção, validar owner, admin membro, responsável, membro não responsável e anon.
