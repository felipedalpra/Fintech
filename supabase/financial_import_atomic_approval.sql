-- financial_import_atomic_approval.sql
-- Corrige a persistencia de importacoes retroativas sem apagar nem reidentificar origens existentes.
--
-- 1. A linha de revisao ganha `source_id` proprio, gerado pelo banco. O mesmo arquivo pode existir
--    em clinicas diferentes sem disputar a PK global de extra_revenues/expenses.
-- 2. A origem financeira e o status `approved` sao confirmados na mesma transacao.
-- 3. Origens importadas nao podem ser arquivadas pelo sync generico; a transicao exige uma acao
--    explicita que habilite `app.explicit_financial_import_archive` na transacao.
--
-- A migration e aditiva: nao contem comandos de remocao em massa e nao desarquiva registros historicos.

begin;

alter table public.financial_import_lines
  add column if not exists source_id uuid;

alter table public.extra_revenues
  add column if not exists is_financial_import boolean not null default false;
alter table public.expenses
  add column if not exists is_financial_import boolean not null default false;

-- Linhas que ja produziram uma origem preservam o id historico. Linhas ainda nao aprovadas recebem
-- um UUID novo e independente do arquivo/tenant. Assim nenhum lancamento existente troca de chave.
update public.financial_import_lines line
set source_id = case
  when exists (
    select 1 from public.extra_revenues revenue
    where revenue.id = line.id and revenue.user_id = line.user_id
  ) or exists (
    select 1 from public.expenses expense
    where expense.id = line.id and expense.user_id = line.user_id
  ) then line.id
  else gen_random_uuid()
end
where line.source_id is null;

-- Marca origens historicas sem depender para sempre do texto editavel `origin_label`.
update public.extra_revenues source
set is_financial_import = true
where source.is_financial_import is not true
  and (
    coalesce(source.origin_label, '') ~* '^Importa(cao|ção)\y'
    or exists (
      select 1 from public.financial_import_lines line
      where line.user_id = source.user_id
        and line.source_id = source.id
        and line.review_status = 'approved'
    )
  );

update public.expenses source
set is_financial_import = true
where source.is_financial_import is not true
  and (
    coalesce(source.origin_label, '') ~* '^Importa(cao|ção)\y'
    or exists (
      select 1 from public.financial_import_lines line
      where line.user_id = source.user_id
        and line.source_id = source.id
        and line.review_status = 'approved'
    )
  );

alter table public.financial_import_lines
  alter column source_id set default gen_random_uuid(),
  alter column source_id set not null;

create index if not exists idx_financial_import_lines_source
  on public.financial_import_lines(user_id, source_id);

-- `source_id` e identidade interna, nao entrada do navegador. O trigger sobrescreve qualquer valor
-- enviado no INSERT e impede que uma linha existente seja religada a outra origem.
create or replace function public.enforce_financial_import_source_id()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    new.source_id := gen_random_uuid();
  elsif new.source_id is distinct from old.source_id then
    raise exception 'A origem vinculada a linha de importacao e imutavel.' using errcode = '55000';
  end if;
  return new;
end
$$;

drop trigger if exists trg_financial_import_lines_source_id on public.financial_import_lines;
create trigger trg_financial_import_lines_source_id
before insert or update of source_id on public.financial_import_lines
for each row execute function public.enforce_financial_import_source_id();

create or replace function public.preserve_financial_import_marker()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.is_financial_import is true and new.is_financial_import is not true then
    raise exception 'O marcador de origem importada e imutavel.' using errcode = '55000';
  end if;
  return new;
end
$$;

drop trigger if exists trg_extra_revenues_preserve_import_marker on public.extra_revenues;
create trigger trg_extra_revenues_preserve_import_marker
before update of is_financial_import on public.extra_revenues
for each row execute function public.preserve_financial_import_marker();

drop trigger if exists trg_expenses_preserve_import_marker on public.expenses;
create trigger trg_expenses_preserve_import_marker
before update of is_financial_import on public.expenses
for each row execute function public.preserve_financial_import_marker();

create or replace function public.approve_financial_import_lines(
  p_batch_id uuid,
  p_items jsonb
)
returns table(
  approved_line_id uuid,
  approved_source_id uuid,
  approved_collection text,
  source_created boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_owner uuid := public.data_owner_id();
  v_batch public.financial_import_batches%rowtype;
  v_line public.financial_import_lines%rowtype;
  v_item jsonb;
  v_record jsonb;
  v_line_id uuid;
  v_source_id uuid;
  v_collection text;
  v_chart_account_id uuid;
  v_competence_date date;
  v_category text;
  v_cost_center text;
  v_origin_label text;
  v_entry_id uuid;
  v_source_type text;
  v_direction text;
  v_party_type text;
  v_inserted integer;
  v_seen uuid[] := array[]::uuid[];
  v_approved_count integer := 0;
begin
  if v_actor is null or v_owner is null or not public.finance_role_can_manage() then
    raise exception 'Acesso financeiro nao autorizado.' using errcode = '42501';
  end if;
  if p_batch_id is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Lote ou linhas de importacao invalidos.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 50 then
    raise exception 'Cada aprovacao deve conter entre 1 e 50 linhas.' using errcode = '22023';
  end if;

  select * into v_batch
  from public.financial_import_batches
  where id = p_batch_id
    and user_id = v_owner
    and archived_at is null
    and status in ('reviewing', 'ready')
  for update;

  if not found then
    raise exception 'Lote fora do escopo da clinica ou indisponivel.' using errcode = '42501';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    begin
      v_line_id := (v_item->>'line_id')::uuid;
      v_source_id := (v_item->>'source_id')::uuid;
    exception when invalid_text_representation then
      raise exception 'Identificador de linha ou origem invalido.' using errcode = '22023';
    end;
    v_collection := v_item->>'collection';
    v_record := v_item->'record';

    if v_line_id is null or v_source_id is null or v_record is null
       or v_collection not in ('extraRevenues', 'expenses') then
      raise exception 'Payload de aprovacao incompleto.' using errcode = '22023';
    end if;
    if v_line_id = any(v_seen) then
      raise exception 'A mesma linha foi enviada duas vezes no bloco.' using errcode = '22023';
    end if;
    v_seen := array_append(v_seen, v_line_id);

    select * into v_line
    from public.financial_import_lines
    where batch_id = p_batch_id
      and id = v_line_id
      and user_id = v_owner
      and archived_at is null
    for update;

    if not found then
      raise exception 'Linha de importacao fora do escopo da clinica.' using errcode = '42501';
    end if;
    if v_line.source_id is distinct from v_source_id then
      raise exception 'A origem informada nao pertence a esta linha.' using errcode = '22023';
    end if;
    if v_line.review_status = 'rejected' then
      raise exception 'Linha rejeitada precisa ser reaberta antes da aprovacao.' using errcode = '22023';
    end if;
    if (v_line.amount > 0 and v_collection <> 'extraRevenues')
       or (v_line.amount < 0 and v_collection <> 'expenses') then
      raise exception 'O tipo da origem nao corresponde ao sinal do lancamento.' using errcode = '22023';
    end if;

    v_source_type := case when v_collection = 'extraRevenues' then 'extra_revenue' else 'expense' end;
    v_direction := case when v_collection = 'extraRevenues' then 'receivable' else 'payable' end;
    v_party_type := case when v_collection = 'extraRevenues' then 'other' else 'supplier' end;

    -- Retry e aba antiga sao leitura idempotente: depois de aprovada, a linha nunca regrava a
    -- origem, o titulo ou a parcela com um snapshot possivelmente defasado do navegador.
    if v_line.review_status = 'approved' then
      if not (
        (v_collection = 'extraRevenues' and exists (
          select 1 from public.extra_revenues source
          where source.id = v_source_id and source.user_id = v_owner and source.archived_at is null
        )) or
        (v_collection = 'expenses' and exists (
          select 1 from public.expenses source
          where source.id = v_source_id and source.user_id = v_owner and source.archived_at is null
        ))
      ) or not exists (
        select 1
        from public.financial_entries entry
        join public.financial_installments installment
          on installment.financial_entry_id = entry.id
         and installment.user_id = v_owner
         and installment.archived_at is null
        where entry.user_id = v_owner
          and entry.source_type = v_source_type
          and entry.source_id = v_source_id
          and entry.source_component = 'revenue'
          and entry.archived_at is null
      ) then
        raise exception 'Linha aprovada possui persistencia financeira incompleta; nenhuma regravacao foi feita.'
          using errcode = '40001';
      end if;

      approved_line_id := v_line_id;
      approved_source_id := v_source_id;
      approved_collection := v_collection;
      source_created := false;
      v_approved_count := v_approved_count + 1;
      return next;
      continue;
    end if;

    begin
      v_chart_account_id := nullif(v_record->>'chartAccountId', '')::uuid;
      v_competence_date := coalesce(nullif(v_record->>'competenceDate', '')::date, v_line.posted_date);
    exception when invalid_text_representation or datetime_field_overflow then
      raise exception 'Plano de contas ou competencia invalido.' using errcode = '22023';
    end;

    if v_chart_account_id is not null and not exists (
      select 1 from public.chart_accounts account
      where account.id = v_chart_account_id
        and account.user_id = v_owner
        and account.is_active is not false
    ) then
      raise exception 'Plano de contas fora do escopo da clinica.' using errcode = '42501';
    end if;

    v_category := left(coalesce(nullif(btrim(v_record->>'category'), ''),
      case when v_line.amount > 0 then 'outras_receitas' else 'outros' end), 160);
    v_cost_center := nullif(left(btrim(coalesce(v_record->>'costCenter', '')), 160), '');
    v_origin_label := format('Importacao %s · linha %s', v_batch.file_name, v_line.line_index);

    if v_collection = 'extraRevenues' then
      insert into public.extra_revenues (
        id, user_id, description, category, value, date, received_date, status,
        competence_date, due_date, cost_center, origin_label, chart_account_id,
        is_financial_import, archived_at
      ) values (
        v_source_id, v_owner, coalesce(nullif(btrim(v_line.description), ''), 'Receita importada'),
        v_category, abs(v_line.amount), v_line.posted_date, v_line.posted_date, 'recebido',
        v_competence_date, v_line.posted_date, v_cost_center, v_origin_label,
        v_chart_account_id, true, null
      )
      on conflict (id) do nothing;
      get diagnostics v_inserted = row_count;
      if v_inserted = 0 and not exists (
        select 1 from public.extra_revenues
        where id = v_source_id and user_id = v_owner
      ) then
        raise exception 'Identificador da origem ja pertence a outra clinica.' using errcode = '23505';
      end if;
    else
      insert into public.expenses (
        id, user_id, description, category, value, due_date, payment_date, status,
        competence_date, cost_center, origin_label, chart_account_id,
        is_financial_import, archived_at
      ) values (
        v_source_id, v_owner, coalesce(nullif(btrim(v_line.description), ''), 'Despesa importada'),
        v_category, abs(v_line.amount), v_line.posted_date, v_line.posted_date, 'pago',
        v_competence_date, v_cost_center, v_origin_label, v_chart_account_id, true, null
      )
      on conflict (id) do nothing;
      get diagnostics v_inserted = row_count;
      if v_inserted = 0 and not exists (
        select 1 from public.expenses
        where id = v_source_id and user_id = v_owner
      ) then
        raise exception 'Identificador da origem ja pertence a outra clinica.' using errcode = '23505';
      end if;
    end if;

    -- A origem operacional e o razao precisam confirmar juntos. Sem estas duas escritas, a tela
    -- poderia somar a origem em memoria enquanto auditorias/relatorios relacionais ainda nao a
    -- encontrassem no titulo e na parcela canonicos.
    insert into public.financial_entries (
      user_id, direction, source_type, source_id, source_component, description,
      party_type, party_name_snapshot, category, cost_center, origin_label, chart_account_id,
      competence_date, issue_date, total_amount, status, archived_at, updated_at
    ) values (
      v_owner, v_direction, v_source_type, v_source_id, 'revenue',
      coalesce(nullif(btrim(v_line.description), ''), case when v_line.amount > 0 then 'Receita importada' else 'Despesa importada' end),
      v_party_type, coalesce(nullif(btrim(v_line.description), ''), ''), v_category, v_cost_center,
      v_origin_label, v_chart_account_id, v_competence_date, v_line.posted_date,
      abs(v_line.amount), 'paid', null, timezone('utc', now())
    )
    on conflict (user_id, source_type, source_id, source_component) do update
    set direction = excluded.direction,
        description = excluded.description,
        party_type = excluded.party_type,
        party_name_snapshot = excluded.party_name_snapshot,
        category = excluded.category,
        cost_center = excluded.cost_center,
        origin_label = excluded.origin_label,
        chart_account_id = excluded.chart_account_id,
        competence_date = excluded.competence_date,
        issue_date = excluded.issue_date,
        total_amount = excluded.total_amount,
        status = excluded.status,
        archived_at = null,
        updated_at = excluded.updated_at
    returning id into v_entry_id;

    insert into public.financial_installments (
      user_id, financial_entry_id, installment_number, amount, paid_amount, due_date,
      settlement_date, payment_method, fees_amount, interest_amount, discount_amount,
      status, archived_at, updated_at
    ) values (
      v_owner, v_entry_id, 1, abs(v_line.amount), abs(v_line.amount), v_line.posted_date,
      v_line.posted_date, null, 0, 0, 0, 'paid', null, timezone('utc', now())
    )
    on conflict (financial_entry_id, installment_number) do update
    set amount = excluded.amount,
        paid_amount = excluded.paid_amount,
        due_date = excluded.due_date,
        settlement_date = excluded.settlement_date,
        status = excluded.status,
        archived_at = null,
        updated_at = excluded.updated_at;

    update public.financial_import_lines
    set review_status = 'approved',
        reviewed_by = v_actor,
        reviewed_at = coalesce(reviewed_at, timezone('utc', now()))
    where batch_id = p_batch_id
      and id = v_line_id
      and source_id = v_source_id
      and user_id = v_owner;

    if not found then
      raise exception 'O banco nao confirmou o progresso da linha.' using errcode = '40001';
    end if;

    approved_line_id := v_line_id;
    approved_source_id := v_source_id;
    approved_collection := v_collection;
    source_created := v_inserted = 1;
    v_approved_count := v_approved_count + 1;
    return next;
  end loop;

  insert into public.audit_logs(user_id, actor_id, action, entity_type, entity_id, details)
  values (
    v_owner,
    v_actor,
    'approve_financial_import_lines',
    'financial_import_batch',
    p_batch_id,
    jsonb_build_object('approved_count', v_approved_count, 'line_ids', to_jsonb(v_seen))
  );
end
$$;

revoke all on function public.approve_financial_import_lines(uuid, jsonb) from public, anon;
grant execute on function public.approve_financial_import_lines(uuid, jsonb) to authenticated;

-- Defesa no banco contra clientes antigos/abas defasadas: retirar uma origem importada do estado
-- local nao equivale a pedir arquivamento. Uma futura acao explicita pode habilitar a flag abaixo
-- na propria transacao depois de validar permissao, motivo e auditoria.
create or replace function public.prevent_implicit_financial_import_archive()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old jsonb := to_jsonb(old);
  v_owner uuid := nullif(v_old->>'user_id', '')::uuid;
  v_source_id uuid := case
    when tg_table_name = 'financial_entries' then nullif(v_old->>'source_id', '')::uuid
    else nullif(v_old->>'id', '')::uuid
  end;
  v_linked_import boolean := false;
begin
  if v_owner is not null and v_source_id is not null then
    select exists (
      select 1 from public.financial_import_lines line
      where line.user_id = v_owner
        and line.source_id = v_source_id
        and line.review_status = 'approved'
    ) into v_linked_import;
  end if;

  if old.archived_at is null
     and new.archived_at is not null
     and (v_linked_import
       or coalesce((v_old->>'is_financial_import')::boolean, false)
       or coalesce(v_old->>'origin_label', '') ~* '^Importa(cao|ção)\y')
     and coalesce(current_setting('app.explicit_financial_import_archive', true), '') <> 'on' then
    raise exception 'Lancamento importado so pode ser arquivado por uma acao explicita e auditavel.'
      using errcode = '55000';
  end if;
  return new;
end
$$;

drop trigger if exists trg_extra_revenues_protect_import_archive on public.extra_revenues;
create trigger trg_extra_revenues_protect_import_archive
before update of archived_at on public.extra_revenues
for each row execute function public.prevent_implicit_financial_import_archive();

drop trigger if exists trg_expenses_protect_import_archive on public.expenses;
create trigger trg_expenses_protect_import_archive
before update of archived_at on public.expenses
for each row execute function public.prevent_implicit_financial_import_archive();

drop trigger if exists trg_financial_entries_protect_import_archive on public.financial_entries;
create trigger trg_financial_entries_protect_import_archive
before update of archived_at on public.financial_entries
for each row execute function public.prevent_implicit_financial_import_archive();

commit;

-- Conferencia somente leitura depois de aplicar:
-- select count(*) filter (where source_id is null) as sem_source_id,
--        count(*) as linhas
-- from public.financial_import_lines;
-- select proname from pg_proc where proname = 'approve_financial_import_lines';
