-- meta_oauth_connection_schema.sql
-- Conexão Meta Ads via OAuth ("Login do Facebook para empresas"), substituindo o
-- preenchimento manual de Ad Account ID / Page ID / token. Aditivo e idempotente.
-- Executar DEPOIS de meta_integration_schema.sql.

begin;

alter table public.meta_connections
  add column if not exists access_token_encrypted jsonb,
  add column if not exists token_expires_at timestamptz,
  add column if not exists connected_by uuid references auth.users(id) on delete set null,
  add column if not exists fb_user_id text;

-- Linhas antigas com token em texto puro (configuração manual anterior) nunca são
-- "promovidas" silenciosamente a criptografadas: força reconexão explícita.
-- A coluna access_token só existe em instalações que já rodaram uma versão anterior
-- de meta_integration_schema.sql com ela; checa antes de referenciar.
do $$ begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'meta_connections' and column_name = 'access_token'
  ) then
    update public.meta_connections
    set status = 'erro'
    where access_token is not null
      and access_token_encrypted is null;
  end if;
end $$;

alter table public.meta_connections drop column if exists access_token;

alter table public.meta_connections drop constraint if exists meta_connections_status_check;
do $$ begin
  alter table public.meta_connections
    add constraint meta_connections_status_check
    check (status in ('desconectado', 'configurado', 'conectado', 'erro', 'selecionando', 'expirando'));
exception when duplicate_object then null; end $$;

-- O frontend deixa de escrever nesta tabela: tudo passa pelo backend (service role),
-- igual ao padrão já usado em google_calendar_connections.
revoke insert, update, delete on public.meta_connections from authenticated;
revoke select on public.meta_connections from authenticated;
grant select (id, user_id, ad_account_id, page_id, status, token_expires_at, created_at, updated_at)
  on public.meta_connections to authenticated;
grant all on public.meta_connections to service_role;

commit;

-- Verificação pós-migração (executar separadamente): deve retornar zero linhas.
-- select id, user_id from public.meta_connections where status = 'erro' and access_token_encrypted is null;
