-- Hardening do fluxo OAuth do Gmail.
-- Aplicar depois de alerts_schema.sql.

alter table public.google_oauth_tokens
  add column if not exists connected_by uuid references auth.users(id);

comment on column public.google_oauth_tokens.connected_by is
  'Usuário proprietário da clínica que autorizou a conta Gmail.';
