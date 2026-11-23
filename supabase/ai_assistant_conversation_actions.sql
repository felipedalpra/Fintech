-- Ações da experiência de conversa: nome, fixação, exclusão e feedback por resposta.
-- Aplicar depois de ai_assistant_conversations_schema.sql.

alter table public.ai_assistant_conversations
  add column if not exists is_pinned boolean not null default false;

alter table public.ai_assistant_messages
  add column if not exists feedback smallint,
  add column if not exists feedback_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'ai_assistant_messages_feedback_value'
      and conrelid = 'public.ai_assistant_messages'::regclass
  ) then
    alter table public.ai_assistant_messages
      add constraint ai_assistant_messages_feedback_value
      check (feedback is null or feedback in (-1, 1));
  end if;
end $$;

create index if not exists idx_ai_assistant_conversations_user_pinned
  on public.ai_assistant_conversations(user_id, is_pinned desc, updated_at desc);

create or replace function public.set_ai_assistant_message_feedback(
  p_message_id uuid,
  p_feedback smallint
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then raise exception 'authentication required'; end if;
  if p_feedback is not null and p_feedback not in (-1, 1) then raise exception 'invalid feedback'; end if;

  update public.ai_assistant_messages
  set feedback = p_feedback,
      feedback_at = case when p_feedback is null then null else timezone('utc', now()) end
  where id = p_message_id
    and user_id = current_user_id
    and role = 'assistant';

  if not found then raise exception 'assistant message not found'; end if;
end;
$$;

revoke all on function public.set_ai_assistant_message_feedback(uuid, smallint) from public, anon;
grant execute on function public.set_ai_assistant_message_feedback(uuid, smallint) to authenticated;

