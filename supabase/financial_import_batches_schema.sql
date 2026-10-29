-- financial_import_batches_schema.sql
-- Persistência da etapa de REVISÃO da importação financeira retroativa.
-- Spec: docs/superpowers/plans/2026-10-29-financial-import-review-persistence.md (opção B).
-- ADITIVO e idempotente. Não cria função Vercel e NÃO toca a conciliação bancária.
-- Executar DEPOIS de access_control_schema.sql, finance_role_access_schema.sql e
-- chart_of_accounts_schema.sql.
--
-- Por que tabelas próprias e não as da conciliação: `bank_statement_imports.financial_account_id`
-- é NOT NULL e o fluxo retroativo não tem conta bancária (a tela diz "nenhuma conta bancária é
-- necessária"). Reusar aquelas tabelas exigiria afrouxar um invariante que hoje protege dado de
-- extrato bancário.
--
-- FIDEDIGNIDADE: estas tabelas ficam INTEIRAMENTE ANTES da fonte canônica. Um lote em revisão não
-- produz nenhum valor financeiro — não entra em DRE, fluxo, contas, metas nem dashboard. O
-- financeiro continua derivando só de extra_revenues/expenses.

-- ---------------------------------------------------------------------------
-- 1. Lote de importação
-- ---------------------------------------------------------------------------
create table if not exists public.financial_import_batches (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,  -- dono/clínica
  imported_by         uuid not null references auth.users(id) on delete restrict, -- quem subiu
  file_name           text not null,
  file_hash           text not null check (file_hash ~ '^[0-9a-f]{64}$'),
  sheet_name          text,
  column_mapping      jsonb not null default '{}'::jsonb,
  expected_line_count integer not null check (expected_line_count between 0 and 50000),
  line_count          integer not null default 0 check (line_count >= 0),
  -- 'creating' = lote aberto mas AINDA SEM todas as linhas gravadas. Só é promovido a 'reviewing'
  -- depois do read-back do último bloco. Isso impede que uma gravação interrompida no meio deixe
  -- um lote retomável com linhas faltando (revisão incompleta aberta em silêncio).
  status              text not null default 'creating'
                      check (status in ('creating', 'reviewing', 'ready', 'archived')),
  period_start        date,
  period_end          date,
  created_at          timestamptz not null default timezone('utc', now()),
  ready_at            timestamptz,
  archived_at         timestamptz
);

-- ---------------------------------------------------------------------------
-- 2. Linhas do lote (a revisão em si)
-- ---------------------------------------------------------------------------
-- O `id` NÃO é gerado pelo banco: é o UUID determinístico de financialImportUuid(fileHash:lineKey),
-- que já é o id da origem financeira criada na aprovação. Isso preserva a idempotência existente e
-- dá o vínculo linha↔lançamento sem tabela de ligação.
create table if not exists public.financial_import_lines (
  id                     uuid not null,
  user_id                uuid not null references auth.users(id) on delete cascade,
  batch_id               uuid not null references public.financial_import_batches(id) on delete cascade,
  source_line_key        text not null,
  line_index             integer not null check (line_index > 0),
  posted_date            date not null,
  amount                 numeric(14,2) not null check (amount <> 0),
  description            text not null default '',
  normalized_description text not null default '',
  movement_fingerprint   text not null,
  source_metadata        jsonb not null default '{}'::jsonb,
  review_status          text not null default 'pending'
                         check (review_status in ('pending', 'edited', 'rejected', 'approved')),
  chart_account_id       uuid references public.chart_accounts(id) on delete set null,
  reviewed_by            uuid references auth.users(id) on delete restrict,
  reviewed_at            timestamptz,
  created_at             timestamptz not null default timezone('utc', now()),
  archived_at            timestamptz,
  -- PK COMPOSTA, não só `id`. O id é determinístico (hash do arquivo + linha), então o MESMO id
  -- aparece legitimamente em lotes diferentes: abas distintas do mesmo arquivo, clínicas distintas
  -- importando o mesmo arquivo, e um novo lote após um lote descartado. Com PK só em `id`, o
  -- primeiro desses casos travava o arquivo para sempre por violação de chave.
  primary key (batch_id, id)
);

-- Corrige bancos onde uma versão anterior desta migração criou a PK apenas em `id`.
do $$
begin
  if exists (select 1 from information_schema.tables
              where table_schema = 'public' and table_name = 'financial_import_lines')
     and exists (select 1 from pg_constraint
                  where conrelid = 'public.financial_import_lines'::regclass
                    and contype = 'p' and array_length(conkey, 1) = 1) then
    alter table public.financial_import_lines drop constraint financial_import_lines_pkey;
    alter table public.financial_import_lines add primary key (batch_id, id);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Índices
-- ---------------------------------------------------------------------------
-- Subir o MESMO arquivo de novo não cria lote novo: a tela encontra este e RETOMA a revisão.
-- A ABA entra na chave porque um arquivo com várias abas tem o MESMO hash: sem ela, trocar de aba
-- restauraria silenciosamente as linhas da aba anterior. Um lote é o par (arquivo, aba).
create unique index if not exists uq_financial_import_active_file
  on public.financial_import_batches(user_id, file_hash, coalesce(sheet_name, ''))
  where archived_at is null and status <> 'archived';
create index if not exists idx_financial_import_owner_created
  on public.financial_import_batches(user_id, created_at desc)
  where archived_at is null;
create index if not exists idx_financial_import_lines_batch
  on public.financial_import_lines(batch_id, line_index)
  where archived_at is null;
create index if not exists idx_financial_import_lines_pending
  on public.financial_import_lines(batch_id)
  where archived_at is null and review_status <> 'approved';
-- Leitura paginada da revisão depende desta ordem.
create index if not exists idx_financial_import_lines_batch_id
  on public.financial_import_lines(batch_id, id);

-- ---------------------------------------------------------------------------
-- 4. RLS — mesmo escopo do núcleo financeiro (dono da clínica + admin/gestão)
-- ---------------------------------------------------------------------------
alter table public.financial_import_batches enable row level security;
alter table public.financial_import_lines enable row level security;

drop policy if exists "Financial import batches read" on public.financial_import_batches;
create policy "Financial import batches read" on public.financial_import_batches
  for select to authenticated
  using (user_id = public.data_owner_id() and public.finance_role_can_manage());

-- imported_by = auth.uid(): a autoria registrada tem de ser real. Gravar o dono como autor foi o
-- mesmo defeito corrigido em audit_logs (commit fe7e769).
drop policy if exists "Financial import batches insert" on public.financial_import_batches;
create policy "Financial import batches insert" on public.financial_import_batches
  for insert to authenticated
  with check (
    user_id = public.data_owner_id()
    and public.finance_role_can_manage()
    and imported_by = auth.uid()
  );

drop policy if exists "Financial import batches update" on public.financial_import_batches;
create policy "Financial import batches update" on public.financial_import_batches
  for update to authenticated
  using (user_id = public.data_owner_id() and public.finance_role_can_manage())
  with check (user_id = public.data_owner_id() and public.finance_role_can_manage());

drop policy if exists "Financial import lines read" on public.financial_import_lines;
create policy "Financial import lines read" on public.financial_import_lines
  for select to authenticated
  using (user_id = public.data_owner_id() and public.finance_role_can_manage());

drop policy if exists "Financial import lines insert" on public.financial_import_lines;
create policy "Financial import lines insert" on public.financial_import_lines
  for insert to authenticated
  with check (user_id = public.data_owner_id() and public.finance_role_can_manage());

drop policy if exists "Financial import lines update" on public.financial_import_lines;
create policy "Financial import lines update" on public.financial_import_lines
  for update to authenticated
  using (user_id = public.data_owner_id() and public.finance_role_can_manage())
  with check (
    user_id = public.data_owner_id()
    and public.finance_role_can_manage()
    and (reviewed_by is null or reviewed_by = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- 5. Grants — sem DELETE (o núcleo financeiro é arquivamento, nunca exclusão física)
-- ---------------------------------------------------------------------------
revoke all on public.financial_import_batches from anon;
revoke all on public.financial_import_lines   from anon;
grant select, insert, update on public.financial_import_batches to authenticated;
grant select, insert, update on public.financial_import_lines   to authenticated;

-- Conferir depois de rodar:
--   select status, count(*) from public.financial_import_batches group by status;
--   select review_status, count(*) from public.financial_import_lines group by review_status;
