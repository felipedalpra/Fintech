-- whatsapp_numbers_schema.sql
-- Multi-número de WhatsApp (Fase 2, sub-projeto 3). Os 3 números da clínica.
-- Executar DEPOIS de whatsapp_schema.sql e access_control_schema.sql. Rodar no SQL Editor.

create table if not exists public.whatsapp_numbers (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,  -- dono/clínica
  label          text not null,                 -- "Concierge" | "Secretaria" | "Dra."
  phone          text,                           -- número da linha (só dígitos)
  active         boolean not null default true,
  -- SECRETOS (lidos só pelo servidor via service role; revogados de authenticated abaixo):
  instance_url   text,                           -- Z-API: https://api.z-api.io/instances/{id}/token/{token}
  api_token      text,                           -- Z-API Client-Token
  webhook_secret text not null default encode(gen_random_bytes(32), 'hex'), -- token do webhook deste número
  created_at     timestamptz not null default timezone('utc', now())
);

-- Mensagens: de/por qual número.
alter table public.whatsapp_messages
  add column if not exists whatsapp_number_id uuid references public.whatsapp_numbers(id) on delete set null;

-- RLS: a clínica (dono + membros) acessa seus números.
alter table public.whatsapp_numbers enable row level security;
do $$ begin
  begin
    create policy "WhatsApp numbers clinic access" on public.whatsapp_numbers
      for all to authenticated
      using (user_id = public.data_owner_id())
      with check (user_id = public.data_owner_id());
  exception when duplicate_object then null; end;
end $$;

-- Defesa em profundidade: o frontend (authenticated/anon) NÃO lê as colunas que ENVIAM
-- (instance_url contém o token Z-API; api_token é o Client-Token), mesmo tentando selecioná-las.
-- O endpoint usa service role (ignora isto) para enviar. INSERT/UPDATE pela UI continua (write-only).
-- webhook_secret também fica restrito; a tela administrativa o recebe apenas
-- pelo endpoint server-side, depois de confirmar que o usuário é admin da clínica.
revoke select (instance_url, api_token, webhook_secret) on public.whatsapp_numbers from authenticated;
revoke select (instance_url, api_token, webhook_secret) on public.whatsapp_numbers from anon;

create index if not exists idx_whatsapp_numbers_user on public.whatsapp_numbers(user_id, active);
create index if not exists idx_whatsapp_messages_number on public.whatsapp_messages(whatsapp_number_id, created_at desc);
