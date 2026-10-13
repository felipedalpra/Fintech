-- meta_insights_schema.sql
-- CRM · Meta Ads — cache de estrutura e métricas (Insights API). Espelho fiel do Meta.
-- Aditivo e idempotente. Executar DEPOIS de meta_integration_schema.sql.
--
-- Estas tabelas são CACHE: a fonte de verdade é o Meta. São escritas SOMENTE pelo service_role
-- (o motor de sync em api/_lib/metaInsights.js). O frontend só LÊ (SELECT). Nada aqui toca o
-- financeiro — gasto de anúncio NÃO entra no razão/caixa/DRE.

begin;

-- 1. Estrutura: campanhas, conjuntos e anúncios (espelho leve).
create table if not exists public.meta_campaigns (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  campaign_id text not null,
  name        text,
  status      text,
  objective   text,
  updated_at  timestamptz not null default timezone('utc', now()),
  unique (user_id, campaign_id)
);

create table if not exists public.meta_adsets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  adset_id    text not null,
  campaign_id text,
  name        text,
  status      text,
  updated_at  timestamptz not null default timezone('utc', now()),
  unique (user_id, adset_id)
);

create table if not exists public.meta_ads (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  ad_id       text not null,
  adset_id    text,
  campaign_id text,
  name        text,
  status      text,
  updated_at  timestamptz not null default timezone('utc', now()),
  unique (user_id, ad_id)
);

-- 2. Insights: snapshot diário por nível. Métricas derivadas (CTR/CPC/CPM/freq/CPL) NÃO são
--    armazenadas — são calculadas na leitura a partir destes valores crus.
create table if not exists public.meta_insights (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  level       text not null check (level in ('campaign','adset','ad')),
  ref_id      text not null,
  campaign_id text,
  date        date not null,
  spend       numeric(14,2) not null default 0,
  impressions bigint not null default 0,
  reach       bigint not null default 0,
  clicks      bigint not null default 0,
  leads       bigint not null default 0,
  updated_at  timestamptz not null default timezone('utc', now()),
  unique (user_id, level, ref_id, date)
);
create index if not exists idx_meta_insights_lookup
  on public.meta_insights(user_id, level, date);

-- 3. Cache da leitura por IA (aba Análises). Uma análise por período × clínica (substituída ao regenerar).
create table if not exists public.meta_analyses (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  period       text not null,
  generated_at timestamptz not null default timezone('utc', now()),
  model        text,
  payload      jsonb not null default '{}'::jsonb,
  unique (user_id, period)
);

-- 4. RLS por clínica em todas as tabelas.
do $$
declare t text;
begin
  foreach t in array array['meta_campaigns','meta_adsets','meta_ads','meta_insights','meta_analyses']
  loop
    execute format('alter table public.%I enable row level security', t);
    begin
      execute format(
        'create policy "Meta cache clinic access" on public.%I for all to authenticated '
        || 'using (user_id = public.data_owner_id()) with check (user_id = public.data_owner_id())', t);
    exception when duplicate_object then null; end;
  end loop;
end $$;

-- 5. Grants: o frontend só LÊ; a escrita é exclusiva do service_role (o motor de sync).
do $$
declare t text;
begin
  foreach t in array array['meta_campaigns','meta_adsets','meta_ads','meta_insights','meta_analyses']
  loop
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select on table public.%I to authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
  end loop;
end $$;

commit;

-- Verificação pós-migração (executar separadamente):
-- select to_regclass('public.meta_insights'), to_regclass('public.meta_analyses');
