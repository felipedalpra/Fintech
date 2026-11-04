-- Histórico e cancelamento seguro de importações financeiras retroativas.
-- Executar DEPOIS de financial_import_batches_schema.sql e
-- financial_import_atomic_approval.sql.
--
-- O cancelamento é lógico e atômico: nenhum dado é apagado. Origens, títulos e parcelas ficam
-- arquivados, o lote permanece consultável no histórico e a ação é registrada em audit_logs.
-- Uma importação conciliada ou com cobrança ativa deve ser desvinculada/cancelada antes.

begin;

alter table public.financial_import_batches
  add column if not exists canceled_at timestamptz,
  add column if not exists canceled_by uuid references auth.users(id) on delete set null,
  add column if not exists cancellation_reason text,
  add column if not exists cancellation_summary jsonb not null default '{}'::jsonb;

alter table public.financial_import_batches
  drop constraint if exists financial_import_batches_status_check;
alter table public.financial_import_batches
  add constraint financial_import_batches_status_check
  check (status in ('creating', 'reviewing', 'ready', 'canceled', 'archived'));

-- Cancelar libera uma nova importação do mesmo arquivo/aba sem apagar o lote anterior.
drop index if exists public.uq_financial_import_active_file;
create unique index uq_financial_import_active_file
  on public.financial_import_batches(user_id, file_hash, coalesce(sheet_name, ''))
  where archived_at is null and status not in ('archived', 'canceled');

-- Bloqueio adicional: documento fiscal alocado ao titulo.
-- `fiscal_document_allocations` referencia `financial_entries` com ON DELETE RESTRICT; arquivar o
-- titulo por tras de um documento fiscal vivo deixaria a nota apontando para um lancamento que
-- saiu do financeiro. A contagem e DINAMICA porque fiscal_documents_schema.sql pode nao ter sido
-- aplicado neste banco ainda: sem o to_regclass, o historico inteiro quebraria com "relation does
-- not exist" em vez de degradar.
create or replace function public.financial_import_fiscal_block_count(
  p_batch_id uuid
) returns bigint
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner uuid := public.data_owner_id();
  v_count bigint := 0;
begin
  -- SECURITY DEFINER: o dono NUNCA vem do parametro. Receber o owner de fora deixaria qualquer
  -- autenticado contar vinculos de outra clinica.
  if auth.uid() is null or v_owner is null or not public.finance_role_can_manage() then
    raise exception 'Acesso financeiro nao autorizado.' using errcode = '42501';
  end if;
  if to_regclass('public.fiscal_document_allocations') is null
     or to_regclass('public.fiscal_documents') is null then
    return 0;
  end if;

  execute $q$
    select count(distinct document.id)
    from public.financial_import_lines line
    join public.financial_entries entry
      on entry.user_id = line.user_id
     and entry.source_id = line.source_id
     and entry.source_type = case when line.amount > 0 then 'extra_revenue' else 'expense' end
     and entry.source_component = 'revenue'
    join public.fiscal_document_allocations allocation
      on allocation.user_id = line.user_id and allocation.financial_entry_id = entry.id
    join public.fiscal_documents document
      on document.id = allocation.fiscal_document_id
     and document.archived_at is null
     and document.status not in ('canceled', 'replaced')
    where line.batch_id = $1
      and line.user_id = $2
      and line.review_status = 'approved'
  $q$ into v_count using p_batch_id, v_owner;

  return coalesce(v_count, 0);
end
$$;

create or replace function public.list_financial_import_history(p_limit integer default 50)
returns table(
  id uuid,
  file_name text,
  sheet_name text,
  status text,
  line_count integer,
  created_at timestamptz,
  ready_at timestamptz,
  canceled_at timestamptz,
  cancellation_reason text,
  approved_count bigint,
  rejected_count bigint,
  pending_count bigint,
  imported_receipts numeric,
  imported_expenses numeric,
  active_reconciliation_count bigint,
  active_charge_count bigint,
  active_fiscal_document_count bigint
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner uuid := public.data_owner_id();
begin
  if auth.uid() is null or v_owner is null or not public.finance_role_can_manage() then
    raise exception 'Acesso financeiro nao autorizado.' using errcode = '42501';
  end if;
  if p_limit < 1 or p_limit > 100 then
    raise exception 'O limite do historico deve ficar entre 1 e 100.' using errcode = '22023';
  end if;

  return query
  select batch.id, batch.file_name, batch.sheet_name, batch.status, batch.line_count,
    batch.created_at, batch.ready_at, batch.canceled_at, batch.cancellation_reason,
    coalesce(lines.approved_count, 0), coalesce(lines.rejected_count, 0),
    coalesce(lines.pending_count, 0), coalesce(lines.imported_receipts, 0),
    coalesce(lines.imported_expenses, 0), coalesce(blockers.reconciliation_count, 0),
    coalesce(blockers.charge_count, 0),
    public.financial_import_fiscal_block_count(batch.id)
  from public.financial_import_batches batch
  left join lateral (
    select
      count(*) filter (where line.review_status = 'approved') as approved_count,
      count(*) filter (where line.review_status = 'rejected') as rejected_count,
      count(*) filter (where line.review_status in ('pending', 'edited')) as pending_count,
      coalesce(sum(line.amount) filter (where line.review_status = 'approved' and line.amount > 0), 0) as imported_receipts,
      coalesce(sum(abs(line.amount)) filter (where line.review_status = 'approved' and line.amount < 0), 0) as imported_expenses
    from public.financial_import_lines line
    where line.batch_id = batch.id and line.user_id = v_owner
  ) lines on true
  left join lateral (
    select count(distinct reconciliation.id) as reconciliation_count,
           count(distinct charge.id) filter (
             where charge.status not in ('canceled', 'refunded', 'failed')
           ) as charge_count
    from public.financial_import_lines line
    left join public.financial_entries entry
      on entry.user_id = line.user_id
     and entry.source_id = line.source_id
     and entry.source_type = case when line.amount > 0 then 'extra_revenue' else 'expense' end
     and entry.source_component = 'revenue'
    left join public.financial_installments installment
      on installment.user_id = line.user_id and installment.financial_entry_id = entry.id
    left join public.bank_reconciliations reconciliation
      on reconciliation.user_id = line.user_id
     and reconciliation.financial_installment_id = installment.id
     and reconciliation.reversed_at is null
    left join public.billing_charges charge
      on charge.user_id = line.user_id and charge.financial_installment_id = installment.id
    where line.batch_id = batch.id
      and line.user_id = v_owner
      and line.review_status = 'approved'
  ) blockers on true
  where batch.user_id = v_owner
  order by batch.created_at desc
  limit p_limit;
end
$$;

create or replace function public.cancel_financial_import_batch(
  p_batch_id uuid,
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
  v_batch public.financial_import_batches%rowtype;
  v_now timestamptz := timezone('utc', now());
  v_reason text := btrim(coalesce(p_reason, ''));
  v_approved integer := 0;
  v_sources integer := 0;
  v_entries integer := 0;
  v_installments integer := 0;
  v_reconciliations integer := 0;
  v_charges integer := 0;
  v_fiscal bigint := 0;
  v_source_ids jsonb := '[]'::jsonb;
  v_summary jsonb;
begin
  if v_actor is null or v_owner is null or not public.finance_role_can_manage() then
    raise exception 'Acesso financeiro nao autorizado.' using errcode = '42501';
  end if;
  if p_batch_id is null or length(v_reason) < 3 or length(v_reason) > 500 then
    raise exception 'Informe um motivo de cancelamento entre 3 e 500 caracteres.' using errcode = '22023';
  end if;

  select * into v_batch
  from public.financial_import_batches
  where id = p_batch_id and user_id = v_owner
  for update;

  if not found then
    raise exception 'Importacao nao encontrada para esta clinica.' using errcode = '42501';
  end if;
  if v_batch.status = 'canceled' then
    return coalesce(v_batch.cancellation_summary, '{}'::jsonb)
      || jsonb_build_object('batch_id', v_batch.id, 'status', 'canceled', 'already_canceled', true);
  end if;
  if v_batch.status not in ('reviewing', 'ready') then
    raise exception 'Somente uma importacao em revisao ou concluida pode ser cancelada.' using errcode = '22023';
  end if;

  -- Serializa cancelamento e aprovação concorrentes do mesmo lote.
  perform 1 from public.financial_import_lines
  where batch_id = p_batch_id and user_id = v_owner
  for update;

  select count(*), coalesce(jsonb_agg(line.source_id order by line.line_index), '[]'::jsonb)
  into v_approved, v_source_ids
  from public.financial_import_lines line
  where line.batch_id = p_batch_id
    and line.user_id = v_owner
    and line.review_status = 'approved';

  if v_approved = 0 then
    raise exception 'Esta importacao nao possui lancamentos aprovados para cancelar.' using errcode = '22023';
  end if;

  -- Cada linha aprovada deve continuar apontando para sua origem, título e parcela imutáveis.
  select count(*) into v_sources
  from public.financial_import_lines line
  where line.batch_id = p_batch_id and line.user_id = v_owner and line.review_status = 'approved'
    and (
      (line.amount > 0 and exists (
        select 1 from public.extra_revenues source
        where source.id = line.source_id and source.user_id = v_owner and source.is_financial_import is true
      ))
      or
      (line.amount < 0 and exists (
        select 1 from public.expenses source
        where source.id = line.source_id and source.user_id = v_owner and source.is_financial_import is true
      ))
    );

  select count(*) into v_entries
  from public.financial_import_lines line
  where line.batch_id = p_batch_id and line.user_id = v_owner and line.review_status = 'approved'
    and exists (
      select 1 from public.financial_entries entry
      where entry.user_id = v_owner and entry.source_id = line.source_id
        and entry.source_type = case when line.amount > 0 then 'extra_revenue' else 'expense' end
        and entry.source_component = 'revenue'
    );

  select count(*) into v_installments
  from public.financial_import_lines line
  where line.batch_id = p_batch_id and line.user_id = v_owner and line.review_status = 'approved'
    and exists (
      select 1 from public.financial_entries entry
      join public.financial_installments installment
        on installment.financial_entry_id = entry.id and installment.user_id = v_owner
      where entry.user_id = v_owner and entry.source_id = line.source_id
        and entry.source_type = case when line.amount > 0 then 'extra_revenue' else 'expense' end
        and entry.source_component = 'revenue'
    );

  if v_sources <> v_approved or v_entries <> v_approved or v_installments <> v_approved then
    raise exception 'A importacao possui persistencia financeira incompleta; nada foi cancelado.'
      using errcode = '40001';
  end if;

  select count(distinct reconciliation.id) into v_reconciliations
  from public.financial_import_lines line
  join public.financial_entries entry
    on entry.user_id = line.user_id and entry.source_id = line.source_id
   and entry.source_type = case when line.amount > 0 then 'extra_revenue' else 'expense' end
   and entry.source_component = 'revenue'
  join public.financial_installments installment
    on installment.user_id = line.user_id and installment.financial_entry_id = entry.id
  join public.bank_reconciliations reconciliation
    on reconciliation.user_id = line.user_id
   and reconciliation.financial_installment_id = installment.id
   and reconciliation.reversed_at is null
  where line.batch_id = p_batch_id and line.user_id = v_owner and line.review_status = 'approved';

  select count(distinct charge.id) into v_charges
  from public.financial_import_lines line
  join public.financial_entries entry
    on entry.user_id = line.user_id and entry.source_id = line.source_id
   and entry.source_type = case when line.amount > 0 then 'extra_revenue' else 'expense' end
   and entry.source_component = 'revenue'
  join public.financial_installments installment
    on installment.user_id = line.user_id and installment.financial_entry_id = entry.id
  join public.billing_charges charge
    on charge.user_id = line.user_id and charge.financial_installment_id = installment.id
   and charge.status not in ('canceled', 'refunded', 'failed')
  where line.batch_id = p_batch_id and line.user_id = v_owner and line.review_status = 'approved';

  if v_reconciliations > 0 then
    raise exception 'Esta importacao possui % lancamento(s) conciliado(s). Reverta as conciliacoes antes de cancelar.', v_reconciliations
      using errcode = '55000';
  end if;
  if v_charges > 0 then
    raise exception 'Esta importacao possui % cobranca(s) ativa(s). Cancele as cobrancas antes de cancelar.', v_charges
      using errcode = '55000';
  end if;

  v_fiscal := public.financial_import_fiscal_block_count(p_batch_id);
  if v_fiscal > 0 then
    raise exception 'Esta importacao possui % documento(s) fiscal(is) vinculado(s). Cancele ou substitua o documento fiscal antes de cancelar a importacao.', v_fiscal
      using errcode = '55000';
  end if;

  perform set_config('app.explicit_financial_import_archive', 'on', true);

  update public.financial_installments installment
  set archived_at = v_now, updated_at = v_now
  where installment.user_id = v_owner and installment.archived_at is null
    and exists (
      select 1 from public.financial_entries entry
      join public.financial_import_lines line
        on line.user_id = entry.user_id and line.source_id = entry.source_id
       and entry.source_type = case when line.amount > 0 then 'extra_revenue' else 'expense' end
       and entry.source_component = 'revenue'
      where entry.id = installment.financial_entry_id
        and line.batch_id = p_batch_id and line.review_status = 'approved'
    );

  update public.financial_entries entry
  set archived_at = v_now, updated_at = v_now
  where entry.user_id = v_owner and entry.archived_at is null and entry.source_component = 'revenue'
    and exists (
      select 1 from public.financial_import_lines line
      where line.batch_id = p_batch_id and line.user_id = v_owner
        and line.review_status = 'approved' and line.source_id = entry.source_id
        and entry.source_type = case when line.amount > 0 then 'extra_revenue' else 'expense' end
    );

  update public.extra_revenues source
  set archived_at = v_now
  where source.user_id = v_owner and source.archived_at is null and source.is_financial_import is true
    and exists (
      select 1 from public.financial_import_lines line
      where line.batch_id = p_batch_id and line.user_id = v_owner
        and line.review_status = 'approved' and line.amount > 0 and line.source_id = source.id
    );

  update public.expenses source
  set archived_at = v_now
  where source.user_id = v_owner and source.archived_at is null and source.is_financial_import is true
    and exists (
      select 1 from public.financial_import_lines line
      where line.batch_id = p_batch_id and line.user_id = v_owner
        and line.review_status = 'approved' and line.amount < 0 and line.source_id = source.id
    );

  v_summary := jsonb_build_object(
    'batch_id', p_batch_id,
    'status', 'canceled',
    'approved_count', v_approved,
    'source_ids', v_source_ids,
    'canceled_at', v_now
  );

  update public.financial_import_batches
  set status = 'canceled', canceled_at = v_now, canceled_by = v_actor,
      cancellation_reason = v_reason, cancellation_summary = v_summary
  where id = p_batch_id and user_id = v_owner;

  insert into public.audit_logs(user_id, actor_id, action, entity_type, entity_id, details)
  values (
    v_owner, v_actor, 'cancel_financial_import_batch', 'financial_import_batch', p_batch_id,
    jsonb_build_object('reason', v_reason, 'approved_count', v_approved, 'source_ids', v_source_ids)
  );

  return v_summary;
end
$$;

revoke all on function public.financial_import_fiscal_block_count(uuid) from public, anon;
revoke all on function public.list_financial_import_history(integer) from public, anon;
revoke all on function public.cancel_financial_import_batch(uuid, text) from public, anon;
grant execute on function public.financial_import_fiscal_block_count(uuid) to authenticated;
grant execute on function public.list_financial_import_history(integer) to authenticated;
grant execute on function public.cancel_financial_import_batch(uuid, text) to authenticated;

commit;

-- Conferência após aplicar:
-- select proname from pg_proc
-- where proname in ('list_financial_import_history', 'cancel_financial_import_batch',
--                   'financial_import_fiscal_block_count');
