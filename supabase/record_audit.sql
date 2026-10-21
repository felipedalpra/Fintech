-- record_audit.sql
-- Auditoria POR REGISTRO (resiliência / regra #1): quem criou, editou, arquivou, restaurou ou
-- excluiu cada registro, com snapshot antes/depois. Trigger genérico — SQL puro, sem mudança no app.
-- (Teria tornado trivial o diagnóstico do incidente de 11/10: "quem apagou o quê e quando".)
-- Idempotente. Rodar no SQL Editor do Supabase.

-- 1. Tabela de auditoria.
create table if not exists public.record_audit (
  id         bigint generated always as identity primary key,
  table_name text not null,
  record_id  uuid,
  action     text not null,                 -- insert | update | archive | restore | delete
  actor_id   uuid,                          -- auth.uid() de quem fez (null = service role/sistema)
  owner_id   uuid,                          -- user_id (dono dos dados) da linha
  changed_at timestamptz not null default timezone('utc', now()),
  old_data   jsonb,
  new_data   jsonb
);

create index if not exists idx_record_audit_record on public.record_audit(table_name, record_id, changed_at desc);
create index if not exists idx_record_audit_owner  on public.record_audit(owner_id, changed_at desc);

-- 2. RLS: leitura só para a clínica dona. Snapshots clínicos exigem também acesso clínico.
--    A escrita é feita só pela trigger (SECURITY DEFINER); ninguém insere/edita auditoria à mão.
alter table public.record_audit enable row level security;
do $$ begin
  drop policy if exists "Record audit clinic read" on public.record_audit;
  if to_regprocedure('public.has_clinical_access()') is not null then
    execute $policy$
      create policy "Record audit clinic read" on public.record_audit
      for select to authenticated
      using (
        owner_id = public.data_owner_id()
        and (
          table_name not in ('patient_clinical_profiles', 'medical_records', 'medical_record_addenda', 'clinical_anamneses', 'clinical_documents')
          or public.has_clinical_access()
        )
      )
    $policy$;
  else
    create policy "Record audit clinic read" on public.record_audit
      for select to authenticated
      using (owner_id = public.data_owner_id());
  end if;
end $$;

-- 3. Função genérica de log. Usa acesso via jsonb (v_old/v_new) para funcionar em QUALQUER tabela,
--    tenha ela a coluna archived_at ou não.
create or replace function public.log_record_change()
returns trigger
language plpgsql
security definer
as $$
declare
  v_old jsonb := case when TG_OP in ('UPDATE','DELETE') then to_jsonb(OLD) else null end;
  v_new jsonb := case when TG_OP in ('INSERT','UPDATE') then to_jsonb(NEW) else null end;
  v_action text;
begin
  if TG_OP = 'INSERT' then
    v_action := 'insert';
  elsif TG_OP = 'DELETE' then
    v_action := 'delete';
  else
    -- UPDATE: ignora re-save idêntico (o autosave do financeiro reescreve o dataset inteiro;
    -- sem isso, cada save geraria um log por linha mesmo sem mudança real).
    if v_old = v_new then
      return null;
    elsif (v_old->>'archived_at') is null and (v_new->>'archived_at') is not null then
      v_action := 'archive';
    elsif (v_old->>'archived_at') is not null and (v_new->>'archived_at') is null then
      v_action := 'restore';
    else
      v_action := 'update';
    end if;
  end if;

  insert into public.record_audit(table_name, record_id, action, actor_id, owner_id, old_data, new_data)
  values (
    TG_TABLE_NAME,
    coalesce((v_new->>'id')::uuid, (v_old->>'id')::uuid),
    v_action,
    auth.uid(),
    coalesce((v_new->>'user_id')::uuid, (v_old->>'user_id')::uuid),
    v_old,
    v_new
  );

  return null; -- AFTER trigger
end $$;

-- 4. Liga a trigger nas tabelas que guardam dado do cliente.
do $$
declare
  t text;
  tables text[] := array[
    'surgeries','consultations','expenses','extra_revenues','product_sales','product_purchases',
    'procedures','products','assets','liabilities','goals','patients'
  ];
begin
  foreach t in array tables loop
    execute format('drop trigger if exists trg_record_audit on public.%I', t);
    execute format(
      'create trigger trg_record_audit after insert or update or delete on public.%I for each row execute function public.log_record_change()',
      t
    );
  end loop;
end $$;

-- Consultas úteis:
--   -- histórico de um registro:
--   select changed_at, action, actor_id from public.record_audit
--     where table_name = 'extra_revenues' and record_id = '<id>' order by changed_at desc;
--   -- tudo que um usuário fez num dia:
--   select * from public.record_audit where actor_id = '<uid>' and changed_at::date = '2026-10-11' order by changed_at desc;
--   -- exclusões/arquivamentos recentes (quem apagou o quê):
--   select changed_at, table_name, record_id, action, actor_id, old_data->>'patient' as paciente, old_data->>'value' as valor
--     from public.record_audit where action in ('archive','delete') order by changed_at desc limit 100;
