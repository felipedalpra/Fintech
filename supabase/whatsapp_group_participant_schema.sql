-- whatsapp_group_participant_schema.sql
-- Preserva a identidade privada (@lid) de participantes de grupos quando o
-- WhatsApp não fornece telefone. Aditivo, idempotente e sem DELETE/UPDATE.
-- Executar DEPOIS de whatsapp_conversation_identity_schema.sql.

begin;

alter table public.whatsapp_messages
  add column if not exists sender_lid text;

create index if not exists idx_whatsapp_group_sender_lid
  on public.whatsapp_messages(user_id, whatsapp_number_id, phone, sender_lid, created_at desc)
  where is_group = true and sender_lid is not null;

comment on column public.whatsapp_messages.sender_lid is
  'Linked ID privado do participante do grupo informado pelo WhatsApp; não é telefone.';

commit;

-- Verificação pós-migração (somente leitura):
-- select count(*) filter (where sender_lid is not null) as participantes_com_lid
-- from public.whatsapp_messages
-- where is_group = true;
