-- whatsapp_media_schema.sql
-- WhatsApp · Inbox rico — tipo de mensagem + mídia (imagem/áudio/vídeo/documento).
-- Aditivo e idempotente. Executar DEPOIS de whatsapp_schema.sql. Mensagens antigas = 'text'.

begin;

alter table public.whatsapp_messages
  add column if not exists msg_type   text not null default 'text',
  add column if not exists media_url  text,
  add column if not exists media_mime text;

-- Restringe os tipos aceitos (idempotente).
do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.whatsapp_messages'::regclass
      and conname = 'whatsapp_messages_msg_type_check'
  ) then
    alter table public.whatsapp_messages
      add constraint whatsapp_messages_msg_type_check
      check (msg_type in ('text', 'image', 'audio', 'video', 'document'));
  end if;
end $$;

commit;

-- Verificação pós-migração (executar separadamente):
-- select column_name from information_schema.columns
--  where table_schema='public' and table_name='whatsapp_messages' and column_name like 'media%' or column_name='msg_type';
