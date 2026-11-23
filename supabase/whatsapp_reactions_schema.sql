-- WhatsApp · reações vinculadas à mensagem original.
-- Aditivo e idempotente. Executar DEPOIS de whatsapp_schema.sql.

begin;

alter table public.whatsapp_messages
  add column if not exists reaction_emoji text,
  add column if not exists reaction_target_provider_message_id text;

create index if not exists idx_whatsapp_reaction_target
  on public.whatsapp_messages(user_id, whatsapp_number_id, reaction_target_provider_message_id)
  where reaction_target_provider_message_id is not null;

comment on column public.whatsapp_messages.reaction_emoji is
  'Emoji usado na reação recebida/enviada, quando a linha representa uma reação.';
comment on column public.whatsapp_messages.reaction_target_provider_message_id is
  'provider_message_id da mensagem original que recebeu a reação.';

commit;
