# Importação assistida de lançamentos XLSX

Data: 2026-10-15

Status: implementação autorizada

## 1. Goal

Importar planilhas de movimentação financeira para uma central de revisão que detecta lançamentos já existentes, possíveis duplicidades e novos registros, sem alterar o financeiro antes da aprovação humana.

## 2. Contexto do cliente

A clínica mantém movimentações mensais em Excel, com data bancária, descrição, receita/despesa, categoria, centro de custo e referências livres de paciente/contrato. O arquivo `MOV 09-2026.xlsx` possui 188 linhas e mistura lançamentos já cadastrados, pagamentos parciais, tarifas, possíveis transferências e linhas sem classificação. A necessidade é revisar sugestões no formato da plataforma, aprovar individualmente ou em lote e ignorar linhas sem apagá-las.

## 3. Área e lugar na navegação

Financeiro → Cobrança → Conciliação bancária. A importação XLSX amplia a tela existente de OFX/CSV; não cria uma segunda fonte financeira nem uma nova área.

## 4. Benchmark e o que copiar

Espelha o padrão de conciliação assistida de ERPs: prévia normalizada, confiança explicável, seleção em lote, filtros por estado e trilha reversível. Não há classificação opaca por IA: as regras de sugestão são determinísticas e testáveis.

## 5. Fluxo ideal

1. Usuário escolhe conta financeira e arquivo OFX, CSV ou XLSX.
2. O navegador interpreta o arquivo, mostra totais e bloqueia linhas inválidas.
3. Após confirmação, linhas normalizadas e seus metadados são persistidos no lote.
4. A central separa linhas em conciliadas, correspondência existente, novas, possíveis duplicidades, revisão obrigatória e ignoradas.
5. O usuário seleciona linhas seguras, aprova selecionadas ou ignora as visíveis; também pode tratar uma linha isoladamente.
6. Correspondência existente apenas cria vínculo de conciliação.
7. Sugestão nova aprovada cria receita/despesa canônica e depois registra o vínculo.
8. Linhas ignoradas permanecem no histórico e podem ser reabertas.

## 6. Modelo de dados e propagação

> **Nota (29/10/2026):** a persistência do lote descrita abaixo em `bank_statement_imports` /
> `bank_statement_lines` **não foi entregue** para o fluxo retroativo. O commit `ebe8d04` separou o
> importador retroativo da conciliação e removeu a etapa, provavelmente porque
> `bank_statement_imports.financial_account_id` é NOT NULL e o fluxo retroativo não tem conta
> bancária. Consequência: a revisão passou a viver só na memória da aba, e o trabalho de
> classificação de 188 linhas da clínica foi perdido. A lacuna foi fechada em
> `2026-10-29-financial-import-review-persistence.md`, com tabelas dedicadas
> (`financial_import_batches` / `financial_import_lines`) em vez das da conciliação.

- `bank_statement_imports.source_format`: passa a admitir `xlsx`.
- `bank_statement_lines.source_metadata`: preserva aba, linha, categoria, centro de custo, referência e observação da planilha.
- `bank_statement_lines.review_status/review_*`: guarda decisão reversível (`pending`/`processing`/`ignored`) e auditoria. `processing` é uma reserva transacional antes da criação da origem financeira, vinculada a um token exclusivo; somente a tentativa portadora desse token pode liberar uma linha ainda sem origem financeira. O arquivamento bloqueia atomicamente enquanto houver reserva.
- `bank_statement_lines.movement_fingerprint`: assinatura determinística de data, direção, valor e descrição normalizada. A conta financeira completa a chave de sobreposição; o banco serializa a reserva por essa chave e exige confirmação explícita para repetições legítimas.
- Novos registros aprovados usam `extra_revenues` ou `expenses` pelo `saveDataNow` existente; o UUID da linha do extrato vira o UUID da origem para idempotência.
- `financial_entries` e `financial_installments` continuam derivados por `financialLedger` e persistidos pelo write-through atual.
- `bank_reconciliations` registra o vínculo; não altera valor, datas ou status da origem.

Mapa de propagação:

```text
XLSX (somente leitura no navegador)
  → bank_statement_imports + bank_statement_lines (lote auditável; sem DRE/caixa)
      → sugestão de lançamento já existente → bank_reconciliations (somente vínculo)
      → sugestão nova aprovada → extra_revenues/expenses (fonte canônica)
          → financialLedger → financial_entries/installments
          → competência → DRE
          → vencimento → contas a pagar/receber
          → recebimento/pagamento → fluxo de caixa
          → buildMetrics → Dashboard, metas, relatórios e assistente
      → ignorada → review_status=ignored (sem efeito financeiro; reversível)
```

## 7. Pontos de integração/automação

- Parse XLSX ocorre no cliente; nenhuma função Vercel é criada.
- Supabase persiste somente o lote normalizado, decisões e vínculos.
- O hash do arquivo bloqueia reimportação do mesmo arquivo na mesma conta.
- A aprovação em lote nunca inclui automaticamente transferências prováveis, linhas sem classificação ou duplicidades ambíguas.
- A criação reivindica todas as linhas novas em uma única RPC transacional antes de salvar; disputa ou atualização parcial provoca rollback integral. Movimentações equivalentes de arquivos diferentes são bloqueadas na própria transação, não somente pela tela.
- Cada origem do lote é salva sequencialmente com uma operação durável local, que só é limpa depois da fonte e da projeção canônica (`financial_entries` + `financial_installments`) serem confirmadas. Uma reserva sem qualquer dado financeiro pode ser recuperada pelo mesmo usuário após 30 minutos.
- Parcelas já conciliadas continuam participando da detecção de sobreposição, mas nunca podem ser vinculadas novamente.

## 8. Permissões

Mantém a regra da conciliação: owner, admin e gestão da clínica podem importar, revisar, aprovar, ignorar e reabrir. Equipe e concierge não acessam a área financeira.

## 9. Mapa de arquivos

- `src/lib/statementParser.js`: leitura e normalização XLSX.
- `src/lib/statementImportReview.js`: proposta canônica, duplicidades e elegibilidade em lote.
- `src/lib/bankReconciliationStore.js`: campos e ação de revisão.
- `src/components/BankReconciliation.jsx`: central visual, seleção e ações em lote.
- `supabase/bank_reconciliation_schema.sql`: instalação nova compatível.
- `supabase/bank_reconciliation_xlsx_review_schema.sql`: migração aditiva para produção existente.
- `tests/unit/*` e `tests/e2e/bank-reconciliation.spec.js`: regressão.
- `CHANGELOG.md`: registro obrigatório.

## 10. Tasks

1. Parsear XLSX e preservar metadados/linha física.
2. Classificar correspondências, duplicidades, transferências e novas sugestões.
3. Persistir ignorar/reabrir de forma auditável.
4. Criar aprovação individual/em lote idempotente pelo fluxo financeiro existente.
5. Exibir campos no modelo da plataforma e resumo de impacto.
6. Cobrir parser, classificação, persistência, reserva concorrente e UI com testes.

## 11. Checklist de fidedignidade

- [x] Soma bate: prévia compara entradas, saídas e quantidade com as linhas normalizadas.
- [x] Propagou: novos registros aprovados passam somente pelo `saveDataNow`/razão canônico.
- [x] Três datas: data bancária alimenta caixa; competência/vencimento assumidos ficam explícitos na proposta aprovada.
- [x] Sem órfão: UUID da linha torna a criação idempotente, a operação pendente é durável até o razão completo e o vínculo só é confirmado depois da parcela persistida.
- [x] Estados: vínculo com existente não altera baixa; novo registro usa status recebido/pago com data bancária.
- [x] Testes: parser, duplicidade, classificação, aprovação/ignorar e build.
- [x] Sem mock no fluxo real; mocks somente em testes isolados.

## 12. Testes e aceitação

- `npm run test:unit`
- `npm run build`
- E2E da conciliação cobrindo XLSX, seleção, criação real, vínculo, ignorar/reabrir, recarga e reimportação idempotente.
- Validar `MOV 09-2026.xlsx`: 188 linhas, 93 entradas, 95 saídas, R$ 346.859,26 de entradas e R$ 216.938,35 de saídas.
- Confirmar que importar/revisar sem aprovar não altera DRE, fluxo ou contas.
- Confirmar que aprovação repetida não cria origem duplicada.
- Rodar code-reviewer antes do merge.
