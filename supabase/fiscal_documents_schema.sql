-- Documentos fiscais vinculados ao título financeiro canônico.
-- Migração aditiva: não remove nem reescreve lançamentos financeiros existentes.

create table if not exists public.fiscal_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  direction text not null check (direction in ('issued','received')),
  document_type text not null check (document_type in ('nfse','nfe','nfce','receipt','invoice','other')),
  number text not null check (length(trim(number)) > 0),
  series text,
  access_key text,
  verification_code text,
  issue_date date not null,
  competence_date date,
  issuer_name text,
  recipient_name text,
  total_amount numeric(12,2) not null check (total_amount > 0),
  status text not null default 'issued' check (status in ('pending','issued','received','canceled','replaced')),
  notes text,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  archived_at timestamptz
);

create table if not exists public.fiscal_document_allocations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  fiscal_document_id uuid not null references public.fiscal_documents(id) on delete restrict,
  financial_entry_id uuid not null references public.financial_entries(id) on delete restrict,
  allocated_amount numeric(12,2) not null check (allocated_amount > 0),
  created_at timestamptz not null default timezone('utc', now()),
  unique (fiscal_document_id, financial_entry_id)
);

create unique index if not exists uq_fiscal_documents_access_key
  on public.fiscal_documents(user_id, access_key)
  where access_key is not null and length(trim(access_key)) > 0 and archived_at is null;
create index if not exists idx_fiscal_documents_owner_issue
  on public.fiscal_documents(user_id, issue_date desc) where archived_at is null;
create index if not exists idx_fiscal_documents_owner_number
  on public.fiscal_documents(user_id, number) where archived_at is null;
create index if not exists idx_fiscal_allocations_entry
  on public.fiscal_document_allocations(user_id, financial_entry_id);

alter table public.fiscal_documents enable row level security;
alter table public.fiscal_document_allocations enable row level security;

do $$ begin
  drop policy if exists "Fiscal documents clinic access" on public.fiscal_documents;
  drop policy if exists "Fiscal allocations clinic access" on public.fiscal_document_allocations;
  drop policy if exists "Fiscal documents clinic read" on public.fiscal_documents;
  drop policy if exists "Fiscal allocations clinic read" on public.fiscal_document_allocations;
  begin
    create policy "Fiscal documents clinic read" on public.fiscal_documents
      for select to authenticated
      using (
        user_id = (select public.data_owner_id())
        and (select public.finance_role_can_manage())
      );
  exception when duplicate_object then null; end;
  begin
    create policy "Fiscal allocations clinic read" on public.fiscal_document_allocations
      for select to authenticated
      using (
        user_id = (select public.data_owner_id())
        and (select public.finance_role_can_manage())
      );
  exception when duplicate_object then null; end;
end $$;

create or replace function public.create_fiscal_document_for_entry(
  p_financial_entry_id uuid,
  p_document jsonb
) returns public.fiscal_documents
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner uuid := public.data_owner_id();
  v_entry public.financial_entries%rowtype;
  v_document public.fiscal_documents%rowtype;
  v_total numeric(12,2);
  v_allocated numeric(12,2);
  v_existing numeric(12,2);
  v_direction text;
begin
  if auth.uid() is null or v_owner is null or not public.finance_role_can_manage() then
    raise exception 'Sessão inválida.' using errcode = '42501';
  end if;

  select * into v_entry
  from public.financial_entries
  where id = p_financial_entry_id
    and user_id = v_owner
    and archived_at is null
  for update;

  if not found then
    raise exception 'Título financeiro não encontrado.' using errcode = 'P0002';
  end if;

  v_total := round(coalesce(nullif(p_document->>'total_amount', '')::numeric, 0), 2);
  v_allocated := round(coalesce(nullif(p_document->>'allocated_amount', '')::numeric, v_total), 2);
  v_direction := case when v_entry.direction = 'receivable' then 'issued' else 'received' end;

  if length(trim(coalesce(p_document->>'number', ''))) = 0 then
    raise exception 'Informe o número do documento fiscal.' using errcode = '22023';
  end if;
  if v_total <= 0 or v_allocated <= 0 then
    raise exception 'Os valores do documento e da alocação devem ser maiores que zero.' using errcode = '22023';
  end if;
  if v_allocated > v_total then
    raise exception 'A alocação não pode ultrapassar o valor do documento fiscal.' using errcode = '23514';
  end if;

  select coalesce(sum(a.allocated_amount), 0) into v_existing
  from public.fiscal_document_allocations a
  join public.fiscal_documents d on d.id = a.fiscal_document_id
  where a.financial_entry_id = v_entry.id
    and d.archived_at is null
    and d.status not in ('canceled','replaced');

  if v_existing + v_allocated > v_entry.total_amount + 0.01 then
    raise exception 'A soma dos documentos fiscais ultrapassa o valor do título financeiro.' using errcode = '23514';
  end if;

  insert into public.fiscal_documents (
    user_id, direction, document_type, number, series, access_key, verification_code,
    issue_date, competence_date, issuer_name, recipient_name, total_amount, status, notes
  ) values (
    v_owner,
    v_direction,
    coalesce(nullif(p_document->>'document_type', ''), 'nfse'),
    trim(p_document->>'number'),
    nullif(trim(coalesce(p_document->>'series', '')), ''),
    nullif(regexp_replace(coalesce(p_document->>'access_key', ''), '\s', '', 'g'), ''),
    nullif(trim(coalesce(p_document->>'verification_code', '')), ''),
    (p_document->>'issue_date')::date,
    nullif(p_document->>'competence_date', '')::date,
    nullif(trim(coalesce(p_document->>'issuer_name', '')), ''),
    nullif(trim(coalesce(p_document->>'recipient_name', '')), ''),
    v_total,
    coalesce(nullif(p_document->>'status', ''), case when v_direction = 'issued' then 'issued' else 'received' end),
    nullif(trim(coalesce(p_document->>'notes', '')), '')
  ) returning * into v_document;

  insert into public.fiscal_document_allocations (
    user_id, fiscal_document_id, financial_entry_id, allocated_amount
  ) values (v_owner, v_document.id, v_entry.id, v_allocated);

  return v_document;
end;
$$;

revoke all on function public.create_fiscal_document_for_entry(uuid, jsonb) from public;
grant execute on function public.create_fiscal_document_for_entry(uuid, jsonb) to authenticated;

create or replace function public.set_fiscal_document_status(
  p_fiscal_document_id uuid,
  p_status text
) returns public.fiscal_documents
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner uuid := public.data_owner_id();
  v_document public.fiscal_documents%rowtype;
begin
  if auth.uid() is null or v_owner is null or not public.finance_role_can_manage() then
    raise exception 'Sessão inválida.' using errcode = '42501';
  end if;
  if p_status not in ('pending','issued','received','canceled','replaced') then
    raise exception 'Status fiscal inválido.' using errcode = '22023';
  end if;

  select * into v_document
  from public.fiscal_documents
  where id = p_fiscal_document_id
    and user_id = v_owner
    and archived_at is null
  for update;

  if not found then
    raise exception 'Documento fiscal não encontrado.' using errcode = 'P0002';
  end if;
  if v_document.status in ('canceled','replaced') and p_status <> v_document.status then
    raise exception 'Documento fiscal cancelado ou substituído não pode ser reativado.' using errcode = '23514';
  end if;
  if p_status = 'issued' and v_document.direction <> 'issued' then
    raise exception 'Documento recebido não pode assumir status de emissão.' using errcode = '23514';
  end if;
  if p_status = 'received' and v_document.direction <> 'received' then
    raise exception 'Documento emitido não pode assumir status de recebimento.' using errcode = '23514';
  end if;

  update public.fiscal_documents
  set status = p_status,
      updated_at = timezone('utc', now())
  where id = p_fiscal_document_id
    and user_id = v_owner
    and archived_at is null
  returning * into v_document;

  return v_document;
end;
$$;

revoke all on function public.set_fiscal_document_status(uuid, text) from public;
grant execute on function public.set_fiscal_document_status(uuid, text) to authenticated;

comment on table public.fiscal_documents is 'Documento fiscal único; pode ser alocado a um ou mais títulos financeiros.';
comment on table public.fiscal_document_allocations is 'Alocação do documento fiscal ao título; todas as parcelas herdam o vínculo.';

