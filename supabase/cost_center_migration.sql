-- CENTRO DE CUSTO em lançamentos manuais
--
-- O frontend já separa centro de custo do rótulo livre de origem. Esta migração
-- aditiva garante que ambos possam ser persistidos sem sobrecarregar `origin_label`.

ALTER TABLE public.extra_revenues ADD COLUMN IF NOT EXISTS cost_center text;
ALTER TABLE public.expenses       ADD COLUMN IF NOT EXISTS cost_center text;
