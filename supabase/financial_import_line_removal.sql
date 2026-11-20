-- Remocao auditada de uma unica linha importada.
-- Executar DEPOIS de financial_import_batch_cancellation.sql.
--
-- A operacao e um arquivamento logico: preserva lote, linha e auditoria, mas retira
-- somente a origem financeira duplicada, seu titulo, parcela e entrada do financeiro.

begin;

create or replace function public.archive_financial_import_source(
  p_source_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_owner uuid := public.data_owner_id();
  v_now timestamptz := timezone('utc', now());
  v_reason text := btrim(coalesce(p_reason, ''));
  v_line public.financial_import_lines%rowtype;
  v_batch public.financial_import_batches%rowtype;
  v_entry_id uuid;
  v_installments integer := 0;
  v_reconciliations integer := 0;
  v_charges integer := 0;
  v_fiscal bigint := 0;
  v_source_exists boolean := false;
begin
  if v_actor is null or v_owner is null or not public.finance_role_can_manage() then
    raise exception 'Acesso financeiro nao autorizado.' using errcode = '42501';
  end if;
  if p_source_id is null or length(v_reason) < 3 or length(v_reason) > 500 then
    raise exception 'Informe um motivo entre 3 e 500 caracteres.' using errcode = '22023';
  end if;

  select line.*
    into v_line
  from public.financial_import_lines line
  join public.financial_import_batches batch on batch.id = line.batch_id
  where line.user_id = v_owner
    and line.source_id = p_source_id
    and line.review_status = 'approved'
    and line.archived_at is null
    and batch.user_id = v_owner
    and batch.status in ('reviewing', 'ready')
    and batch.archived_at is null
  for update of line;

  if not found then
    raise exception 'Lançamento importado não encontrado ou já removido.' using errcode = '40400';
  end if;

  select batch.*
    into v_batch
  from public.financial_import_batches batch
  where batch.id = v_line.batch_id
    and batch.user_id = v_owner
    and batch.status in ('reviewing', 'ready')
    and batch.archived_at is null
  for update;

  if v_line.amount > 0 then
    select exists (
      select 1 from public.extra_revenues source
      where source.id = p_source_id and source.user_id = v_owner and source.is_financial_import is true and source.archived_at is null
    ) into v_source_exists;
  else
    select exists (
      select 1 from public.expenses source
      where source.id = p_source_id and source.user_id = v_owner and source.is_financial_import is true and source.archived_at is null
    ) into v_source_exists;
  end if;
  if not v_source_exists then
    raise exception 'A persistência da origem importada está incompleta; nada foi removido.' using errcode = '40001';
  end if;

  select entry.id into v_entry_id
  from public.financial_entries entry
  where entry.user_id = v_owner
    and entry.source_id = p_source_id
    and entry.source_type = case when v_line.amount > 0 then 'extra_revenue' else 'expense' end
    and entry.source_component = 'revenue'
    and entry.archived_at is null
  for update;

  if v_entry_id is null then
    raise exception 'A persistência do lançamento importado está incompleta; nada foi removido.' using errcode = '40001';
  end if;

  select count(*) into v_installments
  from public.financial_installments installment
  where installment.user_id = v_owner
    and installment.financial_entry_id = v_entry_id
    and installment.archived_at is null;
  if v_installments = 0 then
    raise exception 'A persistência da parcela está incompleta; nada foi removido.' using errcode = '40001';
  end if;

  select count(distinct reconciliation.id) into v_reconciliations
  from public.financial_installments installment
  join public.bank_reconciliations reconciliation
    on reconciliation.user_id = v_owner
   and reconciliation.financial_installment_id = installment.id
   and reconciliation.reversed_at is null
  where installment.user_id = v_owner and installment.financial_entry_id = v_entry_id;
  if v_reconciliations > 0 then
    raise exception 'Desfaça a conciliação bancária antes de remover este lançamento.' using errcode = '55000';
  end if;

  select count(distinct charge.id) into v_charges
  from public.financial_installments installment
  join public.billing_charges charge
    on charge.user_id = v_owner
   and charge.financial_installment_id = installment.id
   and charge.status not in ('canceled', 'refunded', 'failed')
  where installment.user_id = v_owner and installment.financial_entry_id = v_entry_id;
  if v_charges > 0 then
    raise exception 'Cancele a cobrança ativa antes de remover este lançamento.' using errcode = '55000';
  end if;

  -- Reaproveita a mesma proteção dinâmica do cancelamento de lote.
  v_fiscal := public.financial_import_fiscal_block_count(v_batch.id);
  if v_fiscal > 0 then
    -- A contagem do lote pode conter outros documentos fiscais; a checagem específica abaixo
    -- evita bloquear uma linha sem vínculo por causa de outra linha do mesmo arquivo.
    if to_regclass('public.fiscal_document_allocations') is not null then
      execute $q$
        select count(distinct document.id)
        from public.fiscal_document_allocations allocation
        join public.fiscal_documents document on document.id = allocation.fiscal_document_id
        where allocation.user_id = $1
          and allocation.financial_entry_id = $2
          and document.archived_at is null
          and document.status not in ('canceled', 'replaced')
      $q$ into v_fiscal using v_owner, v_entry_id;
      if v_fiscal > 0 then
        raise exception 'Cancele ou substitua o documento fiscal antes de remover este lançamento.' using errcode = '55000';
      end if;
    end if;
  end if;

  perform set_config('app.explicit_financial_import_archive', 'on', true);

  update public.financial_installments
  set archived_at = v_now, updated_at = v_now
  where user_id = v_owner and financial_entry_id = v_entry_id and archived_at is null;

  update public.financial_entries
  set archived_at = v_now, updated_at = v_now
  where id = v_entry_id and user_id = v_owner and archived_at is null;

  if v_line.amount > 0 then
    update public.extra_revenues
    set archived_at = v_now
    where id = p_source_id and user_id = v_owner and archived_at is null;
  else
    update public.expenses
    set archived_at = v_now
    where id = p_source_id and user_id = v_owner and archived_at is null;
  end if;

  update public.financial_import_lines
  set archived_at = v_now
  where batch_id = v_line.batch_id and id = v_line.id and user_id = v_owner and archived_at is null;

  insert into public.audit_logs(user_id, actor_id, action, entity_type, entity_id, details)
  values (
    v_owner, v_actor, 'archive_financial_import_source', 'financial_import_line', v_line.id,
    jsonb_build_object('batch_id', v_line.batch_id, 'source_id', p_source_id, 'reason', v_reason, 'archived_at', v_now)
  );

  return jsonb_build_object(
    'line_id', v_line.id,
    'batch_id', v_line.batch_id,
    'source_id', p_source_id,
    'status', 'archived',
    'archived_at', v_now
  );
end
$$;

revoke all on function public.archive_financial_import_source(uuid, text) from public, anon;
grant execute on function public.archive_financial_import_source(uuid, text) to authenticated;

-- O histórico continua mostrando o arquivo original, mas seus totais refletem apenas linhas ativas.
create or replace function public.list_financial_import_history(p_limit integer default 50)
returns table(
  id uuid, file_name text, sheet_name text, status text, line_count integer, created_at timestamptz,
  ready_at timestamptz, canceled_at timestamptz, cancellation_reason text, approved_count bigint,
  rejected_count bigint, pending_count bigint, imported_receipts numeric, imported_expenses numeric,
  active_reconciliation_count bigint, active_charge_count bigint, active_fiscal_document_count bigint
)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_owner uuid := public.data_owner_id();
begin
  if auth.uid() is null or v_owner is null or not public.finance_role_can_manage() then
    raise exception 'Acesso financeiro nao autorizado.' using errcode = '42501';
  end if;
  if p_limit < 1 or p_limit > 100 then raise exception 'O limite do historico deve ficar entre 1 e 100.' using errcode = '22023'; end if;
  return query
  select batch.id, batch.file_name, batch.sheet_name, batch.status, batch.line_count, batch.created_at,
    batch.ready_at, batch.canceled_at, batch.cancellation_reason,
    coalesce(lines.approved_count, 0), coalesce(lines.rejected_count, 0), coalesce(lines.pending_count, 0),
    coalesce(lines.imported_receipts, 0), coalesce(lines.imported_expenses, 0),
    coalesce(blockers.reconciliation_count, 0), coalesce(blockers.charge_count, 0),
    public.financial_import_fiscal_block_count(batch.id)
  from public.financial_import_batches batch
  left join lateral (
    select count(*) filter (where line.review_status = 'approved' and line.archived_at is null) as approved_count,
      count(*) filter (where line.review_status = 'rejected' and line.archived_at is null) as rejected_count,
      count(*) filter (where line.review_status in ('pending', 'edited') and line.archived_at is null) as pending_count,
      coalesce(sum(line.amount) filter (where line.review_status = 'approved' and line.archived_at is null and line.amount > 0), 0) as imported_receipts,
      coalesce(sum(abs(line.amount)) filter (where line.review_status = 'approved' and line.archived_at is null and line.amount < 0), 0) as imported_expenses
    from public.financial_import_lines line where line.batch_id = batch.id and line.user_id = v_owner
  ) lines on true
  left join lateral (
    select count(distinct reconciliation.id) as reconciliation_count,
      count(distinct charge.id) filter (where charge.status not in ('canceled', 'refunded', 'failed')) as charge_count
    from public.financial_import_lines line
    left join public.financial_entries entry on entry.user_id = line.user_id and entry.source_id = line.source_id
      and entry.source_type = case when line.amount > 0 then 'extra_revenue' else 'expense' end and entry.source_component = 'revenue'
    left join public.financial_installments installment on installment.user_id = line.user_id and installment.financial_entry_id = entry.id
    left join public.bank_reconciliations reconciliation on reconciliation.user_id = line.user_id
      and reconciliation.financial_installment_id = installment.id and reconciliation.reversed_at is null
    left join public.billing_charges charge on charge.user_id = line.user_id and charge.financial_installment_id = installment.id
    where line.batch_id = batch.id and line.user_id = v_owner and line.review_status = 'approved' and line.archived_at is null
  ) blockers on true
  where batch.user_id = v_owner order by batch.created_at desc limit p_limit;
end
$$;

revoke all on function public.list_financial_import_history(integer) from public, anon;
grant execute on function public.list_financial_import_history(integer) to authenticated;

commit;

