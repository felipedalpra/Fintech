-- patient_photo_schema.sql
-- Foto do paciente (Fase 1 dos quick wins visuais). Foto é dado sensível (LGPD) → bucket PRIVADO,
-- escopado por clínica, exibido só via URL assinada de validade curta. Nunca público.
-- Executar DEPOIS de patients_schema.sql e access_control_schema.sql (usa data_owner_id()).

-- 1. Caminho da foto no paciente (ex.: '<ownerId>/<patientId>.jpg'). Null = sem foto (usa iniciais).
alter table public.patients add column if not exists photo_path text;

-- 2. Bucket PRIVADO (public=false). 5 MB, só imagens.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('patient-photos', 'patient-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 3. RLS: a clínica só acessa a própria pasta ((storage.foldername(name))[1] = data_owner_id()).
--    Sem acesso público; a URL assinada exige SELECT, por isso a policy de select escopada.
drop policy if exists "patient-photos clinic insert" on storage.objects;
drop policy if exists "patient-photos clinic select" on storage.objects;
drop policy if exists "patient-photos clinic update" on storage.objects;
drop policy if exists "patient-photos clinic delete" on storage.objects;
do $$ begin
  begin
    create policy "patient-photos clinic insert" on storage.objects
      for insert to authenticated
      with check (bucket_id = 'patient-photos' and (storage.foldername(name))[1] = public.data_owner_id()::text);
  exception when duplicate_object then null; end;
  begin
    create policy "patient-photos clinic select" on storage.objects
      for select to authenticated
      using (bucket_id = 'patient-photos' and (storage.foldername(name))[1] = public.data_owner_id()::text);
  exception when duplicate_object then null; end;
  begin
    create policy "patient-photos clinic update" on storage.objects
      for update to authenticated
      using (bucket_id = 'patient-photos' and (storage.foldername(name))[1] = public.data_owner_id()::text);
  exception when duplicate_object then null; end;
  begin
    create policy "patient-photos clinic delete" on storage.objects
      for delete to authenticated
      using (bucket_id = 'patient-photos' and (storage.foldername(name))[1] = public.data_owner_id()::text);
  exception when duplicate_object then null; end;
end $$;
