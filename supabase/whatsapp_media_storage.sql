-- whatsapp_media_storage.sql
-- WhatsApp · Inbox rico (B2) — bucket de Storage para a mídia ENVIADA (imagem/documento/áudio).
-- O navegador sobe o arquivo direto para o Storage (evita o limite de 1MB do endpoint) e manda a
-- URL para o backend, que repassa à Z-API. Bucket público: a Z-API precisa buscar a URL, e o
-- caminho usa UUID não-adivinhável (mesmo padrão das URLs de mídia recebida da Z-API).
-- Idempotente. Rodar no Supabase SQL Editor.

insert into storage.buckets (id, name, public)
values ('wa-media', 'wa-media', true)
on conflict (id) do nothing;

do $$ begin
  begin
    create policy "wa-media authenticated upload" on storage.objects
      for insert to authenticated with check (bucket_id = 'wa-media');
  exception when duplicate_object then null; end;
  begin
    create policy "wa-media authenticated read" on storage.objects
      for select to authenticated using (bucket_id = 'wa-media');
  exception when duplicate_object then null; end;
end $$;
