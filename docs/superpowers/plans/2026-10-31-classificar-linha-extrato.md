# Classificar a linha do extrato na própria conciliação

## 1. Goal

Permitir classificar cada linha do extrato no plano de contas sem sair da tela, e
replicar a escolha para as linhas de mesma descrição — para que conciliar um
extrato de 178 lançamentos não exija abrir 178 formulários.

## 2. Contexto do cliente

Pedido do Felipe em 31/10/2026, ao ver a tela pela primeira vez com o extrato
real da clínica: *"e também tem que poder categorizar direto ali"*.

O extrato do BRB em PDF **não traz categoria nenhuma** — diferente da planilha,
que tem coluna própria. Sem classificação, `proposalForStatementLine` marca
`requiresReview`, a linha vira "Precisa revisar", sai de `safeForBulk`, e
"Selecionar sugestões seguras visíveis" seleciona **zero**. Na prática o lote
não servia para nada neste formato.

## 3. Área e lugar na navegação

Financeiro → Conciliação bancária, dentro do card de cada linha.

## 4. Benchmark

Olist/Tiny: classificação na própria linha do extrato, com repetição por
descrição. É o que torna conciliação mensal viável.

## 5. Fluxo ideal

1. A linha chega sem categoria e diz o que falta.
2. Quem concilia escolhe a conta no seletor do card. A lista já vem filtrada
   pelo sentido da linha.
3. A linha passa a "Novos" e entra na seleção em lote.
4. Se houver linhas de mesma descrição em aberto, aparece
   **"Aplicar às N linhas com a mesma descrição"**.
5. "Aprovar selecionados" cria os lançamentos, com a competência escolhida.

## 6. Modelo de dados e propagação

**Nada novo é persistido.** A classificação vive no estado da tela e entra no
`record` da proposta no momento da aprovação. Não há coluna nova, migration nem
RPC.

```
Classificação da linha (chart_account_id, category)
  → record da proposta (extraRevenues | expenses)
    → lançamento criado na aprovação
      → DRE (pela competência, agrupado pela conta escolhida)
      → Fluxo de caixa (pela data bancária — NÃO muda)
      → Contas a pagar/receber (pelo vencimento — NÃO muda)
      → bank_reconciliations (vínculo linha ↔ parcela)
```

A classificação altera **apenas** o agrupamento contábil. Valor, sentido e as
três datas seguem intactos.

## 7. Integrações

Nenhuma. Não cria função serverless (o projeto está no limite da Vercel).

## 8. Permissões

Mesmas da conciliação: Administrador e Gestão (`finance_role_can_manage`).

## 9. Mapa de arquivos

- `src/lib/statementImportReview.js` — `proposalForStatementLine` aceita
  classificação; `linesWithSameDescription`; `probableInternalTransfer` respeita
  decisão humana.
- `src/components/BankReconciliation.jsx` — estado, seletor por linha, aplicar
  às iguais.
- `tests/unit/statementClassification.spec.js`.

## 10. Checklist de fidedignidade

1. **Soma bate?** Sim — a classificação não toca valor nem sentido.
2. **Propagou?** O agrupamento do DRE passa a usar a conta escolhida; fluxo e
   contas a pagar/receber não mudam.
3. **As 3 datas?** Intactas. Competência continua governada pela escolha da
   aprovação; caixa é a data bancária.
4. **Sem órfão?** A classificação não persiste sozinha: ou vira lançamento na
   aprovação, ou se perde com a tela. Não existe estado meio-gravado.
5. **Estados de pagamento?** Inalterados.
6. **Teste automatizado?** 9 asserções cobrindo sentido, transferência interna,
   alcance do "aplicar às iguais" e linhas intocáveis.
7. **Sem mock em fluxo real?** A classificação atravessa o mesmo caminho de
   criação já existente.

### Limites deliberados

- A lista de contas é filtrada pelo sentido: classificar uma entrada numa conta
  de despesa **inverteria o sinal no DRE**, então nem é oferecido.
- "Aplicar às iguais" exige mesma descrição **e** mesmo sentido. Valor e data não
  entram: duas tarifas de valores diferentes são a mesma categoria, mas uma
  devolução de PIX com a mesma descrição é receita, não despesa.
- Só alcança linhas em aberto. Conciliada, ignorada ou em processamento não tem
  a classificação trocada por baixo.
- Classificar à mão **desliga** a suspeita de transferência interna daquela
  linha: a heurística existe para linha sem classificação, e insistir nela seria
  o sistema discordando de uma decisão humana explícita.

## 11. Em aberto

- A classificação **não é lembrada** entre importações. O passo natural é
  aprender com o histórico ("da última vez, `TARIFA ENVIO VALORES PIX` foi para
  Tarifas bancárias") e sugerir sozinha. Exige persistir o mapa
  descrição → conta, com migration — fora do escopo desta entrega.
