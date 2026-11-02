-- Arquivamento (soft delete) de documento clinico. Aditiva e idempotente.
--
-- Motivo: um documento emitido por engano -- ou um teste feito durante a
-- configuracao -- ficava para sempre na lista, sem caminho nenhum para sair.
-- A tabela e append-only de proposito (`revoke insert, update, delete ... from
-- authenticated`), e nao tinha coluna de arquivamento.
--
-- NAO e DELETE, e nunca sera: pedido de exames e receita sao documentos de
-- prontuario. O CFM exige guarda por 20 anos, e apagar quebraria a cadeia de
-- auditoria que da valor legal ao registro (regra do projeto: "Prontuario: sem
-- DELETE -- apenas arquivamento"). A linha permanece integra no banco; apenas
-- deixa de aparecer nas telas, e fica gravado QUEM arquivou e QUANDO.

begin;

alter table public.clinical_documents
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references auth.users(id) on delete set null,
  add column if not exists archive_reason text;

-- As telas listam por paciente; o indice acompanha o filtro.
create index if not exists idx_clinical_documents_active
  on public.clinical_documents(user_id, patient_id, created_at desc)
  where archived_at is null;

-- O gatilho generico da fundacao bloqueia TODO update. Documentos continuam
-- imutaveis, mas o arquivamento precisa permitir uma unica transicao controlada
-- sem abrir caminho para editar o conteudo clinico ou apagar a linha.
create or replace function public.prevent_clinical_document_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE'
     and old.archived_at is null
     and new.archived_at is not null
     and new.archived_by is not null
     and (to_jsonb(new) - array['archived_at', 'archived_by', 'archive_reason'])
         = (to_jsonb(old) - array['archived_at', 'archived_by', 'archive_reason']) then
    return new;
  end if;

  raise exception 'Documentos clinicos sao imutaveis; somente o arquivamento e permitido.'
    using errcode = '55000';
end
$$;

drop trigger if exists trg_clinical_documents_immutable on public.clinical_documents;
create trigger trg_clinical_documents_immutable
before update or delete on public.clinical_documents
for each row execute function public.prevent_clinical_document_mutation();

create or replace function public.archive_clinical_document(
  p_document_id uuid,
  p_reason text default null
)
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  owner_now uuid := public.data_owner_id();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_archived timestamptz;
  v_created_by uuid;
begin
  -- Mesmo portao da emissao: quem nao pode emitir nao pode arquivar.
  if auth.uid() is null or owner_now is null or not public.has_clinical_access() then
    raise exception 'Acesso clinico nao autorizado.' using errcode = '42501';
  end if;
  if p_document_id is null then
    raise exception 'Documento nao informado.' using errcode = '22023';
  end if;
  if v_reason is not null and length(v_reason) > 300 then
    raise exception 'Motivo do arquivamento muito longo.' using errcode = '22023';
  end if;

  -- Ja arquivado: devolve a data original em vez de reescrever. Reescrever
  -- apagaria quem arquivou de verdade e quando -- a trilha e o ponto disto.
  select archived_at, created_by into v_archived, v_created_by
  from public.clinical_documents
  where id = p_document_id and user_id = owner_now;
  if not found then
    raise exception 'Documento fora do escopo da clinica.' using errcode = '42501';
  end if;
  if v_archived is not null then
    return v_archived;
  end if;
  -- O autor pode retirar da lista o proprio documento. Owner/admin clinico
  -- pode corrigir documentos legados ou de um profissional indisponivel. Um
  -- membro clinico comum nunca pode esconder o documento de outro autor.
  if v_created_by is distinct from auth.uid() and not public.can_issue_clinical_prescription() then
    raise exception 'Somente o autor ou um administrador clinico pode arquivar este documento.'
      using errcode = '42501';
  end if;

  update public.clinical_documents
  set archived_at = timezone('utc', now()),
      archived_by = auth.uid(),
      archive_reason = v_reason
  where id = p_document_id
    and user_id = owner_now
    and archived_at is null
  returning archived_at into v_archived;

  if v_archived is null then
    raise exception 'O arquivamento nao foi confirmado pelo banco.' using errcode = '40001';
  end if;
  return v_archived;
end
$$;

revoke all on function public.archive_clinical_document(uuid, text) from public, anon;
grant execute on function public.archive_clinical_document(uuid, text) to authenticated;

commit;

-- ---------------------------------------------------------------------------
-- Conferencia
-- ---------------------------------------------------------------------------
-- Esperado: as tres colunas e a funcao.
--
--   select column_name from information_schema.columns
--   where table_schema='public' and table_name='clinical_documents'
--     and column_name in ('archived_at','archived_by','archive_reason');
--
--   select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--   where n.nspname='public' and p.proname='archive_clinical_document';
