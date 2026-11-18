-- Remove o refresh token OAuth do Gmail usado pelo antigo fluxo de alertas.
drop table if exists public.google_oauth_tokens;
