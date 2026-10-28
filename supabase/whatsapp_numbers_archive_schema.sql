-- whatsapp_numbers_archive_schema.sql
-- Permite "excluir" um número da tela de Configurações → WhatsApp sem apagar nada:
-- mensagens, histórico e o próprio cadastro continuam intactos. Um número removido
-- só volta a aparecer quando o admin clica em "Reconectar" (e aí passa pelo fluxo
-- normal de "Conectar / novo QR" de novo, já que a sessão foi desconectada da
-- Evolution no momento da remoção). Aditivo e idempotente.

begin;

alter table public.whatsapp_numbers
  add column if not exists archived_at timestamptz;

-- A tabela usa grants por coluna para nunca expor credenciais no navegador.
-- O estado de arquivamento é metadado operacional seguro e precisa acompanhar
-- os demais campos públicos usados pelos seletores.
grant select (archived_at) on public.whatsapp_numbers to authenticated;

create index if not exists idx_whatsapp_numbers_archived
  on public.whatsapp_numbers(user_id, archived_at);

commit;
