-- meta_integration_schema.sql
-- CRM · Integração Meta Ads (MVP Fase 1): conexão + lead em tempo real no pipeline.
-- Aditivo, idempotente. Executar DEPOIS de: access_control_schema.sql, opportunities_schema.sql,
-- whatsapp_lead_autocreate.sql (reusa o padrão de lead automático). Rodar no SQL Editor.

-- 1. Conexão do Meta por clínica (credenciais lidas só no servidor).
create table if not exists public.meta_connections (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null unique references auth.users(id) on delete cascade,  -- dono/clínica
  ad_account_id  text,                 -- act_<id>
  page_id        text,                 -- página do Facebook (origem dos Lead Ads)
  access_token   text,                 -- Page/System User token (NUNCA exposto ao frontend)
  verify_token   text,                 -- token de verificação do webhook (hub.verify_token)
  app_secret     text,                 -- para validar X-Hub-Signature-256 (NUNCA exposto)
  status         text not null default 'desconectado',
  created_at     timestamptz not null default timezone('utc', now()),
  updated_at     timestamptz not null default timezone('utc', now())
);

alter table public.meta_connections enable row level security;
do $$ begin
  begin
    create policy "Meta connections clinic access" on public.meta_connections
      for all to authenticated
      using (user_id = public.data_owner_id())
      with check (user_id = public.data_owner_id());
  exception when duplicate_object then null; end;
end $$;

-- Segredos legíveis só via service role (igual whatsapp_numbers): revoga SELECT dessas colunas.
revoke select (access_token, app_secret) on public.meta_connections from authenticated;
revoke select (access_token, app_secret) on public.meta_connections from anon;

-- 2. Campos de origem Meta na oportunidade (atribuição por campanha/anúncio).
alter table public.opportunities add column if not exists meta_lead_id     text;
alter table public.opportunities add column if not exists meta_campaign_id text;
alter table public.opportunities add column if not exists meta_ad_id       text;
alter table public.opportunities add column if not exists meta_form_id     text;

-- Idempotência do lead do Meta: um leadgen_id vira no máximo 1 oportunidade por clínica.
create unique index if not exists uq_opportunities_meta_lead
  on public.opportunities(user_id, meta_lead_id) where meta_lead_id is not null;

-- 3. RPC: cria (ou devolve) a oportunidade de um lead do Meta — idempotente por meta_lead_id.
--    Espelha ensure_whatsapp_lead: cria paciente + oportunidade em 'primeiro_contato', origem 'meta'.
create or replace function public.ensure_meta_lead(
  p_owner uuid, p_meta_lead_id text, p_name text, p_phone text, p_email text,
  p_campaign_id text, p_ad_id text, p_form_id text
)
returns uuid
language plpgsql
security definer
as $$
declare
  v_opp uuid;
  v_patient uuid;
begin
  -- Já existe oportunidade para este lead? (idempotente)
  select id into v_opp from public.opportunities
    where user_id = p_owner and meta_lead_id = p_meta_lead_id limit 1;
  if v_opp is not null then return v_opp; end if;

  -- Casa por telefone (se houver) a um paciente existente; senão cria o contato.
  if coalesce(p_phone, '') <> '' then
    select id into v_patient from public.patients
      where user_id = p_owner and regexp_replace(coalesce(phone,''), '\D', '', 'g') = regexp_replace(p_phone, '\D', '', 'g')
      limit 1;
  end if;
  if v_patient is null then
    insert into public.patients (user_id, full_name, phone, email)
    values (p_owner, coalesce(nullif(p_name,''), 'Lead Meta'), nullif(p_phone,''), nullif(p_email,''))
    returning id into v_patient;
  end if;

  insert into public.opportunities
    (user_id, patient_id, title, stage, status, source, stage_entered_at,
     meta_lead_id, meta_campaign_id, meta_ad_id, meta_form_id)
  values
    (p_owner, v_patient, coalesce(nullif(p_name,''), 'Lead Meta'), 'primeiro_contato', 'aberto', 'meta', timezone('utc', now()),
     p_meta_lead_id, p_campaign_id, p_ad_id, p_form_id)
  returning id into v_opp;

  insert into public.opportunity_stage_history (opportunity_id, user_id, from_stage, to_stage, moved_by, source)
  values (v_opp, p_owner, null, 'primeiro_contato', null, 'automacao');

  return v_opp;
end $$;

-- Nota: patients precisa ter a coluna email (a maioria das clínicas usa). Se não existir, descomente:
-- alter table public.patients add column if not exists email text;
