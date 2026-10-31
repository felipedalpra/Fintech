-- Conciliacao bancaria: a restricao de `review_status` precisa aceitar
-- 'processing'. Aditiva e idempotente.
--
-- Motivo (bug em producao, 31/10/2026): ao criar um lancamento a partir de uma
-- linha do extrato, o banco recusava com
--   new row for relation "bank_statement_lines" violates check constraint
--   "bank_statement_lines_review_status_check"  (23514)
-- enquanto gravava `review_status = 'processing'`. A restricao naquele banco
-- era de uma versao antiga do schema, que so permitia 'pending' e 'ignored'.
--
-- `reservar a linha para criacao` É escrever 'processing': sem este valor
-- permitido, NENHUM lancamento pode ser criado a partir do extrato.
--
-- Terceira consequencia da mesma interrupcao de
-- bank_reconciliation_xlsx_review_schema.sql (as outras duas foram as colunas
-- ausentes e as funcoes de reserva apagadas).

begin;

alter table public.bank_statement_lines
  drop constraint if exists bank_statement_lines_review_status_check;

alter table public.bank_statement_lines
  add constraint bank_statement_lines_review_status_check
  check (review_status in ('pending', 'processing', 'ignored'));

commit;

-- ---------------------------------------------------------------------------
-- Conferencia
-- ---------------------------------------------------------------------------
-- Esperado: a definicao citando os tres valores.
--
--   select pg_get_constraintdef(oid) as definicao
--   from pg_constraint
--   where conname = 'bank_statement_lines_review_status_check';
