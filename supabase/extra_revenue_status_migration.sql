-- STATUS de recebimento em receitas extras (a receber x recebido)
--
-- Receitas extras passam a ter situação como as despesas têm (aberto/pago):
--   'recebido' -> entrou no caixa (fluxo de caixa) na data de recebimento
--   'pendente' -> ainda a receber, aparece em "Contas a receber" pelo vencimento
-- Em ambos os casos a receita conta na DRE pela competência.
--
-- Rode no SQL Editor do Supabase (projeto SurgiMetrics).

ALTER TABLE extra_revenues ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'recebido';

-- Registros já existentes ficam como 'recebido' (comportamento atual preservado).
UPDATE extra_revenues SET status = 'recebido' WHERE status IS NULL;
