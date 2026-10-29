# Persistência da revisão na importação financeira retroativa

> Status: **opção B aprovada e implementada** (branch `feat/import-review-persistence`).
> A seção 14 registra as três decisões que mudaram durante a implementação.

## 1. Goal

A revisão de uma planilha importada sobrevive a fechar a aba, recarregar, trocar de máquina e a uma
confirmação que falha — para que a classificação linha a linha feita pela clínica nunca mais seja
perdida.

## 2. Contexto do cliente

Em outubro/2026 a Lunara (perfil `gestao`) importou `MOV 09-2026.xlsx` na tela de lançamentos
retroativos, revisou e ajustou as linhas, confirmou a importação e, ao voltar no dia seguinte, não
havia nada. A investigação apurou por SQL:

- zero linhas em `extra_revenues`/`expenses` no escopo da clínica com `origin_label` de importação;
- zero linhas em `bank_statement_imports` e `bank_statement_lines` — **no total, de todas as contas**;
- a última gravação financeira no escopo da clínica é de 11/10, e o último save completo de 12/10.

Duas conclusões, de naturezas diferentes:

1. **Por que a confirmação não gravou: ainda em aberto.** Depende de saber se a tela mostrou sucesso
   ou erro. Não é o escopo desta spec.
2. **Por que o trabalho dela desapareceu: causa conhecida e certa.** `src/components/FinancialImport.jsx`
   não tem nenhuma chamada ao banco — as 16 peças de estado (linhas, mapeamento de colunas, edições,
   aprovados, rejeitados) existem só na memória da aba. Fechar a aba apaga tudo.

E isto é uma **divergência da spec aprovada**, não um requisito novo. A seção 6 de
`2026-10-15-xlsx-financial-import-review.md` já determinava persistir o lote em
`bank_statement_imports` + `bank_statement_lines` com `source_format = 'xlsx'`, e o mapa de
propagação daquela spec começa exatamente nesse passo. O commit `ebe8d04` ("separate retroactive
financial import") separou o importador retroativo da conciliação e removeu essa etapa.

A hipótese de por que foi removida: `bank_statement_imports.financial_account_id` é `not null` e
referencia `financial_accounts`, e o fluxo retroativo não tem conta bancária — a própria tela diz
"Nenhuma conta bancária é necessária". A separação resolveu o conflito eliminando a persistência.

## 3. Área e lugar na navegação

Financeiro → **Importar lançamentos retroativos** (`/app/financial-import`). Nenhuma mudança de
navegação, nenhuma tela nova. A tela ganha um estado de "retomar importação em andamento".

## 4. Benchmark e o que copiar

- **Olist / Tiny ERP:** importação em lote com lote auditável, retomada e histórico de importações.
- **Espelho interno (mais importante):** a conciliação bancária **desta mesma plataforma** já faz
  isso corretamente — lote, linhas, `review_status` reversível, `movement_fingerprint`, reserva por
  token. O padrão a copiar está em casa, em `supabase/bank_reconciliation_schema.sql`.

## 5. Fluxo ideal

1. A usuária escolhe a planilha. O parse continua **100% no navegador** (nada muda aqui).
2. **Novo:** ao concluir o parse, o lote é gravado com as linhas normalizadas e `review_status = 'pending'`.
   A tela só mostra a revisão depois dessa gravação confirmada — se ela falhar, a usuária vê o erro
   e nenhum trabalho é iniciado sobre base volátil.
3. Ela revisa: edita, rejeita, reabre. **Cada decisão é gravada na linha do lote**, de forma reversível.
4. Ela fecha a aba, cai a internet, troca de computador. Ao voltar em `/app/financial-import`, a tela
   oferece **"Retomar importação de `MOV 09-2026.xlsx` — 163 de 188 linhas revisadas"**.
5. Ela confirma. A aprovação continua pelo `saveDataNow` existente, em lotes, com os mesmos UUIDs
   determinísticos (idempotência preservada).
6. Se a confirmação falhar no lote 2 de 4, as linhas do lote 1 ficam marcadas como aprovadas no
   banco. Ao retomar, só os 3 lotes restantes são oferecidos — e nunca há dupla criação.
7. Concluído, o lote vira histórico (`status = 'ready'`), consultável e não reaproveitável.

## 6. Modelo de dados e propagação

### Decisão pendente (é a única escolha real desta spec)

| Opção | O que é | Prós | Contras | Veredito |
|---|---|---|---|---|
| **A** | Tornar `bank_statement_imports.financial_account_id` nullable e reusar as tabelas da conciliação, como a spec de 15/10 previa | Zero tabela nova; reusa `review_status`, fingerprint e reserva já testados | Enfraquece um invariante que hoje protege a conciliação: toda linha de extrato pertence a uma conta bancária | Não recomendado |
| **B** | Tabelas dedicadas `financial_import_batches` + `financial_import_lines` | Invariantes próprios (sem conta bancária, sem conciliação); não toca a conciliação | Duas tabelas novas + RLS; alguma duplicação de forma com a conciliação | **Recomendado** |
| **C** | Persistir a revisão em `localStorage`/`sessionStorage` | Nenhum SQL | Não sobrevive a trocar de máquina nem a limpar o navegador; e o projeto já teve perda de dado por rascunho em cache (incidente de 11/10) | Rejeitado |

**Recomendação: B.** O importador retroativo tem invariantes genuinamente diferentes da conciliação
(não há conta bancária, não há vínculo a conciliar). Foi justamente essa diferença que motivou a
separação do commit `ebe8d04`. Colar o fluxo retroativo de volta nas tabelas da conciliação
reintroduz a tensão que a separação resolveu, e o preço é afrouxar um `not null` que hoje protege
dado de extrato bancário.

### Esboço do modelo (opção B)

```
financial_import_batches
  id, user_id (dono/clínica), imported_by (quem subiu),
  file_name, file_hash (unique por user_id → bloqueia reimportar o mesmo arquivo),
  sheet_name, column_mapping jsonb, expected_line_count, line_count,
  status ('reviewing' | 'ready' | 'archived'),
  period_start, period_end, created_at, ready_at, archived_at

financial_import_lines
  id (= UUID determinístico de financialImportUuid → idempotência preservada),
  user_id, batch_id, source_line_key, line_index,
  posted_date, amount, description, normalized_description, movement_fingerprint,
  source_metadata jsonb (aba, linha física, categoria, centro de custo, referência, observação),
  review_status ('pending' | 'edited' | 'rejected' | 'approved'),
  chart_account_id (nullable),
  reviewed_by, reviewed_at, created_at, archived_at
```

Dois pontos deliberados:

- **`id` da linha = o UUID determinístico atual** (`financialImportUuid(fileHash:lineKey)`), que já é o
  id da origem financeira criada. Isso mantém a idempotência que existe hoje e dá o vínculo
  linha↔lançamento de graça, sem tabela de ligação.
- **A retomada de confirmação parcial** usa `review_status = 'approved'`, gravado só depois de o
  bloco ser confirmado no financeiro. Ver seção 14, decisão 1.

### Mapa de propagação

```text
XLSX (parse somente no navegador)
  → financial_import_batches + financial_import_lines   [ETAPA NOVA]
      · lote auditável e retomável
      · NENHUM efeito em DRE, caixa, contas, metas ou dashboard
      · revisar, editar, rejeitar e reabrir NÃO tocam o financeiro
  → aprovação (inalterada, via saveDataNow)
      → extra_revenues / expenses (fonte canônica)
          → financialLedger → financial_entries / financial_installments
          → competência → DRE
          → vencimento  → contas a pagar/receber
          → caixa       → fluxo de caixa
          → buildMetrics → Dashboard, metas, relatórios, assistente
```

O ponto central de fidedignidade: **a etapa nova fica inteiramente antes da fonte canônica**. Ela não
cria, não altera e não deriva nenhum valor financeiro. Um lote em revisão é invisível para DRE,
fluxo e totais. Isso mantém a regra de fonte única: o financeiro continua derivando só de
`extra_revenues`/`expenses`.

## 7. Pontos de integração/automação

- Parse continua no cliente. **Nenhuma função Vercel nova** (atenção ao limite de 12 do plano Hobby,
  já em 12/12 pela memória do projeto).
- `file_hash` único por `user_id` bloqueia reimportar o mesmo arquivo na mesma clínica — igual à
  conciliação.
- Nada de WhatsApp, boleto, OFX, Google ou assinatura toca este fluxo.

## 8. Permissões

Mantém o que já vale para `financial-import` em `src/lib/roleAccess.js`: **Administrador e Gestão**.
Equipe não acessa. RLS das tabelas novas segue o padrão do financeiro:
`user_id = data_owner_id() and finance_role_can_manage()`, igual a `extra_revenues`/`expenses` —
e `imported_by`/`reviewed_by` com `= auth.uid()`, para preservar autoria real (foi o mesmo erro
corrigido em `audit_logs` no commit `fe7e769`).

## 9. Mapa de arquivos

**Criar**
- `supabase/financial_import_batches_schema.sql` — tabelas, índices, RLS, grants (idempotente).
- `src/lib/financialImportStore.js` — leitura/gravação do lote e das decisões (camada fina).
- `src/lib/financialImportBatch.js` — lógica **pura**: montar lote a partir do parse, aplicar
  decisão, calcular progresso, decidir o que falta aprovar numa retomada.
- `tests/unit/financialImportBatch.spec.js` — testes das funções puras.

**Editar**
- `src/components/FinancialImport.jsx` — gravar o lote após o parse; persistir cada decisão; oferecer
  retomada; derivar o que falta de `approved_source_id`.
- `docs/superpowers/plans/2026-10-15-xlsx-financial-import-review.md` — anotar que a persistência
  prevista na seção 6 foi entregue aqui, com o histórico da divergência.
- `CHANGELOG.md` — obrigatório (regra 7).

**Não tocar**
- `src/lib/financeStore.js`, `src/lib/financialLedger.js`, `src/lib/ledgerPersistence.js`,
  `src/financialMetrics.js` — a aprovação continua pelo caminho existente, sem alteração.

## 10. Tasks

1. SQL das duas tabelas com RLS e grants (idempotente, após autorização da opção B).
2. `financialImportBatch.js` puro + testes: montar lote, aplicar decisão, progresso, pendências de retomada.
3. `financialImportStore.js`: criar lote, gravar decisão, carregar lote em revisão, fechar lote.
4. Gravar o lote ao concluir o parse, **bloqueando a revisão até a confirmação da gravação**.
5. Persistir cada decisão (editar/rejeitar/reabrir) na linha correspondente.
6. Banner de retomada em `/app/financial-import` quando existir lote com `status = 'reviewing'`.
7. Na aprovação, gravar `approved_source_id` por linha para a retomada ser exata.
8. Fechar o lote (`ready`) quando não restar linha pendente.
9. Testes e `CHANGELOG.md`.

## 11. Checklist de fidedignidade (seção 5.3)

- [ ] **Soma bate:** o lote não produz total nenhum; os totais continuam derivando só de
      `extra_revenues`/`expenses` via `buildMetrics`. Asserção: criar lote de 188 linhas e verificar
      que DRE, fluxo e dashboard ficam **idênticos** antes e depois, sem aprovação.
- [ ] **Propagou:** aprovar segue pelo `saveDataNow` → razão → métricas, sem caminho alternativo.
      Asserção: aprovar uma linha e conferir que ela aparece em DRE (competência), contas (vencimento)
      e fluxo (caixa).
- [ ] **Três datas:** a data da planilha alimenta competência, vencimento e caixa, exatamente como
      hoje, e isso continua explícito na tela antes de confirmar. A etapa nova não as reinterpreta.
- [ ] **Sem órfão:** `id` da linha = UUID da origem, então aprovar duas vezes não duplica. Rejeitar
      uma linha já aprovada deve ser **proibido** (a origem financeira já existe) — testar.
- [ ] **Estados de pagamento:** inalterados (receita `recebido`, despesa `pago`, com a data da planilha).
- [ ] **Teste automatizado cross-módulo:** asserção de que lote em revisão **não** altera `buildMetrics`,
      mais o teste de retomada após falha parcial.
- [ ] **Sem mock em fluxo real** e contrato front/back alinhado (SYSTEM_RULES 4 e 5).

## 12. Testes e aceitação

- `npm run test:unit` e `npm run build`.
- E2E em `/app/financial-import`: subir planilha, revisar, **recarregar a página**, retomar de onde
  parou, aprovar, e confirmar que reimportar o mesmo arquivo não duplica nada.
- Validar com `MOV 09-2026.xlsx` (a planilha real da clínica): 188 linhas, 93 entradas, 95 saídas,
  R$ 346.859,26 de entradas e R$ 216.938,35 de saídas — os mesmos números da aceitação da spec de 15/10.
- Confirmar que um lote em revisão não altera DRE, fluxo, contas, metas nem dashboard.
- Rodar `code-reviewer` antes do merge.

## 13. Riscos de regressão (explícitos, conforme protocolo do CLAUDE.md)

1. **Gravar o lote antes da revisão adiciona um ponto de falha onde hoje não há nenhum.** Hoje a
   usuária sempre consegue revisar (mesmo que em vão); com a mudança, uma falha de gravação a
   bloqueia na entrada. É o trade-off aceito: melhor bloquear na entrada do que perder horas de
   trabalho no fim. **Mitigação:** mensagem de erro explícita com retry, nunca degradação silenciosa.
2. **Volume.** 188 linhas é pequeno, mas o limite da tela é 50.000. A gravação do lote precisa ser em
   lotes (o `syncTable` já usa 500) e o read-back precisa valer por lote, senão repete o bug de
   truncamento em ~1000 linhas que o comentário de `financeStore.js:461` registra.
3. **Duas abas na mesma importação.** Duas abas revisando o mesmo lote podem sobrescrever decisões.
   A conciliação resolve com reserva por token; aqui, o mínimo é a última decisão vencer por linha
   (não por lote), para nunca perder a revisão inteira por causa de uma linha.
4. **Não resolve a causa raiz do incidente.** Esta spec garante que o trabalho não se perca e que a
   falha fique visível. Se a confirmação estiver quebrada por outro motivo, ela **continuará
   quebrada** — só deixará de custar a revisão inteira.

## 14. Decisões tomadas durante a implementação

Três ajustes ao desenho desta spec, feitos ao implementar e registrados aqui para o histórico ficar
honesto:

**1. `approved_source_id` foi removida.** A coluna seria redundante: o id da linha **é** o id da
origem financeira, por construção (`financialImportUuid`). Pior, ela não poderia ser mantida
corretamente — marcar N linhas como aprovadas é um `update ... in (ids)`, e o PostgREST não envia
valor por linha num update em lote; manter a coluna exigiria uma requisição por linha. A retomada
usa `review_status = 'approved'`, que é gravado só após o bloco ser confirmado no financeiro.

**2. A identidade do lote é o par (arquivo, aba), não só o arquivo.** Um `.xlsx` com várias abas tem
o **mesmo** `file_hash` em todas elas. Com a chave só no hash, trocar de aba depois de criar o lote
faria a tela "retomar" as linhas da aba anterior — silenciosamente, com os dados errados. O índice
único passou a ser `(user_id, file_hash, coalesce(sheet_name, ''))`, e `sheet_name` é gravado como
string vazia (nunca NULL, que não casaria nem com o índice nem com a busca).

**3. Migration ausente degrada com aviso, não bloqueia.** A spec dizia bloquear a revisão até o lote
estar gravado. Aplicado ao pé da letra, isso quebraria o importador para todos entre o deploy do
código e a execução do SQL — violando a regra 2 do `SYSTEM_RULES`. O comportamento implementado:
se as tabelas não existem, a revisão continua em memória (como hoje) **com faixa amarela explícita**
dizendo que o trabalho não está sendo salvo e qual migration falta. Qualquer OUTRA falha de gravação
bloqueia, como a spec previa. A distinção usa `isMissingRelationError`, do commit `ed38d00`.

## 15. Correções da revisão de código (29/10)

A revisão encontrou dois bloqueadores e um alto, todos confirmados. O que mudou:

**4. O lote nasce `creating` e só é promovido a `reviewing` depois do read-back do último bloco.**
Antes, o lote era criado como `reviewing` **antes** das linhas: uma gravação interrompida no bloco 2
(arquivos acima de 500 linhas) deixava um lote retomável com linhas faltando, e nada comparava
`rows.length` com `line_count`. A revisão abriria incompleta **em silêncio** — a mesma perda que
esta feature veio impedir. Agora `isBatchComplete` (puro, testado) valida a contagem na retomada, e
um lote incompleto é recusado com um card de **"Descartar e começar de novo"**. Esse card é
obrigatório: o lote ocupa o índice único do arquivo, então sem ele o usuário ficaria preso.

**5. A PK das linhas passou a ser `(batch_id, id)`, não só `id`.** O id é determinístico
(`fileHash:lineKey`), então o mesmo id aparece legitimamente em lotes diferentes: abas distintas do
mesmo arquivo, clínicas distintas importando o mesmo arquivo, e um novo lote após um descartado.
Com PK só em `id`, o rollback deixava as linhas do primeiro bloco vivas e **todo upload futuro
daquele arquivo falhava por violação de chave, para sempre**. O descarte agora arquiva lote **e**
linhas. A migração inclui um bloco idempotente que corrige a PK em bancos onde a versão anterior
já foi aplicada.

**6. Reimportar um lote `ready` deixou de estourar erro cru.** O índice único cobre tudo que não
está arquivado, inclusive `ready`, mas a busca só olhava `reviewing` — então subir de novo um
arquivo já concluído dava `duplicate key` na cara do usuário, quando antes desta feature o upload
funcionava e mostrava as linhas como já existentes. Agora a busca inclui `creating`, `reviewing` e
`ready`, e um lote `ready` é reaberto (`reopenBatch`), o que também devolve a possibilidade de
rever rejeições depois de recarregar a página.

**7. Leitura paginada.** O PostgREST corta a resposta em 1.000 linhas por padrão. Um lote de 1.500
voltava truncado **sem erro**, e o limite da tela é 50.000. As leituras agora paginam com `.range()`
até esgotar.

**8. Atualização por lista de ids em blocos de 120.** Cada UUID ocupa ~39 caracteres na URL;
"rejeitar todas pendentes" com centenas de linhas estouraria o limite do gateway. O caso real da
clínica (188 linhas) passava raspando.

**9. Fingerprint recalculado na edição.** `updateStatementLine` não recalcula
`movementFingerprint`, então a coluna mantinha o valor dos dados ORIGINAIS enquanto a memória usava
o dos dados editados. Resultado: a detecção de duplicados dava resultado diferente antes e depois
de retomar. `saveLineEdit` passa a gravar o fingerprint e o `source_line_key` recalculados, com
teste de round-trip pós-edição. O `externalId`, que não tem coluna própria, passou a viajar no
`source_metadata`.

**10. Decisão não sobrescreve linha aprovada.** `reject`/`edit`/`reopen` agora levam
`.neq('review_status','approved')`: uma linha já no financeiro não pode voltar a "rejeitada" no
lote por ação de outra aba ou de outro usuário. Rejeitar em massa também passou a ignorar linhas
`existing`, que já estão no financeiro e só distorceriam o progresso.

**11. Falha ao marcar o progresso da aprovação agora aparece.** Não é perda de dado — a
idempotência segura: ao retomar, essas linhas aparecem como "já existe". Mas era descartada em
silêncio e agora é avisada.
