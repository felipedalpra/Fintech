-- Hotfix: a pre-anamnese usa funcoes do pgcrypto para criar e conferir o
-- token publico. No Supabase, a extensao fica no schema `extensions`; as RPCs
-- foram publicadas com search_path restrito a `public, pg_temp`, por isso
-- `gen_random_bytes(integer)` nao era encontrada ao gerar o link.
--
-- A migration altera somente a resolucao de funcoes. Nenhum link, formulario,
-- consentimento, resposta ou registro clinico existente e reescrito.

begin;

alter function public.create_clinical_consent_template(text, text, text, boolean, uuid)
  set search_path = public, extensions, pg_temp;

alter function public.create_clinical_intake_request(uuid, uuid, uuid[], integer)
  set search_path = public, extensions, pg_temp;

alter function public.get_public_clinical_intake(text)
  set search_path = public, extensions, pg_temp;

alter function public.submit_public_clinical_intake(text, uuid, jsonb, text, uuid[])
  set search_path = public, extensions, pg_temp;

commit;
