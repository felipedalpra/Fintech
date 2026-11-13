# Separar receita própria da clínica do valor repassado direto a terceiros na cirurgia

Data: 2026-11-13

## 1. Goal

Na cirurgia, distinguir o valor que é receita efetiva da clínica do valor que o paciente paga direto a terceiros (hospital, anestesista, prótese), para que os indicadores/dashboard nunca mostrem como faturamento próprio um valor que a clínica nunca recebeu.

## 2. Contexto do cliente

Treinamento de 12/11/2026 com Jonas e Sumary (ver memória `project_training_gaps_nov2026`). Exemplo dado pelo Jonas: cirurgia de valor global R$ 54.000, da qual a clínica efetivamente recebe R$ 35.000 — o restante vai direto do paciente para o hospital/anestesista/prótese, sem passar pela clínica. Hoje o campo `totalValue` da cirurgia é usado como receita bruta em `buildMetrics` (`src/financialMetrics.js:400`); lançar o valor global ali infla a receita, o DRE, as metas e o dashboard.

Felipe confirmou (13/11/2026): **sem relevância fiscal** — não precisa de tratamento contábil especial, é só uma questão de não contar como receita da clínica um valor que ela nunca recebeu.

Diferença importante em relação ao que já existe: os campos `hospitalCost`/`anesthesiaCost`/`materialCost`/`otherCosts` (`src/lib/clinicalCosts.js`) já modelam o caso em que **a clínica paga** esses itens como despesa própria (entram no DRE como custo direto, com liquidação em `cost_settlements`). O caso do Jonas é diferente: **o paciente paga direto ao terceiro**, a clínica nunca vê esse dinheiro entrando nem saindo. Os dois casos coexistem e não se substituem.

## 3. Área e lugar na navegação

Área **Financeiro** → Operação → Cirurgias (`src/components/Sales.jsx`) e Agenda → cirurgia (`src/components/CalendarFinancialFields.jsx`). Reflete também na aba "Financeiro" do paciente (resumo de valores).

## 4. Benchmark e o que copiar

Nenhum benchmark externo aplicável — é uma correção de modelagem de domínio específica da cirurgia plástica (valor do procedimento com terceiros pagos diretamente pelo paciente), não um padrão de ERP genérico.

## 5. Fluxo ideal

1. Jonas cadastra a cirurgia com o valor que efetivamente fica para a clínica em "Valor da clínica" (campo que hoje é `totalValue`, sem mudar de nome internamente).
2. Em um campo novo, opcional, "Valor repassado direto a terceiros (hospital/anestesista/prótese)", lança o que o paciente paga por fora — só para ter o registro de quanto o paciente paga no total.
3. A tela mostra "Valor total ao paciente" = valor da clínica + valor repassado a terceiros, só como exibição informativa (não é um campo editável).
4. DRE, fluxo de caixa, contas a receber, metas e dashboard continuam somando apenas "valor da clínica" — nada muda ali, porque o campo novo nunca entra nesses cálculos.
5. Se quiser, o Jonas também pode continuar usando os campos de custo existentes (hospital/anestesia/material) para os casos em que a própria clínica paga o terceiro e depois se ressarce — isso não muda.

## 6. Modelo de dados e propagação

**Campo novo, aditivo, nunca lido pelos cálculos existentes:**

```sql
alter table public.surgeries
  add column if not exists third_party_passthrough_value numeric(12,2) not null default 0;
```

Migration: `supabase/surgery_third_party_passthrough_schema.sql` (aditiva, sem default que afete linhas existentes — `0` preserva o comportamento atual).

**Mapa de propagação:**

```
Cirurgia.third_party_passthrough_value (novo, informativo)
  → "Valor total ao paciente" exibido no card da cirurgia (Sales.jsx) e na Agenda (CalendarFinancialFields.jsx)
  → Aba Financeiro do paciente (resumo "valor cobrado do paciente" vs "valor da clínica")
  ✕ NÃO entra em: receita bruta (buildMetrics), DRE, fluxo de caixa, contas a receber, metas, dashboard, drilldowns financeiros, Excel/Central de Relatórios
```

Nenhum outro registro-fonte muda. `totalValue` continua sendo exatamente o que já é hoje (receita própria da clínica) — não há migração de dados nem reinterpretação de histórico.

## 7. Pontos de integração/automação

Nenhum. Campo puramente de registro/exibição, sem gatilho de WhatsApp, boleto, OFX ou assinatura.

## 8. Permissões

Mesmo acesso que já existe para a tela de Cirurgias (`sales`): Admin, Gestão, Equipe/Concierge (inclui Jonas) — ver `src/lib/roleAccess.js`. Nenhuma mudança de permissão.

## 9. Mapa de arquivos

- `supabase/surgery_third_party_passthrough_schema.sql` — criar (migration aditiva).
- `src/dataModel.js` — normalizar o campo novo (default 0, numérico) na leitura/escrita de cirurgia.
- `src/components/Sales.jsx` — campo novo no formulário (`empty`, `save()`, `openEdit()`) + exibição de "Valor total ao paciente" no card/lista.
- `src/components/CalendarFinancialFields.jsx` — mesmo campo novo para cirurgias criadas pela Agenda.
- `src/financialMetrics.js` — **nenhuma mudança** (o ponto é justamente não tocar ali); adicionar comentário curto no `buildMetrics` explicando por que `third_party_passthrough_value` é ignorado de propósito, para não ser "corrigido" por engano depois.
- `CHANGELOG.md` — entrada em `Added`.

## 10. Tasks

1. Criar e aplicar a migration `surgery_third_party_passthrough_schema.sql` (Felipe aplica no Supabase).
2. Normalizar o campo em `src/dataModel.js`.
3. Adicionar o campo ao formulário de cirurgia em `Sales.jsx` (label "Valor repassado direto a terceiros (hospital/anestesista/prótese) — não é receita da clínica") e ao card/lista a exibição de "Valor total ao paciente".
4. Repetir o campo em `CalendarFinancialFields.jsx` para cirurgias criadas pela Agenda.
5. Exibir o resumo "valor cobrado do paciente vs. valor da clínica" na aba Financeiro do paciente.
6. Escrever teste unitário que cria uma cirurgia com `third_party_passthrough_value > 0` e garante que `buildMetrics` (receita bruta, DRE, fluxo, metas) não muda em relação à mesma cirurgia sem esse valor — esse é o teste que prova a não-propagação.
7. Atualizar `CHANGELOG.md`.

## 11. Checklist de fidedignidade

1. **Soma bate?** Receita bruta/DRE/fluxo somam exatamente igual antes e depois de preencher o campo novo, em qualquer período/filtro.
2. **Propagou?** Editar/excluir a cirurgia atualiza corretamente "Valor total ao paciente" nas duas telas (Financeiro e paciente); os valores derivados financeiros nem precisam atualizar, porque não dependem do campo.
3. **As 3 datas?** Não aplicável — o campo não tem data própria, usa a mesma data da cirurgia.
4. **Sem órfão:** campo com default `0`, cirurgias antigas continuam exibindo "Valor total ao paciente" = valor da clínica (sem terceiros), sem quebrar nada.
5. **Estados de pagamento:** não aplicável — o campo é informativo, não gera parcela, cobrança nem conciliação.
6. **Teste automatizado:** `npm run test:unit` cobrindo a task 6 acima.
7. Sem mock em fluxo real; consistência front/back garantida pela migration aditiva.

## 12. Testes e aceitação

- `npm run test:unit` passando, incluindo o novo teste de não-propagação.
- Verificação manual: lançar uma cirurgia de R$ 54.000 (clínica) + R$ 19.000 (terceiros) e confirmar que o Dashboard/DRE mostram R$ 54.000 de receita, não R$ 73.000, enquanto o card da cirurgia mostra "Valor total ao paciente: R$ 73.000".
- `CHANGELOG.md` atualizado no mesmo commit (regra obrigatória do projeto).
