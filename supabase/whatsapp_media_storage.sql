-- whatsapp_media_storage.sql
-- WhatsApp · Inbox rico (B2) — bucket de Storage para a mídia ENVIADA (imagem/documento/áudio).
-- O navegador sobe o arquivo direto para o Storage (evita o limite de 1MB do endpoint) e manda a
-- URL para o backend, que repassa à Z-API. Bucket público: a Z-API precisa buscar a URL.
-- ISOLAMENTO POR CLÍNICA: o upload só é permitido na pasta da própria clínica (1º segmento do
-- path = data_owner_id()), e NÃO há policy de SELECT para authenticated — assim ninguém LISTA/
-- enumera a mídia de outra clínica (a leitura do arquivo em si é pela URL pública do bucket).
-- Idempotente. Rodar no Supabase SQL Editor.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'wa-media', 'wa-media', true, 16777216,  -- 16 MB (limite prático do WhatsApp)
  array[
    'image/jpeg','image/png','image/webp','image/gif',
    'audio/ogg','audio/mpeg','audio/mp4','audio/aac','audio/webm',
    'video/mp4',
    'application/pdf','application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Remove policies de versões anteriores (inclusive a de SELECT ampla) e recria só o upload escopado.
drop policy if exists "wa-media authenticated upload" on storage.objects;
drop policy if exists "wa-media authenticated read" on storage.objects;
drop policy if exists "wa-media clinic upload" on storage.objects;
do $$ begin
  begin
    create policy "wa-media clinic upload" on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'wa-media'
        and (storage.foldername(name))[1] = public.data_owner_id()::text
      );
  exception when duplicate_object then null; end;
end $$;
