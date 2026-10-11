-- whatsapp_ai_suggest.sql
-- IA sugere avanço de estágio (sugere e confirma) — Fase 2, sub-projeto 4.
-- A sugestão vive na própria oportunidade; a IA só grava 'pending', o humano confirma/descarta.
-- Executar DEPOIS de opportunities_schema.sql e whatsapp_lead_autocreate.sql. Rodar no Supabase SQL Editor.

alter table public.opportunities
  add column if not exists suggested_stage      text,
  add column if not exists suggested_reason     text,
  add column if not exists suggested_confidence numeric(4,3),
  add column if not exists suggested_at         timestamptz,
  add column if not exists suggestion_status    text not null default 'none';

-- Constraint do status (idempotente).
do $$ begin
  alter table public.opportunities drop constraint if exists opportunities_suggestion_status_check;
  alter table public.opportunities add constraint opportunities_suggestion_status_check
    check (suggestion_status in ('none','pending','confirmed','dismissed'));
end $$;

-- Índice parcial: listar rápido as oportunidades com sugestão pendente.
create index if not exists idx_opp_suggestion_pending
  on public.opportunities(user_id)
  where suggestion_status = 'pending';

-- A policy "Opportunities clinic access" (for all) já existente cobre:
--   confirm → via rpc move_opportunity (+ update suggestion_status='confirmed')
--   dismiss → update suggestion_status='dismissed'
-- O webhook grava a sugestão com service role (ignora RLS).

-- Verificação (rodar separado):
-- select suggestion_status, count(*) from public.opportunities group by suggestion_status;
