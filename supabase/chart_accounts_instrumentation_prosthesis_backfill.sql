-- O plano de contas já inicializado no banco não recebe automaticamente as contas novas
-- adicionadas ao catálogo padrão em src/lib/chartOfAccounts.js (ensureDefaultChartAccounts só
-- semeia quando a tabela está vazia). Sem este backfill, os custos novos de instrumentadora e
-- prótese caem em "Pagamento a classificar" (unclassified_expense) em vez da conta certa —
-- achado testando de verdade (categoria errada em Contas a pagar).

begin;

-- 1) "Instrumentação e apoio" (6.01.05) já existe pra quem já tinha o plano de contas, só não
--    tinha o system_key (porque não existia no catálogo quando a conta foi inserida).
update public.chart_accounts
set system_key = 'cost_surgery_instrumentation'
where code = '6.01.05' and system_key is null;

-- 2) "Prótese" (6.01.06) é conta nova: insere pra quem já tem o ramo 6.01 inicializado e ainda
--    não tem essa conta, usando o mesmo parent_id do grupo 6.01.
insert into public.chart_accounts (user_id, parent_id, code, name, node_type, nature, dre_section, system_key, is_active, sort_order)
select
  existing.user_id,
  existing.parent_id,
  '6.01.06',
  'Prótese',
  'account',
  'direct_cost',
  'direct_costs',
  'cost_surgery_prosthesis',
  true,
  existing.sort_order + 1
from public.chart_accounts existing
where existing.code = '6.01.05'
  and not exists (
    select 1 from public.chart_accounts other
    where other.user_id = existing.user_id and other.code = '6.01.06'
  );

commit;
