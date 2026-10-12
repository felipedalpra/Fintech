# Núcleo financeiro: razão canônico (financial_entries/installments) — análise e plano faseado

> Resposta ao checklist trazido pelo Codex (12/10/2026). Avalia relevância e propõe um caminho
> **faseado, aditivo e reversível** — porque isto re-arquiteta a FONTE DE VERDADE financeira, a área de
> maior risco (ver incidente `project-finance-dataloss-incident-oct2026`; fidedignidade = regra #1).

## 1. Veredito: é relevante? SIM, o diagnóstico está certo
Hoje o modelo embute o pagamento nos registros operacionais (`surgeries`, `consultations`, …) e:
- o cronograma de pagamento vive **dentro de `payment_method`** (string codificada);
- venda/compra de produto é tratada como **caixa na data da venda/compra** (sem data real de liquidação);
- **não há** como comprovar "quando o dinheiro entrou/saiu", pagamento parcial real, estorno/devolução;
- **fornecedor é texto livre** (fragmenta relatório);
- **CMV usa o custo atual** do produto (mudar preço de compra altera relatórios antigos retroativamente);
- não há **contas bancárias/caixa** separadas nem conciliação.

Tudo isso é real e limita exatamente os relatórios "intensos" que queremos. A direção do Codex
(**razão único: `financial_entries` + `financial_installments`, lido por contas a pagar/receber, caixa,
DRE e relatórios**) é a arquitetura madura correta.

## 2. Ressalvas de engenharia (o que eu NÃO recomendo)
1. **Não é big-bang.** É a fonte de verdade de TODO o financeiro. Fazer de uma vez, logo após um
   incidente de perda, é alto risco de regressão numa clínica em uso real.
2. **Priorização honesta.** Para ESTA clínica (consultório único), o maior valor agora é: **datas de
   liquidação reais, pagamento parcial, fornecedor normalizado e `received_date`**. Já **conciliação
   bancária multi-conta, CMV histórico completo e razão de dupla-entrada com transferências** são
   ERP-grade e podem vir depois — úteis, mas não é a dor imediata.
3. **A decisão que move tudo (preciso de você):** o `financial_entries` vira a **AUTORIDADE** (exige UI
   nova de liquidação e reescrever leitura/escrita de `buildMetrics` e telas), ou começa como
   **PROJEÇÃO sincronizada** (aditivo: triggers mantêm o razão derivado dos registros atuais; relatórios
   passam a ler dele; a autoridade migra gradualmente)? Recomendo **projeção-primeiro** — entrega valor
   cedo, risco baixo, e evita "duas fontes de verdade divergentes" porque o razão é derivado até o dia
   em que assumir a autoridade de um campo que o modelo atual nem tem (ex.: data de liquidação).

## 3. Regras inegociáveis da migração (valem para todas as fases)
- Migrações **aditivas e idempotentes**; nada destrutivo; **não apagar `payment_method`** antes do backfill.
- Backfill **repetível sem duplicar** (unicidade `(user_id, source_type, source_id, source_component)` em
  entries; `(user_id, product_id, source_type, source_id, movement_type)` em movimentos).
- **Invariantes checados por teste:** soma das parcelas = total do título; pago + aberto = total;
  estoque atual = soma dos movimentos. "Atrasado" é **derivado** (`due_date < hoje` e aberto), nunca gravado.
- Dado antigo de venda **não** vira `paid` automaticamente → `legacy_unverified` + tela de conferência.
- RLS por `data_owner_id()`; `created_at/updated_at/archived_at` + auditoria (`record_audit`) nas tabelas novas.
- CHANGELOG + testes de regressão por fase.

## 4. Sequência faseada (uma branch por fase, specada e testada)
1. **Fundação (razão):** `financial_entries` + `financial_installments` (schema aditivo) + **backfill** dos
   pagamentos de cirurgias/consultas (decodificar `payment_method`, gerar parcelas; pago c/ `payment_date`
   = parcela liquidada) + **sync por trigger** (projeção) + testes de invariância. **Sem mudar leitura ainda.**
2. **Fornecedores:** `suppliers` + `supplier_id` em compras/títulos a pagar + snapshot de nome.
3. **Vendas de produto:** `patient_id`, `status`, liquidação via razão (antigas = `legacy_unverified`).
4. **Compras de produto:** `status`, `payment_date`, `supplier_id`, `document_number`, liquidação no razão.
5. **Estoque:** `inventory_movements` (ledger) + saldo = soma dos movimentos (perda/devolução/ajuste).
6. **CMV/custo histórico:** `unit_cost_at_sale`/`total_cost_at_sale` + custo médio por movimento.
7. **Custos de cirurgia/consulta** como entradas independentes (`source_component`: hospital/anestesia/material/…).
8. **Contas bancárias/caixa** + `financial_account_id` nas liquidações + conciliação + transferências (fora da DRE).
9. **Impostos/taxas/descontos/comissões** por operação (valores reais preservados, alíquota congelada).
10. **Virar a leitura:** `buildMetrics`/relatórios passam a ler do razão; aposentar campos de pagamento embutidos.

> Receitas extras (`received_date`, ponto 10 do Codex) é pequeno e independente — dá pra fazer já na Fase 1
> junto, fechando o modelo de 3 datas (competência→DRE, vencimento→contas, caixa→recebimento).

## 5. Mapa de propagação (por que é delicado)
`buildMetrics` deriva HOJE tudo de surgeries/consultations/expenses/etc. Mudar a fonte afeta: DRE,
fluxo de caixa (realizado e projetado), contas a pagar/receber, balanço, metas, dashboard, alertas,
assistente de IA, Central de Relatórios (22 relatórios) e o financeiro do paciente. Cada fase precisa do
checklist de fidedignidade (seção 5 de `2026-10-10-platform-architecture-design.md`): a soma bate em todos
os períodos/filtros, e editar/excluir propaga para todas as visões.

## 6. O que entrego ao iniciar a Fase 1 (quando aprovada)
Spec detalhada da Fase 1 (DDL exato, função de backfill idempotente, triggers de sync, testes de
invariância), numa branch `feat/financial-ledger-foundation`, sem mudar a leitura do app — validável
comparando os totais do razão com os do `buildMetrics` atual (devem bater à prova de centavo).
