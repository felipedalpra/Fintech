-- whatsapp_lid_routing_schema.sql
-- Identidade canônica de chats individuais após a adoção de Linked IDs (@lid)
-- pelo WhatsApp. Aditivo, idempotente e sem DELETE.
-- Executar DEPOIS de whatsapp_conversation_identity_schema.sql.

begin;

alter table public.whatsapp_messages
  add column if not exists chat_lid      text,
  add column if not exists contact_phone text;

-- Endereços novos que já preservam o sufixo podem ser copiados com segurança.
update public.whatsapp_messages
set chat_lid = lower(phone)
where is_group = false
  and chat_lid is null
  and phone ~* '^[0-9]+@lid$';

-- O parser antigo removia `@lid`, deixando IDs privados de 14/15 dígitos com
-- aparência de telefone. O SurgiMetrics opera com números brasileiros de até
-- 13 dígitos com DDI; apenas preenchemos o alias, sem reescrever `phone`,
-- paciente, conteúdo, direção ou datas.
update public.whatsapp_messages
set chat_lid = regexp_replace(phone, '[^0-9]', '', 'g') || '@lid'
where is_group = false
  and chat_lid is null
  and phone ~ '^[0-9]+$'
  and char_length(phone) between 14 and 15;

-- Telefones brasileiros históricos permanecem disponíveis separadamente do
-- endereço canônico. A sincronização da Z-API usa esse valor para obter o LID.
update public.whatsapp_messages
set contact_phone = regexp_replace(phone, '[^0-9]', '', 'g')
where is_group = false
  and contact_phone is null
  and phone ~ '^[0-9]+$'
  and char_length(phone) between 10 and 13;

create index if not exists idx_whatsapp_chat_lid
  on public.whatsapp_messages(user_id, whatsapp_number_id, chat_lid, created_at desc)
  where chat_lid is not null and is_group = false;

comment on column public.whatsapp_messages.chat_lid is 'Linked ID canônico do chat individual informado pelo WhatsApp; não é telefone.';
comment on column public.whatsapp_messages.contact_phone is 'Telefone real quando fornecido pelo provider, mantido separado do chat_lid.';

commit;

-- Verificação pós-migração (somente leitura):
-- select count(*) filter (where chat_lid is not null) as com_lid,
--        count(*) filter (where contact_phone is not null) as com_telefone
-- from public.whatsapp_messages
-- where is_group = false;
