-- Meta Ads fase 1: guarda o que a API JA devolve e era descartado, mais o criativo e o log de sync.
-- Executar depois de meta_insights_schema.sql.
--
-- ESTRITAMENTE ADITIVA: nenhuma coluna removida, renomeada ou convertida; nenhuma linha reescrita.
--
-- O ponto central: `actions` chega completo em cada insight e o parser extraia so o lead,
-- jogando fora engajamento, conversoes por tipo e custo por resultado. Guardar o array destrava
-- tudo isso SEM nenhuma requisicao nova a Meta -- nao criamos chamada artificial.

begin;

alter table public.meta_insights
  -- Array cru de `actions` e `cost_per_action_type`, como a Meta devolve. Guardado em jsonb
  -- porque o conjunto de tipos varia por objetivo de campanha e por versao da API: uma coluna
  -- por tipo ficaria desatualizada a cada mudanca da Meta.
  add column if not exists actions jsonb,
  add column if not exists cost_per_action jsonb;

alter table public.meta_ads
  add column if not exists thumbnail_url text,
  add column if not exists creative_id text;

-- Registro de cada sincronizacao: quando rodou, o que trouxe e o que falhou. Sem isto, limite de
-- taxa e erro da Meta sumiam no log do servidor e a tela nao tinha como explicar dado velho.
create table if not exists public.meta_sync_runs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  started_at  timestamptz not null default timezone('utc', now()),
  finished_at timestamptz,
  trigger     text not null default 'cron' check (trigger in ('cron','manual')),
  ok          boolean,
  counts      jsonb not null default '{}'::jsonb,
  error_code  text,
  error_text  text
);

create index if not exists idx_meta_sync_runs_owner on public.meta_sync_runs(user_id, started_at desc);

alter table public.meta_sync_runs enable row level security;
do $$ begin
  begin
    -- Somente leitura pelo cliente: quem escreve e o backend com service role.
    create policy "Meta sync runs clinic read" on public.meta_sync_runs for select to authenticated
      using (user_id = (select public.data_owner_id()));
  exception when duplicate_object then null; end;
end $$;

revoke all on table public.meta_sync_runs from public, anon;
grant select on table public.meta_sync_runs to authenticated;

comment on column public.meta_insights.actions is 'Array `actions` cru da Meta. Fonte de engajamento, conversoes por tipo e resultados.';
comment on column public.meta_insights.cost_per_action is 'Array `cost_per_action_type` cru da Meta: custo por resultado, por tipo de acao.';
comment on table public.meta_sync_runs is 'Historico de sincronizacoes com a Meta, incluindo falhas e limite de taxa.';

commit;

-- Conferencia apos aplicar (nenhuma linha pode ter mudado):
-- select count(*) as linhas, count(actions) as com_actions from public.meta_insights;
