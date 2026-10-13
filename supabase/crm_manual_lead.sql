-- crm_manual_lead.sql
-- Lead MANUAL: cria contato (paciente mínimo) + oportunidade a partir de um formulário rápido,
-- sem precisar cadastrar o paciente inteiro. Espelha ensure_whatsapp_lead, mas aceita
-- título/origem/valor/responsável/estágio e é chamada pelo app autenticado (não pelo webhook).
-- Idempotente por telefone: se já existe paciente ATIVO com aquele número na clínica, anexa a
-- oportunidade a ele (não duplica). Retorna a OPORTUNIDADE criada (linha completa).
-- Executar DEPOIS de opportunities_schema.sql e whatsapp_lead_autocreate.sql. Supabase SQL Editor.
--
-- SEGURANÇA (pós code-review): gate robusto a NULL (data_owner_id() nulo → bloqueia),
-- search_path fixo, e EXECUTE só para authenticated (nunca anon/public).

-- Return type mudou (uuid → opportunities); precisa dropar antes do create.
drop function if exists public.create_manual_lead(uuid, text, text, text, text, numeric, uuid, text);

create or replace function public.create_manual_lead(
  p_owner       uuid,
  p_name        text,
  p_phone       text default null,
  p_title       text default null,
  p_source      text default null,
  p_value       numeric default null,
  p_responsible uuid default null,
  p_stage       text default 'primeiro_contato'
)
returns public.opportunities
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_now uuid := public.data_owner_id();
  pid uuid;
  resp uuid := p_responsible;
  val numeric := p_value;
  result public.opportunities;
  phone_digits text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  clean_name text := nullif(btrim(coalesce(p_name, '')), '');
begin
  -- Gate de clínica robusto a NULL: owner precisa existir E bater com a clínica do chamador.
  if p_owner is null or owner_now is null or p_owner is distinct from owner_now then
    raise exception 'Sem permissão para criar lead nesta clínica';
  end if;

  -- Precisa de pelo menos nome ou telefone.
  if clean_name is null and phone_digits = '' then
    raise exception 'Informe ao menos nome ou telefone';
  end if;

  -- Responsável só vale se for o dono ou um membro desta clínica; senão, cai para nulo.
  if resp is not null
     and resp <> p_owner
     and not exists (
       select 1 from public.clinic_members cm
       join public.clinics c on c.id = cm.clinic_id
       where cm.user_id = resp and c.owner_id = p_owner
     ) then
    resp := null;
  end if;

  -- Valor negativo não faz sentido (distorce pipeline/ticket) → nulo.
  if val is not null and val < 0 then val := null; end if;

  -- Já existe paciente ATIVO com esse telefone (só dígitos) nesta clínica?
  if phone_digits <> '' then
    select id into pid
    from public.patients
    where user_id = p_owner
      and active = true
      and regexp_replace(coalesce(phone, ''), '\D', '', 'g') = phone_digits
    limit 1;
  end if;

  -- Cria o paciente mínimo se ainda não existe.
  if pid is null then
    insert into public.patients (user_id, full_name, phone, active)
    values (p_owner, coalesce(clean_name, p_phone), p_phone, true)
    returning id into pid;
  end if;

  insert into public.opportunities (user_id, patient_id, title, stage, status, source, value, responsible_user_id, stage_entered_at)
  values (
    p_owner, pid,
    coalesce(nullif(btrim(coalesce(p_title, '')), ''), 'Oportunidade'),
    coalesce(nullif(p_stage, ''), 'primeiro_contato'),
    'aberto',
    nullif(btrim(coalesce(p_source, '')), ''),
    val,
    resp,
    timezone('utc', now())
  )
  returning * into result;

  insert into public.opportunity_stage_history (opportunity_id, user_id, from_stage, to_stage, moved_by, source)
  values (result.id, p_owner, null, coalesce(nullif(p_stage, ''), 'primeiro_contato'), auth.uid(), 'manual');

  return result;
end $$;

-- EXECUTE só para usuários autenticados (nunca anon/public).
revoke all on function public.create_manual_lead(uuid, text, text, text, text, numeric, uuid, text) from public, anon;
grant execute on function public.create_manual_lead(uuid, text, text, text, text, numeric, uuid, text) to authenticated;
