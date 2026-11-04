-- Descarte seguro de uma revisão de importação que NUNCA entrou no financeiro.
-- Executar DEPOIS de financial_import_batches_schema.sql, financial_import_atomic_approval.sql
-- e financial_import_batch_cancellation.sql.
--
-- Diferença entre DESCARTAR e CANCELAR:
--   descartar = a revisão nunca virou lançamento (nenhuma linha aprovada). Some da lista de
--               trabalho, libera o arquivo para nova importação e nao toca no financeiro.
--   cancelar  = a revisao JA virou lancamento. Retira os lancamentos do financeiro.
--
-- Por isso o descarte RECUSA um lote com linha aprovada: arquivar o lote por cima de lancamentos
-- vivos deixaria origens no financeiro sem nenhum lote cancelavel para retira-las depois.
-- Como o cancelamento, nada e apagado: lote e linhas ficam arquivados e a acao vai para audit_logs.

begin;

create or replace function public.discard_financial_import_batch(
  p_batch_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_owner uuid := public.data_owner_id();
  v_batch public.financial_import_batches%rowtype;
  v_now timestamptz := timezone('utc', now());
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_approved integer := 0;
  v_lines integer := 0;
begin
  if v_actor is null or v_owner is null or not public.finance_role_can_manage() then
    raise exception 'Acesso financeiro nao autorizado.' using errcode = '42501';
  end if;
  if p_batch_id is null then
    raise exception 'Informe a importacao a descartar.' using errcode = '22023';
  end if;
  if v_reason is not null and length(v_reason) > 500 then
    raise exception 'O motivo do descarte deve ter no maximo 500 caracteres.' using errcode = '22023';
  end if;

  select * into v_batch
  from public.financial_import_batches
  where id = p_batch_id and user_id = v_owner
  for update;

  if not found then
    raise exception 'Importacao nao encontrada para esta clinica.' using errcode = '42501';
  end if;

  -- Repetir o descarte e inofensivo: devolve o estado atual sem rearquivar.
  if v_batch.status = 'archived' then
    return jsonb_build_object(
      'batch_id', v_batch.id, 'status', 'archived', 'already_discarded', true);
  end if;
  if v_batch.status = 'canceled' then
    raise exception 'Uma importacao cancelada ja saiu do financeiro e nao precisa ser descartada.'
      using errcode = '22023';
  end if;

  -- Serializa contra uma aprovacao concorrente do mesmo lote.
  perform 1 from public.financial_import_lines
  where batch_id = p_batch_id and user_id = v_owner
  for update;

  select count(*) filter (where line.review_status = 'approved'), count(*)
  into v_approved, v_lines
  from public.financial_import_lines line
  where line.batch_id = p_batch_id and line.user_id = v_owner;

  if v_approved > 0 then
    raise exception 'Esta importacao ja tem % lancamento(s) no financeiro. Use cancelar, que retira os lancamentos, em vez de descartar.', v_approved
      using errcode = '55000';
  end if;

  update public.financial_import_lines
  set archived_at = v_now
  where batch_id = p_batch_id and user_id = v_owner and archived_at is null;

  update public.financial_import_batches
  set status = 'archived',
      archived_at = v_now,
      cancellation_reason = coalesce(v_reason, cancellation_reason)
  where id = p_batch_id and user_id = v_owner;

  if not found then
    raise exception 'O banco nao confirmou o descarte desta revisao.' using errcode = '40001';
  end if;

  insert into public.audit_logs(user_id, actor_id, action, entity_type, entity_id, details)
  values (
    v_owner, v_actor, 'discard_financial_import_batch', 'financial_import_batch', p_batch_id,
    jsonb_build_object('reason', v_reason, 'line_count', v_lines, 'file_name', v_batch.file_name)
  );

  return jsonb_build_object(
    'batch_id', p_batch_id,
    'status', 'archived',
    'line_count', v_lines,
    'discarded_at', v_now
  );
end
$$;

revoke all on function public.discard_financial_import_batch(uuid, text) from public, anon;
grant execute on function public.discard_financial_import_batch(uuid, text) to authenticated;

commit;

-- Conferência após aplicar:
-- select proname from pg_proc where proname = 'discard_financial_import_batch';
