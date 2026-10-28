-- Repara conversas de grupo antigas importadas antes da persistência correta
-- de is_group. O sufixo é a identidade canônica já usada pelo parser e pela UI.
-- Idempotente: reaplicar não altera linhas já corrigidas.
begin;

update public.whatsapp_messages
set
  is_group = true,
  patient_id = null,
  contact_id = null
where phone ~* '(-group|@g\.us)$'
  and (
    is_group is distinct from true
    or patient_id is not null
    or contact_id is not null
  );

commit;
