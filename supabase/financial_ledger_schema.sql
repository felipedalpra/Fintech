-- financial_ledger_schema.sql
-- Fase 1 (fundação) do razão financeiro canônico — ADITIVO, idempotente, reversível.
-- Cria as tabelas do razão (títulos + parcelas). NESTA fase o app ainda NÃO lê daqui (projeção):
-- as tabelas ficam prontas para o backfill e validação antes de migrar a autoridade.
-- Design: docs/superpowers/specs/2026-10-12-financial-core-ledger-design.md
-- Executar DEPOIS de: access_control_schema.sql, erp_relational_schema.sql, competence_date_migration.sql.

-- 1. Títulos (conta a pagar/receber).
create table if not exists public.financial_entries (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users(id) on delete cascade,  -- dono/clínica
  direction            text not null check (direction in ('receivable','payable')),
  source_type          text not null,  -- surgery | consultation | product_sale | product_purchase | expense | extra_revenue
  source_id            uuid not null,
  source_component     text not null default 'revenue',  -- revenue | hospital_cost | anesthesia_cost | material_cost | other_cost | invoice_tax ...
  description          text,
  party_type           text,           -- patient | supplier | other
  party_id             uuid,
  party_name_snapshot  text,           -- nome preservado no momento do lançamento
  category             text,
  cost_center          text,
  origin_label         text,
  competence_date      date,           -- DRE
  issue_date           date,           -- criação do título
  total_amount         numeric(12,2) not null default 0,
  status               text not null default 'pending'
                         check (status in ('pending','partially_paid','paid','canceled','refunded')),
  created_at           timestamptz not null default timezone('utc', now()),
  updated_at           timestamptz not null default timezone('utc', now()),
  archived_at          timestamptz
);

-- Unicidade por origem: evita gerar o mesmo título 2x (autosave/recorrências/backfill repetível).
create unique index if not exists uq_financial_entries_source
  on public.financial_entries(user_id, source_type, source_id, source_component);
create index if not exists idx_financial_entries_owner    on public.financial_entries(user_id) where archived_at is null;
create index if not exists idx_financial_entries_party    on public.financial_entries(user_id, party_id);
create index if not exists idx_financial_entries_compet   on public.financial_entries(user_id, competence_date);

-- 2. Parcelas e sua liquidação.
create table if not exists public.financial_installments (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users(id) on delete cascade,
  financial_entry_id   uuid not null references public.financial_entries(id) on delete cascade,
  installment_number   integer not null default 1,
  amount               numeric(12,2) not null default 0,     -- valor original da parcela
  paid_amount          numeric(12,2) not null default 0,     -- valor efetivamente liquidado
  due_date             date,                                 -- vencimento
  settlement_date      date,                                 -- data real do pagamento/recebimento (null = em aberto)
  payment_method       text,
  financial_account_id uuid,                                 -- caixa/conta (Fase 8)
  fees_amount          numeric(12,2) not null default 0,
  interest_amount      numeric(12,2) not null default 0,
  discount_amount      numeric(12,2) not null default 0,
  status               text not null default 'pending'
                         check (status in ('pending','partially_paid','paid','canceled','refunded')),
  created_at           timestamptz not null default timezone('utc', now()),
  updated_at           timestamptz not null default timezone('utc', now())
);
create unique index if not exists uq_financial_installments_entry_num
  on public.financial_installments(financial_entry_id, installment_number);
create index if not exists idx_financial_installments_entry on public.financial_installments(financial_entry_id);
create index if not exists idx_financial_installments_due   on public.financial_installments(user_id, due_date) where settlement_date is null;

-- 3. RLS por clínica (data_owner_id()).
alter table public.financial_entries enable row level security;
alter table public.financial_installments enable row level security;
do $$ begin
  begin
    create policy "Financial entries clinic access" on public.financial_entries
      for all to authenticated using (user_id = public.data_owner_id()) with check (user_id = public.data_owner_id());
  exception when duplicate_object then null; end;
  begin
    create policy "Financial installments clinic access" on public.financial_installments
      for all to authenticated using (user_id = public.data_owner_id()) with check (user_id = public.data_owner_id());
  exception when duplicate_object then null; end;
end $$;

-- 4. Receitas extras: separa data de RECEBIMENTO (caixa) da competência/vencimento (modelo de 3 datas).
alter table public.extra_revenues add column if not exists received_date date;

-- "Atrasado" é SEMPRE derivado (due_date < hoje e em aberto), nunca gravado como status fixo.
-- Backfill e sync (projeção) entram na implementação da Fase 1 (feito em JS, reusando a lógica canônica),
-- para não divergir do buildMetrics.
