-- crm_sla_schema.sql
-- SLA de 1ª resposta: marca quando o lead recebeu a PRIMEIRA resposta (mensagem de saída no
-- WhatsApp). O cronômetro (alvo 15 min em horário comercial) é calculado no cliente a partir de
-- created_at (chegada do lead) e first_response_at. Só mede/avisa — não distribui.
-- Executar DEPOIS de opportunities_schema.sql e whatsapp_schema.sql. Supabase SQL Editor.

-- 1. Quando saiu a 1ª resposta pra esta oportunidade (null = ainda aguardando).
alter table public.opportunities add column if not exists first_response_at timestamptz;

-- 2. Trigger: ao inserir uma mensagem de SAÍDA (outbound, não-falha), marca first_response_at nas
--    oportunidades ABERTAS do paciente que ainda não têm resposta. Idempotente (só age quando null).
--    Correlaciona preferindo patient_id; senão pelo telefone (últimos 11 dígitos — tolera o DDI 55).
--    Só marca com mensagem POSTERIOR ao created_at do lead (uma resposta não precede o lead).
create or replace function public.mark_first_response()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.direction <> 'outbound'
     or coalesce(NEW.status, '') = 'failed'
     or coalesce(NEW.phone, '') !~ '\d' then
    return NEW;
  end if;
  update public.opportunities o
    set first_response_at = NEW.created_at,
        updated_at = timezone('utc', now())
  from public.patients p
  where o.patient_id = p.id
    and o.user_id = NEW.user_id
    and o.status = 'aberto'
    and o.first_response_at is null
    and NEW.created_at >= o.created_at
    and (
      case when NEW.patient_id is not null
        then o.patient_id = NEW.patient_id
        else right(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g'), 11)
             = right(regexp_replace(NEW.phone, '\D', '', 'g'), 11)
      end
    );
  return NEW;
end $$;

drop trigger if exists trg_mark_first_response on public.whatsapp_messages;
create trigger trg_mark_first_response
  after insert on public.whatsapp_messages
  for each row execute function public.mark_first_response();

-- 3. BACKFILL (importante): preenche first_response_at com a 1ª mensagem de saída posterior à
--    criação do lead, pra história NÃO aparecer como "sem resposta" e não distorcer a média.
update public.opportunities o
set first_response_at = sub.first_out
from (
  select o2.id as opp_id, min(wm.created_at) as first_out
  from public.opportunities o2
  join public.patients p on p.id = o2.patient_id
  join public.whatsapp_messages wm
    on wm.user_id = o2.user_id
   and wm.direction = 'outbound'
   and coalesce(wm.status, '') <> 'failed'
   and wm.created_at >= o2.created_at
   and (
     wm.patient_id = o2.patient_id
     or (wm.patient_id is null and coalesce(wm.phone, '') ~ '\d'
         and right(regexp_replace(wm.phone, '\D', '', 'g'), 11)
             = right(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g'), 11))
   )
  where o2.first_response_at is null
  group by o2.id
) sub
where o.id = sub.opp_id;

-- 4. Índice para o painel/alertas (leads abertos aguardando 1ª resposta).
create index if not exists idx_opp_awaiting_response
  on public.opportunities(user_id, stage)
  where status = 'aberto' and first_response_at is null;
