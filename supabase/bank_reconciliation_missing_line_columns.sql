-- Conciliacao bancaria: acrescenta as colunas de bank_statement_lines que
-- faltaram quando bank_reconciliation_xlsx_review_schema.sql foi aplicado pela
-- metade. Aditiva e idempotente.
--
-- Motivo (bug em producao, 31/10/2026): a importacao do extrato falhava com
--   Could not find the 'movement_fingerprint' column of 'bank_statement_lines'
--   in the schema cache (PGRST204)
-- e NADA era gravado. As colunas `review_status`, `review_reason`,
-- `reviewed_by` e `reviewed_at` existiam, mas `movement_fingerprint` e
-- `review_claim_token` nao -- aplicacao parcial da migration do XLSX.
--
-- POR QUE NAO RODAR bank_reconciliation_xlsx_review_schema.sql DIRETO:
-- aquele arquivo recria o CHECK de `source_format` como ('ofx','csv','xlsx'),
-- SEM 'brb', e recria a funcao de 5 parametros tambem sem 'brb'. Roda-lo agora
-- DESFARIA o suporte ao extrato do BRB. Esta migration toca apenas as colunas.

begin;

alter table public.bank_statement_lines
  add column if not exists movement_fingerprint text,
  add column if not exists review_claim_token uuid;

-- Linhas ja importadas antes desta coluna existir precisam de um valor, porque
-- a coluna vira NOT NULL logo abaixo. A expressao e a mesma da migration
-- original, para que uma linha antiga e uma nova gerem a mesma impressao.
update public.bank_statement_lines
set movement_fingerprint = posted_date::text || '|'
  || case when amount > 0 then 'receivable' else 'payable' end || '|'
  || to_char(abs(amount), 'FM999999999999990.00') || '|'
  || normalized_description
where movement_fingerprint is null;

alter table public.bank_statement_lines
  alter column movement_fingerprint set not null;

create index if not exists idx_bank_lines_owner_account_fingerprint
  on public.bank_statement_lines(user_id, financial_account_id, movement_fingerprint)
  where archived_at is null;

commit;

-- ---------------------------------------------------------------------------
-- Conferencia
-- ---------------------------------------------------------------------------
-- Esperado: nenhuma linha (todas as colunas que o app grava existem).
--
--   select c.coluna as coluna_faltando
--   from (values ('movement_fingerprint'),('review_claim_token'),('review_status'),
--                ('booking_status'),('counterparty_name'),('provider_transaction_id')
--   ) as c(coluna)
--   where not exists (
--     select 1 from information_schema.columns
--     where table_schema = 'public' and table_name = 'bank_statement_lines'
--       and column_name = c.coluna
--   );
