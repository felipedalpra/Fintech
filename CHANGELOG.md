# CHANGELOG

Este projeto segue o padrão de changelog por versão, com categorias fixas:
- `Added`: novas funcionalidades
- `Changed`: alterações em comportamentos existentes
- `Fixed`: correções de bugs

## [Unreleased] - 2026-10-12 (73)
### Added
- **Integração Meta Ads — MVP (conexão + lead em tempo real no pipeline)**: Lead Ads do Meta (Facebook/Instagram) entram **automaticamente no funil** em "Primeiro Contato", etiquetados com a campanha/anúncio de origem (`source='meta'`). (1) Schema `supabase/meta_integration_schema.sql`: tabela `meta_connections` (ad_account_id, page_id, access_token/app_secret **write-only** — SELECT revogado do frontend, igual whatsapp_numbers; verify_token; status; RLS `data_owner_id()`); campos `meta_lead_id`/`meta_campaign_id`/`meta_ad_id`/`meta_form_id` em `opportunities` com índice único por `(user_id, meta_lead_id)`; RPC `ensure_meta_lead` (idempotente, cria paciente + oportunidade, espelha `ensure_whatsapp_lead`). (2) Webhook `leadgen` servido por `api/whatsapp.js?action=meta-webhook` (consolidado — Vercel Hobby 12/12 funções; **não** criei `api/meta.js`): verificação por `META_VERIFY_TOKEN`, roteia o lead à clínica pelo `page_id`, busca o lead na Graph API e chama a RPC; sempre responde 200 (idempotente). Lógica pura em `api/_lib/meta.js` (`parseLeadgenWebhook`, `verifyWebhookSignature`, `mapLeadFields`, `fetchLeadData`). (3) Tela admin **Configurações → Meta Ads** (`MetaConnection.jsx`): credenciais (segredos write-only) + URL do webhook. **Ativação real exige App Review + Verificação de Negócio no Meta** (`leads_retrieval`/`ads_read`) — arquitetura pronta-pra-credencial. Design em `docs/superpowers/specs/2026-10-12-meta-ads-crm-integration-design.md`. Testes: `tests/unit/meta.spec.js` (3). Próximas fases: insights/dashboard de anúncios, atribuição CAC/ROAS até a receita, laço CAPI.

## [Unreleased] - 2026-10-12 (72)
### Added
- **Drill-down auditável dos indicadores financeiros**: cards e agrupamentos de faturamento, receitas, despesas, lucro, caixa, contas a pagar/receber, DRE, balanço, produtos, metas e resumos de cirurgias agora abrem um modal com cada lançamento que compõe o valor. O detalhamento mostra data, origem, descrição, pessoa, categoria, situação e valor, permite busca e confere automaticamente se a soma bate a centavo com o indicador. Resultados líquidos exibem receitas positivas e custos/saídas negativos, preservando o mesmo razão canônico dos relatórios.

### Changed
- `buildMetrics` passa a publicar `drilldowns` derivados durante o mesmo cálculo canônico de competência, caixa, obrigações, CMV e posição patrimonial; não há uma segunda regra de agregação na interface. `Card` ganhou interação acessível opcional por teclado e o modal base permite telas somente leitura sem alerta indevido de descarte.
- A aba desatualizada **Impostos** e seu simulador de Carnê-Leão/IRPF/DAS foram removidos da navegação, busca, permissões e rotas. Categorias, lançamentos e valores tributários permanecem no razão, nas métricas e nos relatórios financeiros.

### Fixed
- O resumo do Financeiro que exibia o saldo líquido de entradas menos saídas deixou de se chamar “Recebido no período” e passa a usar o nome correto “Resultado de caixa”.

## [Unreleased] - 2026-10-12 (71)
### Added
- **Write-through persistido do razão financeiro**: todo salvamento operacional agora projeta e faz upsert idempotente em `financial_entries` e `financial_installments`, preservando origem/componente, parte, competência, vencimento, liquidação real, forma de pagamento e valores pagos. Reduções de cronograma e exclusões da origem usam `archived_at` reversível, sem delete físico. Recorrências vencidas no ano também são sincronizadas ao abrir Financeiro/Recorrências e ocorrências removidas ou pausadas são arquivadas. Implementação em `src/lib/ledgerPersistence.js`; regressões em `tests/unit/ledgerPersistence.spec.js`.

### Changed
- `financial_installments` passa a ter `archived_at` e índice de linhas ativas; o cronograma canônico preserva a forma de pagamento em cada parcela. A leitura financeira permanece na projeção já validada durante a transição, enquanto a cópia persistida é alimentada em paralelo para backfill e reconciliação segura.

## [Unreleased] - 2026-10-12 (70)
### Changed
- **Recorrências incorporadas ao razão canônico**: cada ocorrência mensal, semanal ou anual passa a gerar um título com componente estável `occurrence:AAAA-MM-DD`, participando da DRE, caixa, contas a pagar/receber, posição patrimonial, relatórios e conferência pela mesma projeção financeira. Regras com baixa automática geram liquidação na data da ocorrência; regras sem baixa permanecem abertas. Se a ocorrência já foi materializada como receita/despesa operacional, o razão a deduplica. O gerador puro foi extraído para `src/lib/recurrenceSchedule.js` e ganhou regressões de geração e não duplicação.

## [Unreleased] - 2026-10-12 (69)
### Added
- **Liquidação independente de custos clínicos**: hospital, anestesia, material, outros custos e imposto/NF passam a ter, por componente, fornecedor/credor, situação, competência, vencimento, data real e forma de pagamento. Cirurgias, consultas e a edição no Financeiro compartilham o novo editor; cada componente continua gerando um título a pagar próprio no razão. Schema aditivo em `supabase/clinical_cost_settlements_schema.sql`, com metadados em `cost_settlements` sem inventar backfill para registros antigos.

### Changed
- Razão, contas a pagar, caixa, relatórios Excel, auditoria de qualidade e assistente financeiro passam a respeitar a liquidação de cada custo clínico. Custos antigos sem metadados preservam temporariamente o comportamento histórico, mas seguem identificados como bloqueio até conferência; custos novos/editados nascem conservadoramente em aberto.

## [Unreleased] - 2026-10-12 (68)
### Added
- **Vendas de produto com as três datas financeiras**: `product_sales` passa a guardar `competence_date`/`sale_date`, `due_date` e `received_date` separadamente. O formulário exige a data real de recebimento quando a venda estiver recebida ou o vencimento quando estiver em aberto; as ações rápidas também gravam a liquidação real. O razão, a Central de Relatórios e o assistente financeiro passam a consumir esses campos sem transformar automaticamente vendas antigas em recebidas. Migração aditiva em `supabase/product_sales_settlement.sql`.

### Changed
- A listagem e a edição financeira de vendas de produto agora exibem situação e a data correspondente de liquidação/vencimento. O gate de prontidão deixa de bloquear vendas recebidas que já possuem `received_date`, mantendo apenas os registros legados sem comprovação como pendência.

## [Unreleased] - 2026-10-12 (67)
### Changed
- **Razão financeiro — Fase 10 ativada como fonte das métricas**: `buildMetrics` agora deriva DRE por competência, caixa por liquidação, contas a receber/pagar e posição patrimonial da projeção canônica de `financialLedger`, eliminando cálculos paralelos no Dashboard, Financeiro, metas, alertas e IA. A posição histórica mantém um título aberto até sua data real de liquidação; cancelados são excluídos; impostos de NF congelados prevalecem sobre a alíquota atual; vendas de produtos respeitam o cronograma de parcelas. Recorrências continuam anexadas de forma identificada até ganharem títulos próprios. `paymentScheduleFlow` foi extraído para módulo independente para evitar dependência circular.
- **CMV e estoque contabilmente separados das compras**: compras de produtos afetam caixa/contas a pagar e formam o ativo de estoque; a DRE reconhece apenas o **CMV** das unidades vendidas, pelo custo médio móvel histórico preparado na Fase 6. Balanço, posição de estoque, margem por produto e Excel passam a usar a mesma valorização histórica, sem transformar toda compra do mês em despesa.
- **Relatórios Excel ligados à mesma fonte financeira**: contas a pagar/receber e fluxo projetado passam a consumir as obrigações do `buildMetrics`, incluindo vendas e compras de produtos. Relatórios detalhados de receitas/despesas excluem cancelados, mostram a situação financeira dos produtos e respeitam o imposto congelado; relatórios de estoque, Curva ABC, margem e clientes também deixam de contar vendas/compras canceladas. A tela **Conferência do razão** passa de gate pré-Fase 10 para auditoria contínua da fonte ativa.

### Fixed
- **Ações rápidas coerentes com o razão**: marcar receita recorrente/extra, venda de produto ou compra de produto como liquidada agora grava os campos de situação e data usados pela projeção canônica; voltar receita extra para pendente preserva a data histórica de competência/registro.

### Added
- **Regressão da fonte canônica**: testes garantem separação entre competência e caixa, posição histórica de títulos, exclusão de cancelados e presença de vendas/compras abertas nos Excel (`tests/unit/financialMetricsLedger.spec.js`, `tests/unit/reportCatalog.spec.js`).

## [Unreleased] - 2026-10-12 (66)
### Fixed
- **Falso bloqueio no gate do razão**: receitas extras antigas guardavam a data real do recebimento em `date`, campo historicamente apresentado na UI como **Data do recebimento**. O auditor exigia exclusivamente o novo `received_date` e marcou 18 lançamentos válidos como “liquidações sem data real”. `auditLedgerReadiness` agora aceita `receivedDate || date`, igual ao próprio razão, e apresenta esses registros apenas como aviso de migração. Nenhum valor ou data financeira foi alterado. Teste de regressão em `tests/unit/financialLedger.spec.js`.

## [Unreleased] - 2026-10-12 (65)
### Added
- **Gate de prontidão do razão**: a tela **Financeiro → Conferência do razão** agora audita, além da reconciliação a centavo, os pré-requisitos para a Fase 10: invariantes das parcelas, vendas/compras antigas sem situação confirmada, liquidações sem data real, custos ainda liquidados por aproximação e títulos sem datas obrigatórias. Vínculos ausentes de cliente/fornecedor e impacto de cancelamentos aparecem como alertas separados. Enquanto existir bloqueio, a tela deixa explícito que o razão ainda não pode virar a fonte de verdade. Implementação pura em `src/lib/financialLedger.js`, apresentação responsiva em `src/components/LedgerCheck.jsx` e cobertura em `tests/unit/financialLedger.spec.js`/`tests/e2e/ledger-check.spec.js`. Nenhuma leitura ou valor do financeiro foi alterado.

## [Unreleased] - 2026-10-12 (64)
### Added
- **Conferência do Razão (validação pré-Fase 10)**: nova tela admin **Financeiro → Conferência do razão** (`src/components/LedgerCheck.jsx`, nav/rotas em `FinanceWorkspace.jsx`, acesso admin/gestão em `UserRoleContext.jsx`) que valida o razão (projeção) antes de virar a fonte de verdade das métricas. **Seção A — Razão × Fonte:** reconciliação por origem (cirurgias, consultas, vendas, receitas, despesas, compras, custos) mostrando soma do dado bruto × soma dos títulos do razão; tem que **bater a centavo** (badge ✓/⚠). **Seção B — Razão × Dashboard:** compara contas a receber/pagar em aberto e receita bruta do razão com o `buildMetrics`, anotando as diferenças **esperadas** (recorrências não entram no razão; vendas/compras "a conferir" entram como aberto). Função pura `reconcileLedger` em `src/lib/financialLedger.js` (testada: diff 0 em toda origem). Não altera dados; é só leitura. É o pré-requisito para, com segurança, executar a Fase 10 (virar a leitura). Teste: `tests/unit/financialLedger.spec.js` (11).

## [Unreleased] - 2026-10-12 (63)
### Added
- **Impostos/taxas/descontos por operação — Razão financeiro Fase 9 (aditivo, inerte)**: schema `supabase/operation_financials_schema.sql` adiciona a `surgeries`, `consultations` e `product_sales` os campos reais `discount_amount`, `fees_amount`, `commission_amount`, `tax_amount`, `net_amount`, `invoice_tax_rate` e `invoice_tax_amount` (nullable). No `src/lib/financialLedger.js`, o imposto de NF agora usa o **valor congelado** (`invoiceTaxAmount`) quando existir — assim mudar a alíquota no futuro não altera relatórios antigos — e **deriva** da alíquota quando não houver (projeção). A captura desses valores no formulário entra na fase de autoridade; por ora é inerte. Teste: `tests/unit/financialLedger.spec.js` (10 — inclui o imposto congelado).

## [Unreleased] - 2026-10-12 (62)
### Added
- **Contas (caixa/banco/cartão) — Razão financeiro Fase 8 / fundação (aditivo, inerte)**: tabela `financial_accounts` (nome, tipo `cash`/`checking`/`savings`/`card`/`other`, saldo de abertura + data, ativo, soft-delete, RLS `data_owner_id()`) + FK de `financial_installments.financial_account_id` (coluna criada na Fase 1) para a conta. Base para saldo real por conta, transferências (2 movimentos vinculados fora da DRE) e conciliação com extrato — que entram na fase de autoridade (tela de liquidação). SQL `supabase/financial_accounts_schema.sql`. Sem mudança de comportamento no app.

## [Unreleased] - 2026-10-12 (61)
### Added
- **Custos de cirurgia/consulta como títulos a pagar — Razão financeiro Fase 7 (projeção, inerte)**: no `src/lib/financialLedger.js`, cada custo embutido de uma cirurgia (hospital, anestesia, material, outros e imposto de NF) e de uma consulta (imposto de NF) passa a virar um **título a pagar independente** no razão, com `source_component` próprio (`hospital_cost`/`anesthesia_cost`/`material_cost`/`other_cost`/`invoice_tax`), competência e valor — em vez de ficarem embutidos no registro da cirurgia. Componente com valor 0 não gera título. Projeção: pagos na data do atendimento (igual ao modelo atual de caixa); depois (autoridade) cada custo pode ganhar vencimento/fornecedor/status próprios. Sem schema novo (derivado; a tabela `financial_entries` da Fase 1 já tem `source_component`). **Inerte** (o `buildMetrics` segue com os custos embutidos até a Fase 10). Testes: `tests/unit/financialLedger.spec.js` (9 — inclui os custos por componente).

## [Unreleased] - 2026-10-12 (60)
### Added
- **Custo histórico / CMV — Razão financeiro Fase 6 / fundação (projeção, inerte)**: cálculo correto do Custo da Mercadoria Vendida por **custo médio móvel**, para margem e DRE **não mudarem retroativamente** quando o preço de compra for alterado. (1) Schema aditivo `supabase/inventory_costing_schema.sql`: `product_sales.unit_cost_at_sale` e `total_cost_at_sale` (congelam o custo no momento da venda — capturados na fase de autoridade). (2) Módulo **puro** `src/lib/inventoryCosting.js` (`buildProductCosting`): processa os movimentos de estoque em ordem cronológica mantendo o custo médio móvel por produto e atribui a cada venda o custo vigente **na data da venda** (`CMV = quantidade × custo histórico`); retorna `salesCost` por venda, `averageByProduct` e `cmvTotal`. **Inerte:** app ainda não lê/escreve daqui (o `buildMetrics` segue usando compras do período como aproximação de CMV até a Fase 10). Testes: `tests/unit/inventoryCosting.spec.js` (3 — média móvel, estabilidade a compra posterior, compra no mesmo dia).

## [Unreleased] - 2026-10-12 (59)
### Added
- **Ledger de estoque (`inventory_movements`) — Razão financeiro Fase 5 / fundação (projeção, inerte)**: início do estoque por movimentos, no lugar de "inicial + compras − vendas". (1) Schema aditivo `supabase/inventory_movements_schema.sql`: tabela `inventory_movements` (tipos `opening`/`purchase`/`sale`/`adjustment_in`/`adjustment_out`/`loss`/`return_in`/`return_out`; quantidade sempre positiva, sinal pelo tipo; `unit_cost`/`total_cost`/`movement_date`/origem), RLS `data_owner_id()`, unicidade por origem (backfill repetível). (2) Módulo **puro** `src/lib/inventoryLedger.js` (`buildInventoryMovements`, `stockByProduct`): deriva abertura/compra/venda do dataset atual (ignora cancelados) e calcula o saldo como soma dos movimentos — **bate com o cálculo atual por construção**. **Inerte:** app ainda não lê/escreve daqui; o saldo atual segue como está. Os tipos manuais (perda/ajuste/devolução) são fatos novos — entram com a tela de registro (fase de autoridade). Testes: `tests/unit/inventoryLedger.spec.js` (3, incl. saldo = soma e sinais de ajuste/perda/devolução).

## [Unreleased] - 2026-10-12 (58)
### Added
- **Compras de produto: situação de pagamento — Razão financeiro Fase 4**: o form de compra (`Products.jsx`) ganhou **Situação** (Pago / A pagar), **Data do pagamento** (quando pago) ou **Vencimento** (quando a pagar) e **Nº da nota** (opcional) — além do Fornecedor que já entrou na Fase 2. Schema aditivo `supabase/product_purchases_settlement.sql`: `product_purchases.status` (DEFAULT `legacy_unverified` → compras antigas "a conferir", nunca assumidas como pagas), `payment_date`, `document_number`, `canceled_at`. `financeStore` grava e lê os campos (dois lados). No `financialLedger`, a compra respeita o status: **pago → caixa em `payment_date`; a pagar/legacy → em aberto no vencimento; cancelado** (antes toda compra virava saída de caixa na data), com `party_id` = fornecedor. `buildMetrics` inalterado até a Fase 10. Testes: `tests/unit/financialLedger.spec.js` (8, inclui o status da compra).

## [Unreleased] - 2026-10-12 (57)
### Added
- **Vendas de produto: cliente + situação de recebimento — Razão financeiro Fase 3**: o form de venda (`Products.jsx`) ganhou **Cliente** (`PatientSelector`, substitui o texto livre "Paciente ou ID interno") e **Situação** (Recebido / A receber). Schema aditivo `supabase/product_sales_settlement.sql`: `product_sales.patient_id` (vínculo), `status` e `canceled_at`. **Regra do Codex respeitada:** o `status` nasce com DEFAULT `legacy_unverified`, então **vendas antigas ficam "a conferir" e NÃO são assumidas como recebidas** — só o que for confirmado conta como caixa. `financeStore` grava e lê `patient_id`/`status` (dois lados). No `financialLedger`, a venda agora respeita o status: **recebido → caixa na data; pendente/legacy_unverified → em aberto; cancelado → cancelado** (antes toda venda virava caixa na data), com `party_id` = cliente. (O `buildMetrics` atual segue tratando venda como caixa-na-data até a Fase 10 virar a leitura para o razão.) Testes: `tests/unit/financialLedger.spec.js` (7, inclui o status da venda).

## [Unreleased] - 2026-10-12 (56)
### Added
- **Vínculo de parte nos lançamentos avulsos (fecha a Fase 2)**: o **form de despesa** agora tem **Fornecedor** (`SupplierSelector`) e o **form de receita extra** tem **Cliente** (`PatientSelector`, label "Cliente") — ambos em `Finance.jsx`, com escolher-ou-cadastrar-na-hora. Persistência nos dois lados (grava **e** lê, pra não perder no autosave): `expenses.supplier_id` e `extra_revenues.patient_id` (+ `received_date`) em `financeStore` (mappers e `fetchRelationalData`). `financialLedger` liga `party_id`/`party_type` corretos (despesa→fornecedor, receita→paciente). `PatientSelector` e `SupplierSelector` passam a resolver o `ownerId` sozinhos (prop `userId` opcional) e aceitam `label`. SQL aditivo: `extra_revenues.patient_id` em `supabase/suppliers_schema.sql` (coluna `expenses.supplier_id` já estava lá; `received_date` veio no `financial_ledger_schema.sql`).

## [Unreleased] - 2026-10-12 (55)
### Added
- **Fornecedores normalizados — Razão financeiro Fase 2**: cadastro de fornecedores com id estável, no lugar do texto livre que fragmentava relatórios. Tabela `suppliers` (nome, CNPJ/CPF, email, telefone, ativo, soft-delete, RLS `data_owner_id()`) + coluna `supplier_id` (nullable, retrocompatível) em `product_purchases` e `expenses`; o texto livre existente (`product_purchases.supplier`) segue como **snapshot do nome** (não reescreve histórico se o cadastro mudar). Novo componente reutilizável `src/components/SupplierSelector.jsx` (escolher ou **cadastrar na hora**, padrão do `PatientSelector`, resolve o `ownerId` sozinho) — já encaixado no **form de compra de produto** (`Products.jsx`), substituindo o campo de texto. `financeStore` grava **e** lê o `supplier_id` nas compras (os dois lados, para não perder o vínculo no autosave). `financialLedger` usa o `supplier_id` como `party_id` do título a pagar. SQL aditivo/idempotente em `supabase/suppliers_schema.sql`. (Despesas já têm a coluna; a fiação do form de despesa vem a seguir.) Design em `docs/superpowers/specs/2026-10-12-financial-core-ledger-design.md`.

## [Unreleased] - 2026-10-12 (54)
### Added
- **Razão financeiro canônico — Fase 1 / fundação (projeção, inerte por enquanto)**: início da re-arquitetura do núcleo financeiro para um razão único (ver análise em `docs/superpowers/specs/2026-10-12-financial-core-ledger-design.md`, estratégia **projeção-primeiro** aprovada). (1) Schema aditivo/idempotente `supabase/financial_ledger_schema.sql`: tabelas `financial_entries` (título a pagar/receber: direção, origem, componente, parte+snapshot de nome, competência, status) e `financial_installments` (parcela: valor, pago, vencimento, **data real de liquidação**, taxas/juros/descontos, conta), ambas com RLS `data_owner_id()`, soft-delete e unicidade por origem (`(user_id, source_type, source_id, source_component)`) para backfill repetível sem duplicar; `received_date` em `extra_revenues` (fecha o modelo de 3 datas). (2) Módulo **puro** `src/lib/financialLedger.js` (`buildLedger`, `checkLedgerInvariants`): deriva o razão do dataset atual reusando a função canônica `paymentScheduleFlow` — bate com o `buildMetrics` por construção; "atrasado" é derivado, nunca gravado. **Nada é persistido nem lido pelo app ainda** (fundação validável): o app segue com o modelo atual, sem risco. Testes: `tests/unit/financialLedger.spec.js` (6 — invariantes soma-parcelas=total e pago+aberto=total, pago/aberto/cancelado). Próximas fases (backfill persistido, fornecedores, liquidação de vendas/compras, estoque, CMV, contas bancárias) na spec.

## [Unreleased] - 2026-10-12 (53)
### Added
- **Central de Relatórios com exportação Excel**: a antiga tela de Relatórios Analíticos virou um catálogo com 22 relatórios exportáveis, filtros por período/categoria/busca e pacote consolidado `.xlsx`. Inclui contas a pagar e receber, caixa realizado e projetado, DRE, receitas/despesas, balanço gerencial, estoque, movimentações, vendas, compras, Curvas ABC, margem de contribuição, cirurgias, consultas, procedimentos, pacientes, metas e auditoria de qualidade. Cada planilha leva resumo, dados tipados, metodologia, fontes e alertas de integridade. Referência funcional: relatórios financeiros, de vendas, clientes e estoque do ERP Olist. Arquivos principais: `src/components/Reports.jsx`, `src/lib/reportCatalog.js`, `src/lib/reportWorkbook.js` e `tests/unit/reportCatalog.spec.js`.

### Changed
- A navegação e o cabeçalho de `/app/reports` agora apresentam a página como **Central de Relatórios** e deixam explícito que as exportações são em Excel. A tela passa a carregar pacientes e recorrências no mesmo escopo da clínica (`ownerId`) e bloqueia exportações incompletas se uma dessas fontes falhar. `src/pages/FinanceWorkspace.jsx`, `src/components/Reports.jsx`.
- **Cirurgias e Consultas movidas do bloco Financeiro para o bloco Pacientes/CRM** (organização): na navegação (`src/pages/FinanceWorkspace.jsx`, `AREAS`), **Consultas** e **Cirurgias** saíram da seção "Operação" do Financeiro e entraram numa nova seção **"Atendimentos"** dentro da área **Pacientes**. Mesma funcionalidade e rotas (`sales`/`consultations` inalterados) — só mudança de lugar, mais organizado. **Efeito colateral positivo:** a área Pacientes é visível a todos os perfis, então agora Consultas/Cirurgias respeitam a permissão **por item** (`ROLE_ACCESS`) — ex.: concierge/equipe passam a ver o que já tinham direito (antes ficavam escondidas porque a área Financeiro é só admin/gestão). Produtos, Procedimentos e Recorrências seguem no Financeiro.

### Fixed
- Cirurgias e consultas canceladas deixam de compor receita, custos, resultado e caixa nos cálculos financeiros compartilhados. Antes, o status cancelado era removido apenas de alguns contadores e contas em aberto, mas ainda podia contaminar DRE e fluxo. `src/financialMetrics.js`.

## [Unreleased] - 2026-10-11 (52)
### Added
- **Funil: estágios de cirurgia + oportunidade nasce no estágio certo** (CRM, Fase 2 — revisão da automação do funil): (1) **dois estágios novos** no pipeline — **Cirurgia Marcada** e **Cirurgia Feita** (entre Reserva Paga e Follow-up), para acompanhar a cirurgia no funil; (2) a automação agora **cria a oportunidade se ela ainda não existe** — paciente cadastrado já com consulta/cirurgia **entra no funil no estágio certo** em vez de sumir ou cair em "primeiro contato" (resolve o caso da secretária que cadastra alguém já marcado); (3) mapeamento revisto: consulta criada → **Consulta Agendada**, cirurgia criada → **Cirurgia Marcada**, pagamento (pago/parcelado) → **Reserva Paga**, e data da cirurgia já passada → **Cirurgia Feita** (rotina diária no cron de alertas). Tudo **forward-only por rank** (`funnel_stage_rank` — nunca regride/pula pra trás, não sobrescreve avanço manual), **auditável** (`opportunity_stage_history`, `source='automacao'`) e **fail-safe**. Paciente sem evento não entra no funil (é só contato, estilo Kommo). Estágios atualizados em `opportunities` (constraint), `OpportunityPipeline.jsx`, `FollowupRules.jsx`, `src/lib/timeline.js` e `api/_lib/stageSuggest.js` (ordem/rank + descrições + palavras-chave). SQL (constraint + `funnel_stage_rank` + `auto_funnel_set_stage` com criar-se-não-existe + 3 triggers + `process_funnel_daily`) em `supabase/funnel_automation_schema.sql`; chamada diária em `api/alerts/process.js`. Testes: `tests/unit/stageSuggest.spec.js` (ranks atualizados). Design em `docs/superpowers/specs/2026-10-11-funnel-automation-opportunities-design.md`.

## [Unreleased] - 2026-10-11 (51)
### Added
- **Automação do funil (evento → estágio)** (CRM, Fase 2 — fecha o sub-projeto 4, motor de automação): a **oportunidade** avança de estágio sozinha quando um evento claro acontece — consulta criada: `consulta_agendada`→`consultado`; cirurgia criada: `consultado`→`orcamento_enviado`; pagamento da cirurgia vira `pago`/`parcelado`: `orcamento_enviado`→`reserva_paga`. Via **triggers Postgres** (SQL puro, sem mudança no frontend — o pipeline já lê `opportunities.stage`). **Forward-only** (guarda pelo estágio anterior — nunca regride nem pula), **auditável** (grava em `opportunity_stage_history` com `source='automacao'`, então a régua de follow-up também dispara) e **fail-safe** (erro na automação nunca aborta o insert/update da consulta/cirurgia). Usa `opportunity_id` do evento; sem ele, só age se o paciente tem exatamente 1 oportunidade aberta (ambíguo → não chuta). Guarda `IS DISTINCT FROM` no pagamento ignora o re-save do autosave. Funções `auto_advance_opportunity`/`resolve_event_opportunity` + 3 triggers em `supabase/funnel_automation_schema.sql`. Design em `docs/superpowers/specs/2026-10-11-funnel-automation-opportunities-design.md`. (Adapta o plano antigo `2026-10-08-automacoes-funil.md`, que mirava o vestigial `patients.funnel_stage`.)

## [Unreleased] - 2026-10-11 (50)
### Added
- **Auditoria por registro (resiliência — rastreabilidade de quem mexeu em quê)**: trigger genérico no banco (`public.log_record_change`) registra em `public.record_audit` cada **insert / update / archive / restore / delete** de registros do cliente (cirurgias, consultas, despesas, receitas, vendas, compras, procedimentos, produtos, metas, ativos, passivos e pacientes), com **autor** (`auth.uid()`), **dono** (`user_id`), **timestamp** e **snapshot antes/depois** (jsonb). Ignora re-save idêntico (o autosave reescreve o dataset inteiro — sem isso haveria 1 log por linha a cada save). RLS: leitura só para a clínica dona (`data_owner_id()`); escrita só pela trigger (SECURITY DEFINER). Teria tornado trivial o diagnóstico do incidente de 11/10 ("quem apagou o quê e quando"). SQL puro, idempotente, sem mudança no app: `supabase/record_audit.sql`. Fecha a camada de resiliência da revisão `docs/superpowers/specs/2026-10-11-data-persistence-safety-review.md` (resta só confirmar política de PITR/backup, ação de infra).

## [Unreleased] - 2026-10-11 (49)
### Changed
- **Soft-delete no núcleo financeiro/operacional (resiliência — regra #1 de não perder dados)**: excluir um registro financeiro (cirurgia, consulta, despesa, receita, venda, compra, procedimento, produto, meta, ativo, passivo) deixou de **apagar fisicamente** — agora marca `archived_at` e o app **oculta** os arquivados na leitura. Exclusão passa a ser **reversível** (recuperável por `update ... set archived_at = null`), como já era em pacientes/prontuário. `src/lib/financeStore.js`: `syncTable` faz UPDATE `archived_at` em vez de DELETE; `fetchRelationalData` filtra arquivados **em JS** (tolerante — se a coluna ainda não existe, nada quebra). **Tolerante à ordem do deploy:** sem risco de perda em nenhum cenário (sem a coluna, a exclusão apenas não propaga; nada é apagado). SQL idempotente em `supabase/finance_soft_delete.sql` (coluna `archived_at` nas 11 tabelas + índices parciais de ativos). Fecha a camada de resiliência da revisão `docs/superpowers/specs/2026-10-11-data-persistence-safety-review.md`.

## [Unreleased] - 2026-10-11 (48)
### Added
- **Filtros padrão em todos os módulos de lista (Fase C)**: novo componente reutilizável `src/components/FilterBar.jsx` (busca + selects de filtro + ordenação + contador + ações à direita, padrão CRM, dark-mode safe), aplicado de forma consistente em:
  - **Pacientes** (`Patients.jsx`): busca por nome/CPF/telefone; **Status** (Ativos/Arquivados/Todos — antes não dava para ver arquivados); **TCLE** (Assinado/Pendente); ordenação (Nome/Mais recentes); **Reativar** arquivado (arquivar deixou de remover o registro do estado).
  - **Consultas** (`Consultations.jsx`): busca; **Pagamento** (Todos/Pago/Pendente/Parcelado); ordenação (Recentes/Antigas/Maior valor).
  - **Cirurgias** (`Sales.jsx`): busca; **Pagamento** (status existente convertido ao padrão); ordenação (Recentes/Antigas/Maior valor).
  - **Procedimentos** (`Plans.jsx`): busca; ordenação (Nome/Maior preço/Menor preço).
  - **Produtos** (`Products.jsx`): busca; **Status** (Todos/Ativos/Inativos).
  Todos com botão **Limpar** quando há filtro ativo. Antes só o Financeiro tinha filtros. Plano em `docs/superpowers/specs/2026-10-11-data-persistence-safety-review.md`.

## [Unreleased] - 2026-10-11 (47)
### Fixed
- **Fim do delete-sync destrutivo no Financeiro (Fase B — correção estrutural de fidedignidade)**: o salvamento do dataset financeiro/operacional não apaga mais linhas "ausentes na memória" comparando com o **banco** — agora a deleção é calculada contra o **baseline do próprio cliente** (o que ele carregou/persistiu nesta sessão). Consequência: **nunca mais se apaga uma linha que o cliente não conhecia** — acaba a perda por **concorrência** (dois usuários da mesma clínica somando lançamentos diferentes não se sobrescrevem; a adição de um não é apagada pelo save do outro) e por **estado defasado/parcial**. Deleção legítima (usuário remove um item que estava no baseline) continua funcionando; sem baseline, o save é **somente upsert** (nunca apaga). Lógica pura extraída para `src/lib/financeSync.js` (`computeIdsToDelete`, testada); `src/lib/financeStore.js` (`syncTable`/`saveFinanceData` recebem o baseline) e `src/pages/FinanceWorkspace.jsx` (`baselineRef` = dado carregado/persistido) ligados. Testes: `tests/unit/financeStoreDeletion.spec.js` (5, incl. caso de concorrência). Plano em `docs/superpowers/specs/2026-10-11-data-persistence-safety-review.md`.

## [Unreleased] - 2026-10-11 (46)
### Added
- **Feedback real de salvamento no Financeiro** (Fase A da revisão de persistência): o indicador de status agora mostra **Salvando… / Sincronizado / Erro ao salvar (com botão Repetir)** em `src/pages/FinanceWorkspace.jsx` (`SyncStatus`), em vez do antigo "Sincronizado" fixo. O usuário passa a ter confirmação visível de que gravou e consegue repetir em caso de falha (nada mais é fire-and-forget silencioso).
### Changed
- **Autosave do Financeiro com debounce + guarda de escopo** (Fase A): (1) as edições são **coalescidas por debounce (800ms)** antes de persistir (menos escritas e menos janela de corrida); com **flush ao sair da tela** para não perder a última edição; (2) **guarda de escopo** — o autosave só grava com `ownerId` resolvido e **nunca cai pro fallback `user.id`** (evita gravar lançamento de membro no escopo errado → dado órfão). `src/pages/FinanceWorkspace.jsx`. Parte do plano de `docs/superpowers/specs/2026-10-11-data-persistence-safety-review.md`.

## [Unreleased] - 2026-10-11 (45)
### Fixed
- **Perda de lançamentos financeiros (crítico, fidedignidade)**: lançamentos de membros da clínica (ex.: Lunara/gestão) desapareciam do Financeiro. **Causa-raiz:** ao carregar o workspace, `src/pages/FinanceWorkspace.jsx` fazia `setRaw(draftData || nextData)` — um **rascunho em cache (sessionStorage) vazio/defasado sobrescrevia o dado real do servidor**; o autosave então persistia esse estado defasado e o **`syncTable` (delete-sync) apagava do banco** as linhas ausentes no rascunho. Também, em falha de carga, o `catch` fazia `setRaw(createEmptyData())` **e** `hydratedRef=true`, armando um autosave vazio que apagava tudo. **Correções:** (1) o **servidor passa a ser a fonte de verdade** no load (`setRaw(nextData)`); o rascunho nunca sobrescreve o dado carregado — em falha de carga ele é só visualização e o autosave **não** é habilitado (`hydratedRef=false`), para um estado vazio/parcial jamais ser persistido; (2) **trava de segurança** em `src/lib/financeStore.js`: `saveFinanceData` **recusa persistir um dataset totalmente vazio** (backstop contra o wipe do delete-sync). Diagnóstico confirmou que o dado não ficou órfão nem invisível por RLS — foi efetivamente deletado; a resolução de owner (`data_owner_id()`) e a RLS estavam corretas e idênticas entre membros. Arquivos: `src/pages/FinanceWorkspace.jsx`, `src/lib/financeStore.js`.

## [Unreleased] - 2026-10-11 (44)
### Added
- **Automação de link de anamnese por WhatsApp** (CRM, Fase 2 — sub-projeto 4, incremento 4b-3): nova automação **Link de anamnese** em **Configurações → Automações** (toggle próprio, nasce desligado), enviada **N dias antes da consulta** com um **link configurável pela clínica** (campo `anamnese_link`) e template com `{patient_name}`, `{date}`, `{link}`. **Honesto / pronto-pra-credencial:** o formulário público de anamnese (token por paciente) é uma feature da Fase 4 ainda não construída — então, em vez de mandar um link quebrado, a clínica informa a URL do formulário (interno quando existir, ou externo tipo Google Forms); **sem link preenchido, a automação não envia** (fica salva). Quando o formulário interno existir, basta trocar a base do link. Reusa o motor time-based do lembrete (consultas), o cron/`?action=dispatch` e a idempotência já existentes (`automation_type='anamnese'`). Colunas `anamnese_enabled`/`anamnese_days_before`/`anamnese_link`/`anamnese_template` em `whatsapp_automations` via `alter ... add column if not exists`. Pura testada: `planAnamnese` (injeta `{link}`) em `api/_lib/whatsappAutomations.js`. UI em `src/components/WhatsAppAutomations.jsx`. Testes: `tests/unit/whatsappAutomations.spec.js` (9 no total). Com isso o sub-projeto 4 cobre as 4 automações de saída (lembrete, follow-up, cobrança, anamnese).

## [Unreleased] - 2026-10-11 (43)
### Added
- **Automação de cobrança por WhatsApp** (CRM, Fase 2 — sub-projeto 4, incremento 4b-2): nova automação **Cobrança de pagamento** em **Configurações → Automações** (toggle próprio, nasce desligado), enviada conforme o **VENCIMENTO** da conta a receber e **só para quem ainda não pagou** (`payment_status not in ('pago','cancelado')` — mesmo filtro da view `accounts_receivable`). **Regra das 3 datas respeitada:** o disparo lê o **vencimento** (coluna `due_date`), nunca competência nem caixa; o cálculo em JS (`receivableDueDate`) replica exatamente o fallback da migração de competência (cirurgia `due_date ?? date`; consulta `due_date ?? forecast_payment_date ?? date`), então funciona mesmo que `competence_date_migration.sql` ainda não tenha rodado. Prazo configurável (`payment_offset_days`: 0 = no dia do vencimento, positivo = N dias depois/atraso, negativo = antes) e template editável com `{patient_name}`, `{value}` (moeda BRL determinística via `formatBRL`) e `{date}` (vencimento). Idempotente pelo mesmo índice único do 4b-1 (`automation_type='payment'`, dedup por vencimento). Reusa o motor/cron/`?action=dispatch` já existentes — **sem função nem cron novos**. Colunas `payment_enabled`/`payment_offset_days`/`payment_template` adicionadas em `whatsapp_automations` via `alter ... add column if not exists` (idempotente) em `supabase/whatsapp_automations_schema.sql`. Lógica pura testada em `api/_lib/whatsappAutomations.js` (`formatBRL`, `receivableDueDate`, `planPayments`); orquestração `fetchReceivables` + bloco de cobrança em `runForOwner`. UI em `src/components/WhatsAppAutomations.jsx`. Testes: `tests/unit/whatsappAutomations.spec.js` (8 no total). (Link de anamnese = 4b-3.)

## [Unreleased] - 2026-10-11 (42)
### Added
- **Automações de saída de WhatsApp — lembrete e follow-up** (CRM, Fase 2 — sub-projeto 4, parte 2 / incremento 4b-1): o admin liga mensagens automáticas em **Configurações → Automações** (`WhatsAppAutomations`): **lembrete** de consulta/cirurgia (N dias antes) e **follow-up** pós-consulta (N dias depois), com template editável (variáveis `{patient_name}`, `{date}`, `{time}`) e escolha do **número de envio**. **Pronto-pra-credencial:** todo o motor existe e é testável; sem um número Z-API com credenciais, nada é enviado e a config fica salva. **Respeita o limite do Hobby (12/12 funções, 2 crons):** o código novo de servidor **reusa** `api/whatsapp.js` (novo `?action=dispatch`, autorizado por `CRON_SECRET`) e o motor vive em `api/_lib/whatsappAutomations.js`; o **disparo diário é pendurado no cron de alertas já existente** (`api/alerts/process.js`, 08:00 BRT) com chamada **fail-safe** (erro na automação nunca derruba os alertas) — sem função nem cron novos. **Idempotente:** índice único `(user_id, automation_type, ref_id, target_date)` em `whatsapp_automation_log` com guard-log **antes** do envio, impedindo 2º disparo do mesmo evento/dia. Envio grava em `whatsapp_messages` (outbound) → aparece no inbox e na timeline. **Não toca** caixa/DRE/metas (lembrete/follow-up são de calendário). Fuso **America/Sao_Paulo** no cálculo da data-alvo. Toggles nascem **desligados**. SQL em `supabase/whatsapp_automations_schema.sql` (tabelas `whatsapp_automations` + `whatsapp_automation_log`, RLS por `data_owner_id()`). Lógica pura testada: `api/_lib/whatsappAutomations.js` (`addDays`, `renderTemplate`, `planReminders`, `planFollowups`). UI: `src/components/WhatsAppAutomations.jsx` + aba em `src/components/Settings.jsx`. Design em `docs/superpowers/specs/2026-10-11-whatsapp-outbound-automations-design.md`. Testes: `tests/unit/whatsappAutomations.spec.js`. (Cobrança no vencimento = 4b-2; link de anamnese = 4b-3.)

## [Unreleased] - 2026-10-11 (41)
### Added
- **Régua de follow-up** (CRM, Fase 2 — sub-projeto 2b): o admin define **modelos de tarefa por estágio** em **Configurações → Régua de follow-up** (`FollowupRules`); quando a oportunidade **entra** num estágio, as tarefas nascem sozinhas (vencimento = entrada + N dias, responsável opcional). Dispara por **trigger no banco** em `opportunity_stage_history` → funciona pra **qualquer** caminho de mudança de estágio (manual, arrastar, IA-confirmada, automação), sem cron nem credencial. **Idempotente:** cada regra gera no máx. 1 tarefa por oportunidade (`tasks.origin_rule_id`; reentrar no estágio não recria). É o elo direto com as automações de saída (sub-projeto 4). SQL em `supabase/followup_rules_schema.sql` (tabela `followup_rules` + coluna `origin_rule_id` + função `apply_followup_rules` SECURITY DEFINER + trigger), RLS por `data_owner_id()`. `src/components/FollowupRules.jsx`, aba em `Settings.jsx`. Design em `docs/superpowers/specs/2026-10-11-followup-rules-design.md`. Teste: `tests/e2e/followup-rules.spec.js`.

## [Unreleased] - 2026-10-11 (40)
### Added
- **Painel de Tarefas** (CRM, Fase 2 — sub-projeto 2c): novo item **Pacientes → Tarefas** (`TasksPanel`) com todas as tarefas da clínica (de qualquer oportunidade **+ avulsas**) agrupadas por vencimento (⚠ Atrasadas / Hoje / Esta semana / Futuras-sem-data) e concluídas recolhidas. Filtro **Minhas / Todas** (default por papel: admin/gestão→Todas, equipe→Minhas), concluir/excluir, e **+ Nova tarefa avulsa** (título, vencimento, responsável, paciente opcional) — é onde vivem as avulsas que o schema do 2a já suporta. Cada linha mostra o vínculo (oportunidade/paciente ou "avulsa"). Visível a todos os perfis. Agrupamento é função pura testada (`src/lib/taskGroups.js`). `src/components/TasksPanel.jsx`, nav/rotas em `FinanceWorkspace.jsx`, acesso em `UserRoleContext.jsx`, ícone `tasks` em `NavIcon.jsx`. Sem SQL novo (usa `tasks` do 2a). Design em `docs/superpowers/specs/2026-10-11-tasks-panel-design.md`. Testes: `tests/unit/taskGroups.spec.js` (4), `tests/e2e/tasks-panel.spec.js`.

## [Unreleased] - 2026-10-11 (39)
### Added
- **Tarefas + Timeline na oportunidade** (CRM, Fase 2 — sub-projeto 2a): o editor da oportunidade ganhou **abas** (Dados / Tarefas / Timeline). **Tarefas** com vencimento + responsável (da equipe) + concluir/excluir; a tabela `tasks` é **geral** (nullable em `opportunity_id`/`patient_id`, já pronta pra tarefas avulsas — a tela avulsa vem no 2c). **Timeline derivada** (sem tabela de evento paralela que possa divergir): mescla `opportunity_stage_history` + `whatsapp_messages` + tarefas + criação/ganho/perdido, ordenada do mais recente. **Nota manual** (`opportunity_notes`) entra na timeline. Peça pura testada: `src/lib/timeline.js` (`buildTimeline`). `src/lib/taskActions.js`, `src/components/OpportunityTasks.jsx`, `src/components/OpportunityTimeline.jsx`, abas em `OpportunityEditor.jsx`. SQL em `supabase/tasks_timeline_schema.sql` (2 tabelas, RLS por `data_owner_id()`). Design em `docs/superpowers/specs/2026-10-11-tasks-timeline-design.md`. Testes: `tests/unit/timeline.spec.js` (6), `tests/e2e/tasks-timeline.spec.js`. (Régua de follow-up = 2b; painel "Tarefas de hoje" cross-oportunidade = 2c.)

## [Unreleased] - 2026-10-11 (38)
### Added
- **Pipeline completo** (CRM, Fase 2 — sub-projeto 1c): o funil agora é operável de ponta a ponta. (1) **Criar/editar oportunidade** por um editor (`OpportunityEditor`, Modal) — escolhe o paciente ou **cadastra na hora** (reusa `PatientSelector`), com título, valor (máscara BRL), origem, responsável (da equipe `clinic_members`) e **tags** (chips). (2) **Arrastar card** entre colunas (drag-and-drop HTML5 nativo, zero dependência nova) — move pela RPC `move_opportunity` auditada, igual ao `<select>` que segue como alternativa. (3) **Filtros no cliente** (instantâneos): busca por paciente, responsável, origem e tag. (4) **Fechar como Ganho/Perdido** (com motivo) — sai do board de abertas. Criar/editar/fechar não tocam caixa/DRE/metas (oportunidade é pré-venda); estágio só muda pela RPC auditada. `src/components/OpportunityEditor.jsx`, `src/lib/opportunityActions.js`, `OpportunityPipeline.jsx`. Sem SQL novo (usa colunas já existentes). Design em `docs/superpowers/specs/2026-10-11-pipeline-crud-dnd-design.md`. Testes: `tests/e2e/pipeline-crud.spec.js`.

## [Unreleased] - 2026-10-11 (37)
### Added
- **IA sugere avanço de estágio** (CRM, Fase 2 — sub-projeto 4, **sugere e confirma**): conforme chegam mensagens no WhatsApp, a IA lê a conversa e **sugere** mover a oportunidade para o estágio certo — nunca move sozinha. O aviso aparece no **card do pipeline** e na **conversa do inbox** (🤖 estágio proposto + motivo + % de confiança) com **✓ Mover** / **✗ Ignorar**. Confirmar passa pelo `move_opportunity` já existente (auditado em `opportunity_stage_history`); descartar só dispensa. **Sem nova função serverless** (roda dentro do webhook do `api/whatsapp.js`, reusa `OPENAI_API_KEY`). Controle de custo: **pré-filtro grátis** por palavra-chave + **cooldown** por oportunidade + modelo barato — a IA só é chamada quando a mensagem sinaliza avanço. Guardrails: **forward-only**, limiar de confiança (`AI_SUGGEST_MIN_CONFIDENCE`, default 0.70), e à prova de falha (IA nunca derruba o recebimento). Lógica pura testada em `api/_lib/stageSuggest.js` (+ `stageSuggestClient.js`), ações compartilhadas em `src/lib/opportunitySuggestion.js`, UI em `OpportunityPipeline.jsx`/`WhatsAppInbox.jsx`. SQL em `supabase/whatsapp_ai_suggest.sql`; design em `docs/superpowers/specs/2026-10-11-whatsapp-ai-suggest-design.md`. Testes: `tests/unit/stageSuggest.spec.js`. Env opcionais: `OPENAI_SUGGEST_MODEL`, `AI_SUGGEST_MIN_CONFIDENCE`, `AI_SUGGEST_COOLDOWN_MIN`.

## [Unreleased] - 2026-10-10 (36)
### Added
- **Lead automático do WhatsApp** (Fase 2): quando um número **novo** manda mensagem, a clínica ganha um **lead no pipeline automaticamente** — o webhook cria o contato (paciente) + a oportunidade no novo estágio **"Primeiro Contato"**, usando o nome do contato do WhatsApp. Via RPC atômica e idempotente `ensure_whatsapp_lead`. Resolve de vez o "lead novo que chamava no zap e sumia": agora ele entra no funil sozinho. Novo estágio inicial `primeiro_contato` no pipeline. SQL em `supabase/whatsapp_lead_autocreate.sql`. (O avanço automático de estágio por interpretação das mensagens vem no motor de automação — sub-projeto 4.)

## [Unreleased] - 2026-10-10 (35)
### Added
- **Inbox central de WhatsApp** (Fase 2, 3b): nova tela em **Pacientes → WhatsApp** (`WhatsAppInbox`) com todas as conversas da clínica numa lista (estilo Chatwoot/Kommo) — nome do paciente ou número cru, prévia, horário, selo do número, e **conversas NÃO atribuídas** (lead novo que chamou no zap e antes sumia) destacadas com ⚠. Abrir uma conversa mostra o thread e permite responder escolhendo por qual número sair — inclusive responder a um lead ainda não cadastrado. Filtro por número. Visível a todos os perfis. `src/components/WhatsAppInbox.jsx`, nav/rota em `FinanceWorkspace.jsx`, ícone em `NavIcon.jsx`, acesso em `UserRoleContext.jsx`. Teste: `tests/e2e/whatsapp-inbox.spec.js`.

## [Unreleased] - 2026-10-10 (34)
### Added
- WhatsApp **multi-número** (Fase 2, 3a): suporte aos 3 números de WhatsApp Business da clínica. Tabela `whatsapp_numbers` (credenciais Z-API **por número**, lidas só no servidor — `instance_url`/`api_token` revogados do frontend), coluna `whatsapp_number_id` em `whatsapp_messages`. O endpoint `api/whatsapp.js` roteia o webhook **por número** (`?number=<id>&token=<secret>`) e envia pelo número escolhido (credenciais lidas da tabela via service role). Nova tela admin em **Configurações → WhatsApp** (`WhatsAppNumbers`) para cadastrar números + credenciais e copiar a URL de webhook de cada um. A aba WhatsApp do paciente agora escolhe por qual número enviar. SQL em `supabase/whatsapp_numbers_schema.sql`; design em `docs/superpowers/specs/2026-10-10-whatsapp-inbox-multinumero-design.md`. (A inbox central vem no incremento 3b.)

## [Unreleased] - 2026-10-10 (33)
### Changed
- **Funil → Pipeline de Oportunidades** (CRM estilo Kommo, Fase 2): a tela em Pacientes → Funil agora mostra **oportunidades (negócios)**, não mais 1 estágio por paciente. Card rico (paciente, título, valor, origem, tags, "há X dias no estágio", atalho WhatsApp) e soma de valores por coluna. Mover de estágio é **atômico e auditável** via RPC `move_opportunity` (atualiza estágio + grava `opportunity_stage_history` numa transação, registrando quem/quando/manual-vs-automação). `src/components/OpportunityPipeline.jsx` (substitui `PatientFunnel.jsx`), `src/pages/FinanceWorkspace.jsx`. Testes: `tests/e2e/opportunity-pipeline.spec.js`.

### Added
- CRM — Oportunidades (Fase 2, fundação): modelo de dados — tabela `opportunities` (um contato pode ter várias), histórico de estágio **auditável** (`opportunity_stage_history`), `opportunity_id` em cirurgias/consultas, RLS por clínica (`data_owner_id()`) e migração do `funnel_stage` atual. SQL em `supabase/opportunities_schema.sql` + RPC em `supabase/opportunity_move_rpc.sql`; design em `docs/superpowers/specs/2026-10-10-crm-opportunities-design.md`.

## [Unreleased] - 2026-10-10 (32)
### Added
- WhatsApp no CRM (Fase 2): aba **WhatsApp** no cadastro do paciente (área Pacientes) com histórico da conversa e envio de mensagem (`src/components/WhatsAppChat.jsx`, integrado em `Patients.jsx`). Backend: endpoint consolidado `api/whatsapp.js` (`?action=message` envia, `?action=webhook` recebe), cliente Z-API (`api/_lib/whatsappClient.js`) e helpers puros testados (`api/_lib/whatsapp.js`: normalização de telefone, parse do webhook, matching estrito telefone→paciente). Tabela `whatsapp_messages` com RLS por `data_owner_id()` e índice único para **idempotência** do webhook (`supabase/whatsapp_schema.sql`). Fidedignidade coberta por testes (`tests/unit/whatsapp.spec.js` + `tests/e2e/whatsapp-chat.spec.js`): webhook não duplica, ignora eco/`fromMe`, nunca atribui ao paciente errado (ambíguo → não atribui), e a UI mostra o histórico/caixa de envio. Provider escolhido: Z-API. **Ativação depende de criar a conta Z-API, setar env vars na Vercel e rodar o SQL.**

## [Unreleased] - 2026-10-10 (31)
### Changed
- Perfil seguro: os endpoints `secure-profile/get` e `secure-profile/save` foram consolidados num único `api/secure-profile.js` (roteado por `?action=get|save`) e o helper movido para `api/_lib/secureProfile.js`. Comportamento idêntico; libera **1 função serverless** (de 12 para 11, no limite de 12 do plano Hobby da Vercel) para a integração de WhatsApp da Fase 2. `src/lib/secureProfileClient.js`, `api/google/calendar.js` e `api/_lib/googleCalendarApi.js` ajustados para o novo caminho.

## [Unreleased] - 2026-10-10 (30)
### Fixed
- Controle de acesso: o perfil **Concierge** (ex.: Jonas) não podia ser atribuído a um membro — o CHECK da coluna `role` em `clinic_members` só aceitava admin/gestão/equipe, então convidar ou alterar para Concierge pela aba Equipe falhava com violação de constraint. SQL em `supabase/clinic_members_concierge_role.sql` (rodar no SQL Editor); `supabase/access_control_schema.sql` também corrigido para novas instalações.

## [Unreleased] - 2026-10-10 (29)
### Changed
- **Navegação reorganizada em 6 áreas de domínio** (Fase 0 — esqueleto de arquitetura, spec seção 4): barra de áreas no topo (Início · Pacientes · Clínico · Financeiro · Automações & Integrações · Configurações) e a sidebar passa a mostrar só a sub-navegação da área ativa, em vez do menu plano "Operação/Gestão". Cada feature futura cai na área certa. O funil fica em Pacientes; cirurgias/consultas/produtos/lançamentos no Financeiro; assinatura/configurações em Configurações. Visibilidade de área por perfil (admin vê as 6; gestão sem Automações/Config; equipe/concierge só Início/Pacientes). Deep-links `/app/:page` preservados. `src/pages/FinanceWorkspace.jsx`, `src/components/NavIcon.jsx`.
- IA deixou de ser item de menu — o Copiloto (`CopilotWidget`) já é global em qualquer área.

### Added
- Áreas "em breve": Clínico e Automações & Integrações aparecem na barra com selo "em breve" e uma página placeholder, comunicando o roadmap (serão preenchidas nas Fases 2 e 4). `AreaComingSoon` em `FinanceWorkspace.jsx`.
- Teste e2e `tests/e2e/area-navigation.spec.js`: barra com as 6 áreas, troca de área troca a sub-nav, placeholder "em breve", deep-link abre na área certa, funil em Pacientes.

## [Unreleased] - 2026-10-10 (28)
### Added
- Funil de jornada do paciente (Fase 1): nova tela kanban em **Pacientes → Funil** com 5 estágios (consulta agendada → consultado → orçamento enviado → reserva paga → follow-up). Cada card mostra nome/telefone/data e tem um seletor para mover o paciente entre estágios (atualização otimista com rollback em caso de erro). Leitura/escrita respeitam o multi-tenant via `ownerId` (membro de clínica enxerga os pacientes do dono). Nova coluna `funnel_stage` em `patients` — SQL em `supabase/patient_funnel_schema.sql` (aditiva, default `consulta_agendada`, rodar no SQL Editor antes do deploy). Visível a todos os perfis (admin/gestão/concierge/equipe). Arquivos: `src/components/PatientFunnel.jsx`, `src/pages/FinanceWorkspace.jsx`, `src/context/UserRoleContext.jsx`, `src/components/NavIcon.jsx`.
- Teste e2e do funil (`tests/e2e/patient-funnel.spec.js`): cobre listagem de pacientes por estágio e a movimentação (PATCH + reflexo otimista), com o Supabase mockado.

### Fixed
- Workspace redirecionava para o Dashboard ao recarregar ou acessar por link direto qualquer página (ex.: `/app/funnel`, `/app/finance`) enquanto o perfil ainda carregava. O guard de rota agora espera o `UserRoleContext` resolver antes de decidir acesso, e o contexto mantém `loading=true` enquanto não há usuário (elimina a janela role=null/loading=false que disparava o redirect). `src/pages/FinanceWorkspace.jsx`, `src/context/UserRoleContext.jsx`.

### Changed
- `UserRoleContext` concede perfil admin automaticamente sob `VITE_E2E_BYPASS_AUTH` (espelha o bypass já existente no `AuthContext`), destravando os testes e2e de rotas protegidas.

## [Unreleased] - 2026-10-09 (27)
### Added
- Parcelamento real de cirurgias (cronograma com N parcelas). Nova opção "Parcelado (cronograma)" na configuração de pagamento abre um modal para gerar parcelas por frequência (mensal/quinzenal/semanal), data da 1ª parcela e número de parcelas, com valores e formas de pagamento editáveis por parcela. `Sales.jsx`.
### Changed
- Cirurgias agora refletem no caixa **por parcela e por data**: cada parcela paga entra no fluxo de caixa na sua data; parcelas em aberto aparecem em Contas a receber pelo vencimento; a DRE segue reconhecendo a receita total pela competência (data da cirurgia). Antes a cirurgia era tudo-ou-nada pelo status. Fluxo de parcelas (`consultationPaymentFlow`) generalizado para `paymentScheduleFlow` e aplicado a cirurgias. "Marcar recebido" avança parcela a parcela. `financialMetrics.js`, `Finance.jsx`.

## [Unreleased] - 2026-10-09 (26)
### Added
- Aviso de vencimento "em atraso" nos lançamentos: ao marcar uma receita/despesa como "a receber/a pagar" com vencimento anterior a hoje (ex: lançamento retroativo de setembro), aparece um alerta vermelho indicando que ficará em atraso/inadimplência até ser liquidado. `Finance.jsx`.

## [Unreleased] - 2026-10-09 (25)
### Fixed
- Receita extra agora tem situação **A receber / Já recebi** (antes entrava sempre no caixa no ato de salvar e nunca aparecia em Contas a receber). Quando "a receber": aparece em Contas a receber pelo vencimento, conta na DRE pela competência e só entra no caixa ao marcar como recebida. SQL em `supabase/extra_revenue_status_migration.sql` (coluna `status`).
### Changed
- Despesa passou a ter o mesmo controle explícito de situação (**Já paguei / A pagar**) em vez de adivinhar pelo vencimento. "A pagar" vai para Contas a pagar e só sai do caixa ao marcar como paga; na DRE conta pela competência. Botões Recebido/Pendente passam a funcionar também para receitas extras na aba "A receber". `Finance.jsx`, `financialMetrics.js`, `dataModel.js`, `financeStore.js`.

## [Unreleased] - 2026-10-09 (24)
### Added
- Campo "Origem" (texto livre com sugestões, igual ao Centro de custo) em nova receita e nova despesa. Permite marcar de onde vem o lançamento (ex: Indicação, Instagram, Convênio X). Aparece na coluna Origem das abas Entradas/Saídas e no filtro. Lançamentos automáticos (cirurgia, consulta, produto) seguem com a origem do sistema. SQL em `supabase/origin_label_migration.sql` (coluna `origin_label` em `extra_revenues` e `expenses`). `Finance.jsx`, `dataModel.js`, `financeStore.js`, `financialMetrics.js`.

## [Unreleased] - 2026-10-09 (23)
### Added
- Regime de competência explícito em toda a plataforma. Novos campos **data de competência** (quando o fato entra na DRE) e **data de vencimento** (quando a cobrança vence) em cirurgias, consultas, despesas, receitas extras, vendas e compras de produto. SQL em `supabase/competence_date_migration.sql` (colunas `competence_date`/`due_date` + backfill).
- Colunas **Competência** e **Vencimento** lado a lado nas tabelas de Contas a receber e Contas a pagar.
### Changed
- DRE agora é de fato por **competência**: despesas passam a entrar no mês de competência (antes entravam pelo vencimento). Receitas/custos de cirurgia, consulta, produtos e receitas extras também passam a reconhecer pelo mês de competência. O fluxo de caixa continua pelo regime de caixa (data de pagamento/recebimento) — os dois regimes agora são separados corretamente. `financialMetrics.js`, `dataModel.js`, `financeStore.js`, `Finance.jsx`, `Sales.jsx`, `Consultations.jsx`, `Products.jsx`, `UI.jsx`.

## [Unreleased] - 2026-10-09 (22)
### Added
- Botão "Editar" em todos os lançamentos das abas Entradas e Saídas do financeiro. Receitas extras e despesas abrem o modal completo já existente. Cirurgias e consultas abrem modal de edição financeira com todos os campos (valor, data, pagamento, custos cirúrgicos). Vendas e compras de produto também editáveis. Qualquer alteração reflete imediatamente nos números do financeiro. `Finance.jsx`, `UI.jsx`.

## [Unreleased] - 2026-10-09 (21)
### Changed
- Centro de custo agora é campo de texto livre com sugestões (creatable combobox). O usuário pode digitar um valor novo, salvar o registro e o valor aparece como sugestão nas próximas vezes. `UI.jsx` (prop `creatable` no FInput via `<datalist>`), `Finance.jsx` (memo `allCostCenters` agrega valores já usados).

## [Unreleased] - 2026-10-09 (20)
### Added
- Campo "Centro de custo" no modal de nova entrada e nova saída financeira. Opções: Cirurgia Plástica, Consultas, Marketing, Infraestrutura, Administrativo, RH, Outros. Campo persistido nas tabelas `extra_revenues` e `expenses` (coluna `cost_center`). `Finance.jsx`, `financeStore.js`, `dataModel.js`.

## [Unreleased] - 2026-10-09 (19)
### Fixed
- Membros da clínica agora conseguem salvar recorrências, cirurgias via modal de recorrência em Finance, selecionar e criar pacientes em Cirurgias e em Consultas: `Recurrences.jsx`, `Finance.jsx`, `Sales.jsx`, `Consultations.jsx` agora usam `ownerId || user.id` em todos os writes e no `PatientSelector`.

## [Unreleased] - 2026-10-09 (18)
### Fixed
- Membros da clínica (ex: Lunara/gestão) não conseguiam salvar pacientes nem cirurgias: `Patients.jsx` agora usa `ownerId` do contexto de role em vez de `user.id`, garantindo que inserts e queries usem o `user_id` do owner. `Patients.jsx`, `UserRoleContext.jsx`.
- Adicionado bloco SQL em `access_control_schema.sql` para atualizar a RLS de todas as tabelas financeiras e médicas (`surgeries`, `consultations`, `medical_records` e outras 11 tabelas) para usar `data_owner_id()` em vez de `auth.uid()`, permitindo que membros gravem dados no contexto do owner. `supabase/access_control_schema.sql`.

## [Unreleased] - 2026-10-09 (17)
### Added
- Botão "Remover" nas entradas financeiras: cirurgias e consultas voltam para pendente (saem do financeiro mas continuam cadastradas); receitas adicionais e vendas de produto são excluídas permanentemente. `Finance.jsx`.
- Botão "Remover" em compras de produto nas saídas (além de despesas, que já tinham). `Finance.jsx`.

## [Unreleased] - 2026-10-09 (16)
### Changed
- Perfil `equipe` agora tem acesso somente a: Consultas, Agenda, Produtos e Pacientes. Removidos Dashboard, Procedimentos e Cirurgias. `UserRoleContext.jsx`.
- Resumo Rápido (Caixa hoje / Lucro líq. mês) no sidebar agora é ocultado para perfis sem acesso ao módulo Financeiro (equipe e concierge). Somente Admin e Gestão veem. `FinanceWorkspace.jsx`.
- Redirect ao tentar acessar página bloqueada agora aponta para a primeira página acessível do perfil, e não sempre para `/app/dashboard` (evitava loop para equipe). `FinanceWorkspace.jsx`.

### Added
- Novo perfil `concierge` (Jonas): acesso a Procedimentos, Cirurgias, Consultas, Agenda, Produtos e Pacientes — pode cadastrar orçamentos sem ver financeiro. `UserRoleContext.jsx`, `Settings.jsx`.
- Opção "Concierge" no formulário de convite e no select de alteração de perfil da aba Equipe. `Settings.jsx`.

> **Ação necessária no Supabase:** alterar o role do Jonas de `equipe` para `concierge` diretamente na tabela `clinic_members`.

## [Unreleased] - 2026-10-09 (15)
### Fixed
- Trocar o procedimento no formulário de cirurgia agora atualiza o valor corretamente. Antes, o primeiro auto-fill impedia que mudanças subsequentes de procedimento afetassem o valor total. `Sales.jsx` linha 390.
- Membros da clínica (ex: Lunara) agora enxergam os dados do dono (Vitoria) em vez de ERP vazio. `UserRoleContext` expõe `ownerId` (UUID do dono da clínica); `FinanceWorkspace` usa `ownerId` para carregar e salvar dados; `importLegacyDataIfNeeded` aceita `ownerId` como segundo parâmetro.
- Carregamento de dados aguarda `ownerId` estar disponível antes de disparar (evita query com UUID errado).

### Added
- Coluna `ownerId` no `UserRoleContext`, buscada da tabela `clinics` tanto para owners quanto para membros.
- Controle de acesso por perfil (Admin / Gestão / Equipe): `canAccess()` agora protege tanto o sidebar quanto a rota direta — acesso não autorizado redireciona para `/app/dashboard`. Arquivo: `src/pages/FinanceWorkspace.jsx`.
- Opção "Administrador" adicionada ao formulário de convite e ao select de alteração de perfil na aba Equipe. Arquivo: `src/components/Settings.jsx`.

> **Requer SQL no Supabase** (atualizar RLS de todas as tabelas financeiras para aceitar membros via `data_owner_id()`):
> ```sql
> DO $$ DECLARE t text; tables text[] := ARRAY['procedures','products','surgeries','consultations','product_sales','product_purchases','extra_revenues','expenses','assets','liabilities','goals']; BEGIN FOREACH t IN ARRAY tables LOOP EXECUTE format('DROP POLICY IF EXISTS "%s own rows" ON public.%I', t, t); EXECUTE format('DROP POLICY IF EXISTS "clinic members access" ON public.%I', t); EXECUTE format('CREATE POLICY "clinic members access" ON public.%I USING (data_owner_id() = user_id) WITH CHECK (data_owner_id() = user_id)', t); END LOOP; END; $$;
> ```

## [Unreleased] - 2026-10-09 (12)
### Changed
- Sidebar "Conta ativa" agora exibe nome do usuário e nome da clínica (em vez de email). `UserRoleContext` passa a buscar e expor `clinicName`.
- Aba Equipe em Configurações: lista de membros exibe e-mail e cargo (em vez de UUID truncado). E-mail é salvo em `clinic_members.member_email` no convite.

### Added
- Coluna `member_email text` na tabela `clinic_members` (aplicar SQL abaixo antes de usar):
  ```sql
  ALTER TABLE public.clinic_members ADD COLUMN IF NOT EXISTS member_email text;
  ```

## [Unreleased] - 2026-10-09 (11)
### Added
- Tooltip interativo no gráfico de Relatórios: ao passar o mouse sobre qualquer ponto, exibe card flutuante com receita, despesa e lucro do período, mais variação percentual e margem de lucro.
### Changed
- Pontos do gráfico agora são sempre visíveis (círculos); aumentam ao hover. Linha vertical tracejada marca a coluna ativa.

## [Unreleased] - 2026-10-09 (10)
### Changed
- Tela de Procedimentos: cards menores (`minmax(220px,1fr)` em vez de 300px), fonte e espaçamentos reduzidos. Checklist e descrição removidos da visualização do card (continuam editáveis no modal).
### Added
- Campo de busca por nome na tela de Procedimentos, com mensagem de "nenhum resultado" quando não há match.

## [Unreleased] - 2026-10-08 (9)
### Added
- **Controle de acesso por perfil**: `UserRoleContext` detecta automaticamente se o usuário logado é dono de uma clínica (`admin`) ou membro convidado (`gestao` / `equipe`). Na primeira sessão, a clínica é criada automaticamente.
- `canAccess(sectionId)` filtra a navegação lateral e a busca rápida conforme o perfil: admins veem tudo; gestão veem finanças mas não billing/settings; equipe veem apenas dashboard, pacientes e agenda.
- **Aba Equipe em Configurações** (visível apenas para admins): convite de membros por e-mail (via RPC `get_user_id_by_email`), seleção de perfil por membro (gestão/equipe), botão de remoção.
- `supabase/access_control_schema.sql`: tabelas `clinics` e `clinic_members` com RLS, função `data_owner_id()` para multi-tenancy transparente, RPC `get_user_id_by_email`, política atualizada em `patients`.

## [Unreleased] - 2026-10-08 (8)
### Changed
- `FInput` com `type="number"` agora exibe e aceita valores no padrão brasileiro: vírgula como separador decimal e ponto como separador de milhar (ex: `1.234,56`). Ao clicar no campo, permite digitar normalmente com vírgula; ao sair do campo, o valor é formatado automaticamente. Teclado mobile mostra teclado numérico com decimal.

## [Unreleased] - 2026-10-08 (7)
### Fixed
- `Consultations.jsx`: `forecastPaymentDate` não é mais inicializado com `today()` ao abrir o formulário. Antes, toda consulta nova aparecia imediatamente em "A receber" com a data de hoje, mesmo sem data de recebimento prevista. Agora o campo começa vazio e a data de vencimento em "A receber" usa `item.date` como fallback.
- `financialMetrics.js`: receitas extras com data futura não contam mais em `cashBalance` ("Recebido no período") antes do recebimento efetivo. O filtro `onOrBefore(item.date, balanceDate)` foi adicionado ao cálculo de `entriesFinancial` para alinhar com a lógica já existente em `cumulativeEntries`.
- `Finance.jsx`: formulário de despesa agora suporta data futura. Ao informar uma data de vencimento posterior a hoje, a despesa é salva como `status: 'aberto'` (sem `paymentDate`) e aparece em "A pagar". Um aviso em amarelo é exibido no formulário. Antes, toda despesa era forçada como paga no dia do lançamento.

## [Unreleased] - 2026-10-08 (6)
### Fixed
- Ao recarregar a plataforma, o app sempre abria na aba Assinatura independente de onde o usuário estava. Causa: quando redirecionado para `/app/billing` pelo guard de acesso, esse caminho era salvo como última rota visitada e restaurado na próxima sessão. Solução: `/app/billing` não é mais persistido em `LAST_APP_PATH_KEY`, e `AppEntryRedirect` ignora valores salvos de `/app/billing`, caindo em `/app/dashboard`.

## [Unreleased] - 2026-10-08 (5)
### Changed
- `PatientForm` reescrito como formulário em etapas (stepper): pills de navegação no topo com as seções **Identificação → Contato → Endereço → Clínico → Anamnese → TCLE → Revisão**. Cada etapa exibe apenas os campos daquela seção; botões Anterior/Próximo navegam entre elas; botão "Salvar paciente" aparece somente na última etapa.
- Etapa final **Revisão** exibe um resumo somente-leitura de todos os dados preenchidos, agrupados por seção, antes de confirmar o cadastro.
- Campos de texto longo (HDA, medicamentos, observações, etc.) agora crescem automaticamente conforme o usuário digita — altura calculada via `scrollHeight` sem barra de rolagem visível.

## [Unreleased] - 2026-10-08 (4)
### Changed
- Drawer do paciente reestruturado com 5 abas: **Resumo**, **Dados**, **Anamnese**, **Prontuário**, **Financeiro**.
- Nova aba **Resumo**: card de info rápida (idade, queixa, alergias, medicamentos), indicadores (sessões, procedimentos, total financeiro), status do TCLE e linha do tempo unificada com sessões de prontuário, cirurgias e consultas ordenadas por data.
- **Dados** agora contém apenas identificação, contato e endereço; **Anamnese** virou aba própria com todos os campos clínicos em cards individuais.

## [Unreleased] - 2026-10-08 (3)
### Added
- Anamnese médica completa no cadastro de pacientes (`supabase/patients_anamnese_migration.sql`): HDA, doenças crônicas, alergias, medicamentos em uso, cirurgias anteriores, internações, tabagismo, etilismo, atividade física, antecedentes familiares e antecedentes ginecológicos.
- Referência corrigida de CFP (Psicologia) para padrão CFM/CRM (Medicina) no módulo Pacientes.

### Changed
- `Patients.jsx`: formulário expandido com seção Anamnese estruturada em subseções; `DadosTab` exibe cada campo com card individual por tópico.

## [Unreleased] - 2026-10-08 (2)
### Added
- Componente `PatientSelector` (`src/components/PatientSelector.jsx`): dropdown de pacientes cadastrados com botão "+ Novo" que abre mini-modal inline (nome, CPF, telefone) para criar e selecionar o paciente sem sair do formulário de cirurgia ou consulta.

### Changed
- `Sales.jsx` e `Consultations.jsx`: campo "Paciente" substituído pelo `PatientSelector` — permite selecionar paciente existente ou criar novo direto do formulário. Campo "Identificador interno" mantido para anotações livres. Validação ajustada para aceitar qualquer um dos dois.

## [Unreleased] - 2026-10-08
### Added
- Módulo **Pacientes**: cadastro clínico completo seguindo o padrão CFP Resolução 1/2009 (`src/components/Patients.jsx`). Lista com busca por nome e CPF, drawer lateral com três abas — Dados (identificação, contato, endereço, clínico, TCLE), Prontuário e Financeiro. Item "Pacientes" adicionado ao menu Operação em `FinanceWorkspace.jsx`.
- **Prontuário eletrônico** (`src/components/MedicalRecord.jsx`) vinculado ao módulo Pacientes. Registros de sessão com data, evolução (texto livre), procedimentos aplicados e próxima sessão. Arquivamento sem exclusão conforme exigência CFP; numeração de sessões por ordem cronológica.
- Schema SQL de pacientes, prontuário e documentos do paciente (`supabase/patients_schema.sql`), com RLS por `user_id`, política sem DELETE em `medical_records` (CFP), FKs retrocompatíveis `patient_id` em `surgeries` e `consultations`, e índices de performance.
- Ícone SVG `patients` no `NavIcon.jsx`.

### Changed
- `Sales.jsx`: seletor de paciente cadastrado preenchido automaticamente — ao selecionar, o campo "Paciente ou ID interno" é preenchido com o nome completo. Novo campo `patientId` persistido no registro.
- `Consultations.jsx`: mesmo seletor de paciente cadastrado com auto-preenchimento do nome. Novo campo `patientId` persistido.
- `financeStore.js`: mappers de `surgeries` e `consultations` agora incluem `patient_id` / `patientId` para vincular registros financeiros ao cadastro de pacientes.

### Fixed
- `Sales.jsx`: ao selecionar um procedimento, o campo "Valor total" agora é preenchido automaticamente com o preço base cadastrado, eliminando a necessidade de informar o valor manualmente a cada registro.

## [Unreleased] - 2026-10-05
### Added
- Especificação técnica do assistente financeiro com IA v2 (`docs/superpowers/specs/2026-10-05-ai-financial-assistant-v2-design.md`), cobrindo consultas server-side com autenticação e RLS, function calling, privacidade, fallback transparente, rate limit persistente, observabilidade, rollout e critérios de aceite.
- Assistente financeiro com ferramentas server-side para resumo, comparação de períodos, despesas, procedimentos, produtos, obrigações, metas e previsões (`api/_lib/financialAssistant.js`), usando os mesmos cálculos do dashboard e sem enviar nomes de pacientes. Inclui migração de cota diária e telemetria sem conteúdo financeiro (`supabase/ai_assistant_schema.sql`) e testes unitários de segurança e consistência (`tests/unit/financialAssistant.spec.js`).

### Changed
- O endpoint `/api/financial-assistant` agora exige JWT Supabase, consulta os dados com RLS, executa function calling com schemas estritos, limita o loop de ferramentas e retorna período/evidências da análise. O widget envia a sessão, evita duplicar a pergunta no histórico, permite limpar a conversa e identifica respostas baseadas em dados ou em modo limitado (`api/financial-assistant.js`, `src/lib/aiClient.js`, `src/components/CopilotWidget.jsx`).
- O cálculo financeiro puro foi extraído para `src/financialMetrics.js`; `src/useMetrics.js` permanece como wrapper React para manter compatibilidade com o restante da aplicação.
- Workspace vinculado ao projeto Vercel `fintech`; `.vercel` e `test-results` foram adicionados ao `.gitignore` para não versionar metadados de deploy nem artefatos de teste.

### Fixed
- Corrigido o rate limit não durável e contornável por chamadas anônimas do assistente. A cota agora é atômica e persistente por usuário no Supabase, e falhas técnicas deixam de parecer respostas normais da IA.
- Corrigida a restauração de navegação que podia abrir Configurações após recarregar ou reentrar na plataforma. A rota atual agora é persistida na sessão e entre sessões, a sessão ativa tem prioridade sobre valores antigos e a entrada autenticada restaura a última tela (`src/routes.jsx`, `src/pages/FinanceWorkspace.jsx`, `src/landing/LandingPage.jsx`, `tests/e2e/session-restore.spec.js`).
- Corrigido o assistente que permanecia em modo limitado porque o modelo configurado não era aceito pelo endpoint Responses. O backend agora usa `gpt-5.2` como padrão e remove espaços ou quebras de linha da variável `OPENAI_MODEL` (`api/financial-assistant.js`).

## [Unreleased] - 2026-10-03
### Added
- Confirmação ao fechar modais de formulário com dados preenchidos: ao clicar no ×, em "Cancelar" ou fora do modal, aparece "Descartar alterações?" com as opções "Continuar editando" e "Descartar". Sem alterações, o modal fecha direto; ao salvar, fecha sem perguntar. Implementado no componente `Modal` (`src/components/UI.jsx`), valendo para lançamentos, cirurgias, consultas, metas, produtos, procedimentos e recorrências.
- Integração com Google Agenda na tela Agenda: botão "Conectar Google Agenda", envio automático de consultas e cirurgias (de hoje em diante) como eventos com `Nome completo — Procedimento`, exibição dos eventos do Google no calendário (somente leitura) e atualização do registro quando o horário de um evento vinculado é alterado no Google. Novos campos opcionais "Horário" e "Duração" em consultas e cirurgias. Endpoint único `api/google/calendar.js`, tabelas `google_calendar_connections` e `google_calendar_event_links` e colunas `start_time`/`duration_minutes` (migração `supabase/google_calendar_schema.sql`, que deve ser aplicada antes do deploy). Testes unitários (`npm run test:unit`) e e2e em `tests/`.
- Página pública de Política de Privacidade em `/privacidade` (`src/pages/PrivacyPolicyPage.jsx`, rota em `src/routes.jsx`, entrada em `public/sitemap.xml`), com a seção de uso dos dados do Google Agenda e a declaração de Uso Limitado exigidas pelo Google para a tela de consentimento OAuth.
- Página pública de Termos de Serviço em `/termos` (`src/pages/TermsOfServicePage.jsx`, rota em `src/routes.jsx`, entrada em `public/sitemap.xml`). O layout das páginas legais foi extraído para `src/components/LegalPage.jsx`, usado também pela Política de Privacidade.
- Regra obrigatória de preencher o `CHANGELOG.md` em toda alteração (`SYSTEM_RULES.md`, `PROMPT_GUIDE.md`, `CLAUDE.md` e `AGENTS.md`).

### Fixed
- Plataforma recarregava tudo (skeleton, nova busca de dados e regravação) ao voltar para a aba do navegador, atrasando o uso e desmontando telas e modais abertos. Causa: o Supabase emite um novo objeto `user` ao retomar a aba e os efeitos de `FinanceWorkspace` e `BillingContext` dependiam da referência do objeto. Agora dependem apenas de `user.id`, e `AuthContext` mantém a mesma referência quando o usuário não mudou.
- Modais perdiam o que estava preenchido ao clicar fora deles (inclusive ao soltar o mouse fora ao selecionar texto de um campo). O fundo do modal agora só fecha quando não há dados digitados; com dados, pede confirmação de descarte.

## [Unreleased] - 2026-04-29
### Fixed
- Corrigido bug de troca de tema com delay: `applyTheme` era chamado em `useEffect` (assíncrono, pós-render), fazendo com que os componentes renderizassem com as cores antigas e a atualização visual só ocorresse num segundo render disparado por outro clique. Solução: `applyTheme` agora é chamado de forma síncrona dentro de `toggleTheme`/`setTheme` antes do `setMode`, garantindo que `C` já tenha os valores corretos no momento do re-render.


### Fixed
- Corrigido bug de contraste no modo dark onde texto e fundo ficavam com a mesma cor ao trocar de tema. Constantes de estilo de módulo (`thStyle`, `tdStyle`, `titleStyle`, `labelStyle`, `inputStyle`, `SERIES`, `SUMMARY_CARDS`, `iconButton`, `chipButton`, `kbdSmall`) em `FinancialTable.jsx`, `FinancialPeriodFilter.jsx`, `FinancialChart.jsx`, `Reports.jsx`, `Finance.jsx` e `FinanceWorkspace.jsx` capturavam valores do objeto `C` na carga do módulo e não atualizavam ao mudar o tema. Solução: movidas para dentro dos componentes (avaliadas em cada render) ou convertidas em funções getter.

---

## [1.0.0] - 2026-04-20
### Added
- Estrutura inicial de memória e governança do projeto com `PROJECT_MEMORY.md`, `SYSTEM_RULES.md` e `PROMPT_GUIDE.md`.
- Padronização de registro histórico com este arquivo `CHANGELOG.md`.

### Changed
- Definida convenção formal para registrar evolução por versão e categoria técnica.

### Fixed
- Não se aplica nesta versão inicial.

---

## Template para próximas versões

## [X.Y.Z] - YYYY-MM-DD
### Added
- ...

### Changed
- ...

### Fixed
- ...
