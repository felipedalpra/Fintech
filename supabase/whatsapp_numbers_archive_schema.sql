-- whatsapp_numbers_archive_schema.sql
-- Permite "excluir" um número da tela de Configurações → WhatsApp sem apagar nada:
-- mensagens, histórico e o próprio cadastro continuam intactos. Um número removido
-- só volta a aparecer quando o admin clica em "Reconectar" (e aí passa pelo fluxo
-- normal de "Conectar / novo QR" de novo, já que a sessão foi desconectada da
-- Evolution no momento da remoção). Aditivo e idempotente.

begin;

alter table public.whatsapp_numbers
  add column if not exists archived_at timestamptz;

create index if not exists idx_whatsapp_numbers_archived
  on public.whatsapp_numbers(user_id, archived_at);

commit;
