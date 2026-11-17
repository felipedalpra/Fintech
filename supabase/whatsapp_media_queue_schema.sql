-- whatsapp_media_queue_schema.sql
-- Move o download de mídia recebida para uma fila durável e reprocessável.

begin;

alter table public.whatsapp_webhook_events
  drop constraint if exists whatsapp_webhook_events_processing_status_check;

alter table public.whatsapp_webhook_events
  add constraint whatsapp_webhook_events_processing_status_check
  check (processing_status in ('received', 'processed', 'ignored', 'failed', 'media_pending', 'media_processing'));

create index if not exists idx_whatsapp_webhook_media_queue
  on public.whatsapp_webhook_events(received_at)
  where processing_status = 'media_pending';

commit;
