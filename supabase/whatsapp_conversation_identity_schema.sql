-- whatsapp_conversation_identity_schema.sql
-- Identidade de conversa e remetente para contatos e grupos do WhatsApp.
-- Aditivo e idempotente. Executar DEPOIS de whatsapp_schema.sql.

begin;

alter table public.whatsapp_messages
  add column if not exists is_group     boolean not null default false,
  add column if not exists chat_name    text,
  add column if not exists chat_photo   text,
  add column if not exists sender_name  text,
  add column if not exists sender_phone text,
  add column if not exists sender_photo text;

-- O parser antigo removia o sufixo `-group`. IDs de conversa acima do limite
-- E.164 (15 dígitos) são grupos, não telefones. Preserva todas as mensagens e
-- apenas desfaz o vínculo incorreto com pacientes; nenhum paciente é apagado.
update public.whatsapp_messages
set is_group = true,
    phone = regexp_replace(phone, '[^0-9]', '', 'g') || '-group',
    patient_id = null
where char_length(regexp_replace(phone, '[^0-9]', '', 'g')) > 15
  and phone !~ '-group$';

update public.whatsapp_messages
set is_group = true,
    patient_id = null
where phone ~ '-group$'
  and (is_group = false or patient_id is not null);

create index if not exists idx_whatsapp_group_threads
  on public.whatsapp_messages(user_id, phone, created_at desc)
  where is_group = true;

comment on column public.whatsapp_messages.is_group is 'Conversa coletiva; nunca deve ser vinculada automaticamente a paciente.';
comment on column public.whatsapp_messages.chat_name is 'Nome da conversa/grupo informado pelo provider.';
comment on column public.whatsapp_messages.chat_photo is 'URL temporária da foto da conversa/grupo informada pelo provider.';
comment on column public.whatsapp_messages.sender_name is 'Nome do participante que enviou esta mensagem.';
comment on column public.whatsapp_messages.sender_phone is 'Telefone do participante que enviou esta mensagem em um grupo.';
comment on column public.whatsapp_messages.sender_photo is 'URL temporária da foto do participante informada pelo provider.';

commit;

-- Verificação pós-migração (executar separadamente):
-- select is_group, count(*), count(patient_id) as vinculadas_a_paciente
-- from public.whatsapp_messages group by is_group;
