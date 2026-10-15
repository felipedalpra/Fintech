-- google_calendar_clinic_scope.sql
-- Consolida a integração Google Agenda no ownerId da clínica sem apagar conexões antigas.
-- Executar DEPOIS de access_control_schema.sql e google_calendar_schema.sql.
-- Idempotente: pode ser executado novamente com segurança.

alter table public.google_calendar_connections
  add column if not exists migrated_to_owner_id uuid references auth.users(id) on delete set null;

do $$
declare
  clinic_row record;
  source_connection record;
begin
  for clinic_row in
    select id, owner_id
    from public.clinics
  loop
    -- A conexão do próprio owner sempre prevalece. Só promovemos uma conexão de membro
    -- quando a clínica ainda não possui uma conexão canônica.
    if not exists (
      select 1
      from public.google_calendar_connections connection
      where connection.user_id = clinic_row.owner_id
    ) then
      select connection.*
      into source_connection
      from public.google_calendar_connections connection
      join public.clinic_members member
        on member.user_id = connection.user_id
       and member.clinic_id = clinic_row.id
      where connection.migrated_to_owner_id is null
      order by connection.updated_at desc, connection.created_at desc
      limit 1;

      if found then
        insert into public.google_calendar_connections (
          user_id,
          account_email,
          refresh_token_encrypted,
          status,
          created_at,
          updated_at
        ) values (
          clinic_row.owner_id,
          source_connection.account_email,
          source_connection.refresh_token_encrypted,
          source_connection.status,
          source_connection.created_at,
          source_connection.updated_at
        )
        on conflict (user_id) do nothing;

        -- Copia somente os vínculos pertencentes à conexão escolhida. Misturar IDs de
        -- calendários Google diferentes faria um vínculo apontar para a conta errada.
        insert into public.google_calendar_event_links (
          user_id,
          record_type,
          record_id,
          google_event_id,
          synced_hash,
          remote_snapshot,
          detached,
          updated_at
        )
        select
          clinic_row.owner_id,
          link.record_type,
          link.record_id,
          link.google_event_id,
          link.synced_hash,
          link.remote_snapshot,
          link.detached,
          link.updated_at
        from public.google_calendar_event_links link
        where link.user_id = source_connection.user_id
        on conflict (user_id, record_type, record_id) do nothing;
      end if;
    end if;

    -- As conexões pessoais antigas permanecem armazenadas para rollback, porém ficam
    -- explicitamente fora do escopo ativo. Isso impede que uma nova execução deste SQL
    -- ressuscite uma credencial antiga após o admin desconectar a agenda oficial.
    update public.google_calendar_connections connection
    set migrated_to_owner_id = clinic_row.owner_id
    from public.clinic_members member
    where member.user_id = connection.user_id
      and member.clinic_id = clinic_row.id
      and connection.user_id <> clinic_row.owner_id
      and connection.migrated_to_owner_id is null;
  end loop;
end
$$;

comment on table public.google_calendar_connections is
  'Uma conexão Google Agenda canônica por clínica; user_id guarda o owner_id da clínica.';

comment on table public.google_calendar_event_links is
  'Vínculos de eventos da Google Agenda compartilhada; user_id guarda o owner_id da clínica.';

-- As linhas antigas por membro são preservadas e marcadas com migrated_to_owner_id para
-- rollback; o aplicativo não as lê. Remova-as apenas depois de validar a conexão canônica.
