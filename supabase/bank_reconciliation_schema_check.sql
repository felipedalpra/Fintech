-- Conferencia COMPLETA do schema da conciliacao bancaria. Somente leitura.
--
-- Por que existe: em 31/10/2026 a importacao do extrato falhou cinco vezes
-- seguidas, cada falha revelando um pedaco diferente do schema que estava
-- faltando naquele banco -- colunas, funcoes e uma restricao desatualizada,
-- todos da mesma migration interrompida. Cada descoberta custou uma rodada
-- inteira de ida e volta com o cliente.
--
-- Rode ESTE arquivo ANTES de investigar qualquer erro da conciliacao: ele diz
-- de uma vez o que falta, em vez de um item por tentativa.
--
-- Esperado: `ok = true` em TODAS as linhas.

select 'coluna: ' || c.nome as item,
       exists (
         select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'bank_statement_lines'
           and column_name = c.nome
       ) as ok
from (values
  ('source_line_key'),('external_id'),('provider_transaction_id'),('end_to_end_id'),
  ('txid'),('booking_status'),('counterparty_name'),('counterparty_document_suffix'),
  ('posted_date'),('amount'),('currency'),('description'),('normalized_description'),
  ('movement_fingerprint'),('source_metadata'),('line_index'),('review_status'),
  ('review_reason'),('reviewed_by'),('reviewed_at'),('review_claim_token')
) as c(nome)

union all

select 'funcao: ' || f.nome,
       exists (
         select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = f.nome
       )
from (values
  ('start_bank_statement_import'),('finalize_bank_statement_import'),
  ('archive_bank_statement_import'),('confirm_bank_reconciliation'),
  ('reverse_bank_reconciliation'),('set_bank_statement_lines_review'),
  ('claim_bank_statement_lines_for_creation'),('recover_bank_statement_line_claim'),
  ('release_bank_statement_line_claims'),('create_financial_bank_account'),
  ('bank_reconciliation_can_manage'),('data_owner_id')
) as f(nome)

union all

-- A reserva de linha grava 'processing'. Sem ele permitido, nenhum lancamento
-- pode ser criado a partir do extrato.
select 'restricao review_status aceita processing',
       exists (
         select 1 from pg_constraint
         where conname = 'bank_statement_lines_review_status_check'
           and pg_get_constraintdef(oid) like '%processing%'
       )

union all

-- As DUAS overloads precisam aceitar o extrato do BRB: o app chama a de 6
-- parametros, e corrigir so uma passa despercebido.
select 'ambas as overloads de start_bank_statement_import aceitam brb',
       (select count(*) from pg_proc where proname = 'start_bank_statement_import')
       = (select count(*) from pg_proc where proname = 'start_bank_statement_import'
          and prosrc like '%''brb''%')

union all

select 'CHECK de source_format aceita brb',
       exists (
         select 1 from pg_constraint
         where conname = 'bank_statement_imports_source_format_check'
           and pg_get_constraintdef(oid) like '%brb%'
       )

order by ok, item;
