-- Memória do copiloto financeiro: conversas privadas por usuário e transcript persistido.
-- Aplicar depois de ai_assistant_schema.sql e antes do deploy da UI de conversas.

create table if not exists public.ai_assistant_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Nova conversa',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  last_message_at timestamptz,
  constraint ai_assistant_conversations_title_length check (char_length(title) between 1 and 120)
);

create table if not exists public.ai_assistant_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ai_assistant_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) between 1 and 4000),
  source text,
  mode text,
  reason text,
  evidence jsonb not null default '[]'::jsonb,
  request_id uuid,
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.ai_assistant_conversations enable row level security;
alter table public.ai_assistant_messages enable row level security;

drop policy if exists ai_assistant_conversations_select_own on public.ai_assistant_conversations;
create policy ai_assistant_conversations_select_own on public.ai_assistant_conversations
  for select to authenticated using (user_id = auth.uid());

drop policy if exists ai_assistant_conversations_insert_own on public.ai_assistant_conversations;
create policy ai_assistant_conversations_insert_own on public.ai_assistant_conversations
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists ai_assistant_conversations_update_own on public.ai_assistant_conversations;
create policy ai_assistant_conversations_update_own on public.ai_assistant_conversations
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists ai_assistant_conversations_delete_own on public.ai_assistant_conversations;
create policy ai_assistant_conversations_delete_own on public.ai_assistant_conversations
  for delete to authenticated using (user_id = auth.uid());

drop policy if exists ai_assistant_messages_select_own on public.ai_assistant_messages;
create policy ai_assistant_messages_select_own on public.ai_assistant_messages
  for select to authenticated using (user_id = auth.uid());

drop policy if exists ai_assistant_messages_insert_own on public.ai_assistant_messages;
create policy ai_assistant_messages_insert_own on public.ai_assistant_messages
  for insert to authenticated with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.ai_assistant_conversations c
      where c.id = conversation_id and c.user_id = auth.uid()
    )
  );

revoke all on public.ai_assistant_conversations from anon, authenticated;
revoke all on public.ai_assistant_messages from anon, authenticated;
grant select, insert, update, delete on public.ai_assistant_conversations to authenticated;
grant select on public.ai_assistant_messages to authenticated;

create or replace function public.save_ai_assistant_exchange(
  p_conversation_id uuid,
  p_question text,
  p_answer text,
  p_source text,
  p_mode text,
  p_reason text,
  p_evidence jsonb,
  p_request_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  conversation_title text;
  exchange_time timestamptz := timezone('utc', now());
begin
  if current_user_id is null then raise exception 'authentication required'; end if;
  select title into conversation_title
  from public.ai_assistant_conversations
  where id = p_conversation_id and user_id = current_user_id
  for update;
  if not found then raise exception 'conversation not found'; end if;

  insert into public.ai_assistant_messages (conversation_id, user_id, role, content, source, mode, reason, evidence, request_id, created_at)
  values
    (p_conversation_id, current_user_id, 'user', left(trim(p_question), 4000), null, null, null, '[]'::jsonb, null, exchange_time),
    (p_conversation_id, current_user_id, 'assistant', left(trim(p_answer), 4000), left(p_source, 40), left(p_mode, 40), left(p_reason, 200), coalesce(p_evidence, '[]'::jsonb), p_request_id, exchange_time + interval '1 millisecond');

  update public.ai_assistant_conversations
  set title = case when conversation_title = 'Nova conversa' then left(trim(p_question), 120) else conversation_title end,
      updated_at = exchange_time,
      last_message_at = exchange_time
  where id = p_conversation_id and user_id = current_user_id;
end;
$$;

revoke all on function public.save_ai_assistant_exchange(uuid, text, text, text, text, text, jsonb, uuid) from public, anon;
grant execute on function public.save_ai_assistant_exchange(uuid, text, text, text, text, text, jsonb, uuid) to authenticated;

create index if not exists idx_ai_assistant_conversations_user_updated
  on public.ai_assistant_conversations(user_id, updated_at desc);
create index if not exists idx_ai_assistant_messages_conversation_created
  on public.ai_assistant_messages(conversation_id, created_at asc);

