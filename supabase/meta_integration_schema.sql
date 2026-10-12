-- meta_integration_schema.sql
-- CRM · Integração Meta Ads: estrutura segura para ativação posterior das credenciais.
-- Aditivo e idempotente. Executar DEPOIS de: access_control_schema.sql,
-- opportunities_schema.sql e whatsapp_lead_autocreate.sql.
--
-- Credenciais globais NÃO ficam nesta tabela:
--   META_VERIFY_TOKEN, META_APP_SECRET e META_GRAPH_VERSION ficam na Vercel.
-- access_token é o token da Página/System User de cada clínica e é write-only no frontend.

begin;

-- 1. Conexão Meta por clínica.
create table if not exists public.meta_connections (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null unique references auth.users(id) on delete cascade,
  ad_account_id  text,
  page_id        text,
  access_token   text,
  -- Colunas legadas preservadas para instalações que já executaram a primeira versão.
  -- O app não grava nem lê estes valores; os segredos globais ficam na Vercel.
  verify_token   text,
  app_secret     text,
  status         text not null default 'desconectado',
  created_at     timestamptz not null default timezone('utc', now()),
  updated_at     timestamptz not null default timezone('utc', now())
);

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.meta_connections'::regclass
      and conname = 'meta_connections_status_check'
  ) then
    -- A versão anterior chamava de conectado um cadastro ainda não validado.
    update public.meta_connections set status = 'configurado' where status = 'conectado';
    alter table public.meta_connections
      add constraint meta_connections_status_check
      check (status in ('desconectado', 'configurado', 'conectado', 'erro'));
  end if;
end $$;

-- O webhook resolve exatamente uma clínica para cada Página.
create unique index if not exists uq_meta_connections_page_id
  on public.meta_connections(page_id)
  where page_id is not null;

alter table public.meta_connections enable row level security;
do $$ begin
  begin
    create policy "Meta connections clinic access" on public.meta_connections
      for all to authenticated
      using (user_id = public.data_owner_id())
      with check (user_id = public.data_owner_id());
  exception when duplicate_object then null; end;
end $$;

-- Remove o SELECT amplo do Supabase e libera somente metadados não sensíveis.
-- INSERT/UPDATE também ficam limitados às colunas utilizadas pela tela.
revoke all on table public.meta_connections from anon, authenticated;
grant select (id, user_id, ad_account_id, page_id, status, created_at, updated_at)
  on public.meta_connections to authenticated;
grant insert (user_id, ad_account_id, page_id, access_token, status, updated_at)
  on public.meta_connections to authenticated;
grant update (ad_account_id, page_id, access_token, status, updated_at)
  on public.meta_connections to authenticated;
grant all on table public.meta_connections to service_role;

-- 2. Origem Meta da oportunidade.
alter table public.opportunities add column if not exists meta_lead_id text;
alter table public.opportunities add column if not exists meta_campaign_id text;
alter table public.opportunities add column if not exists meta_ad_id text;
alter table public.opportunities add column if not exists meta_form_id text;

-- Um leadgen_id vira no máximo uma oportunidade por clínica.
create unique index if not exists uq_opportunities_meta_lead
  on public.opportunities(user_id, meta_lead_id)
  where meta_lead_id is not null;

-- 3. Criação atômica e idempotente do lead. Somente service_role pode executar.
create or replace function public.ensure_meta_lead(
  p_owner uuid,
  p_meta_lead_id text,
  p_name text,
  p_phone text,
  p_email text,
  p_campaign_id text,
  p_ad_id text,
  p_form_id text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_opp uuid;
  v_patient uuid;
  v_phone text;
begin
  if p_owner is null then
    raise exception 'p_owner is required' using errcode = '22023';
  end if;
  if nullif(pg_catalog.btrim(p_meta_lead_id), '') is null then
    raise exception 'p_meta_lead_id is required' using errcode = '22023';
  end if;

  -- Serializa duas entregas simultâneas do mesmo lead antes do índice único.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_owner::text || ':' || p_meta_lead_id, 0)
  );

  select id into v_opp
  from public.opportunities
  where user_id = p_owner and meta_lead_id = p_meta_lead_id
  limit 1;
  if v_opp is not null then return v_opp; end if;

  v_phone := pg_catalog.regexp_replace(pg_catalog.coalesce(p_phone, ''), '[^0-9]', '', 'g');
  if v_phone <> '' then
    select id into v_patient
    from public.patients
    where user_id = p_owner
      and pg_catalog.regexp_replace(pg_catalog.coalesce(phone, ''), '[^0-9]', '', 'g') = v_phone
    order by created_at asc
    limit 1;
  end if;

  if v_patient is null and nullif(pg_catalog.btrim(p_email), '') is not null then
    select id into v_patient
    from public.patients
    where user_id = p_owner
      and pg_catalog.lower(pg_catalog.btrim(email)) = pg_catalog.lower(pg_catalog.btrim(p_email))
    order by created_at asc
    limit 1;
  end if;

  if v_patient is null then
    insert into public.patients (user_id, full_name, phone, email, active)
    values (
      p_owner,
      pg_catalog.coalesce(nullif(pg_catalog.btrim(p_name), ''), 'Lead Meta'),
      nullif(pg_catalog.btrim(p_phone), ''),
      nullif(pg_catalog.btrim(p_email), ''),
      true
    )
    returning id into v_patient;
  end if;

  insert into public.opportunities
    (user_id, patient_id, title, stage, status, source, stage_entered_at,
     meta_lead_id, meta_campaign_id, meta_ad_id, meta_form_id)
  values
    (p_owner, v_patient, pg_catalog.coalesce(nullif(pg_catalog.btrim(p_name), ''), 'Lead Meta'),
     'primeiro_contato', 'aberto', 'meta', timezone('utc', now()),
     p_meta_lead_id, p_campaign_id, p_ad_id, p_form_id)
  returning id into v_opp;

  insert into public.opportunity_stage_history
    (opportunity_id, user_id, from_stage, to_stage, moved_by, source)
  values (v_opp, p_owner, null, 'primeiro_contato', null, 'automacao');

  return v_opp;
end $$;

revoke all on function public.ensure_meta_lead(uuid, text, text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.ensure_meta_lead(uuid, text, text, text, text, text, text, text)
  to service_role;

commit;

-- Verificação pós-migração (executar separadamente):
-- select to_regclass('public.meta_connections');
-- select column_name from information_schema.columns
--  where table_schema = 'public' and table_name = 'opportunities' and column_name like 'meta_%';
