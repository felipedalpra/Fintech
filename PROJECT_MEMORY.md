# PROJECT_MEMORY

## 1) Contexto do projeto
SurgiMetrics é um ERP financeiro para clínicas e cirurgiões plásticos. O sistema combina gestão operacional (procedimentos, cirurgias, consultas, produtos, vendas e compras) com gestão financeira (contas a pagar/receber, fluxo de caixa, DRE, balanço patrimonial, metas e análises).

O produto também possui:
- autenticação de usuários via Supabase
- controle de assinatura e trial com Stripe
- assistente financeiro com IA para leitura dos dados da clínica
- processamento de recorrências financeiras por endpoint dedicado

Objetivo central: dar previsibilidade de caixa e suporte à decisão financeira do consultório com dados reais e persistentes.

## 2) Stack
### Frontend
- React 18 + Vite 5
- React Router (rotas públicas e protegidas)
- Estado/contextos em `src/context/*`
- Camada de dados no cliente em `src/lib/financeStore.js`

### Backend / API
- Funções serverless em `api/*` (deploy na Vercel)
- Endpoints para Stripe (`/api/stripe/*`), IA (`/api/financial-assistant`), análise (`/api/financial/analysis`), perfil seguro e recorrências
- Cron diário configurado em `vercel.json` para `/api/recurrences/process`

### Banco e autenticação
- Supabase (Auth + Postgres + RPC + RLS)
- Schemas SQL versionados em `supabase/*.sql`
- Estrutura principal relacional (procedures, surgeries, consultations, products, expenses, goals etc.)

### IA
- Integração server-side com OpenAI Responses API
- Chave via `OPENAI_API_KEY`
- Limite diário por usuário no endpoint de assistente

### Deploy
- Vercel (SPA + serverless)
- Rewrites para rotas de app e API
- Build: `npm run build`, saída em `dist`

## 3) Decisões importantes
1. **Persistência híbrida com migração para modelo relacional**
- O frontend mantém compatibilidade com payload legado e normaliza para UUID estável em `src/dataModel.js`.
- `src/lib/financeStore.js` prioriza tabelas relacionais quando disponíveis e cai para estrutura legada quando necessário.

2. **Backend sensível no cliente, lógica crítica no serverless**
- Operações sensíveis (Stripe, perfil seguro, IA e processamento de recorrências) ficam em `api/*`.
- O frontend consome APIs e mantém experiência reativa sem expor segredos.

3. **Monetização com trial e planos fixos**
- Trial de 30 dias (`src/billing/plans.js`).
- Ciclos mensal/semestral/anual alinhados com variáveis Stripe em produção.

4. **Recorrências por rotina automática**
- Execução diária via cron para consolidar lançamentos recorrentes.
- Endpoint também permite execução por usuário autenticado.

5. **Roteamento protegido por autenticação**
- Fluxo público (`/`, `/login`, `/signup`, `/reset-password`) e privado (`/app/*`) separado para evitar acesso indevido.

## 4) Alterações recentes
> Atualize esta seção a cada merge importante.

### Histórico recente (resumo)
- 2026-10-16 (branch `feat/evolution-api-whatsapp`): integração de WhatsApp passa a aceitar Evolution API self-hosted por uma camada multiprovedor, preservando Z-API para rollback. Instância e webhook são criados e verificados somente no backend; a clínica conecta por QR Code. Eventos brutos são registrados antes do processamento com deduplicação por número, mensagens mantêm proveniência do provedor e confirmações não podem misturar instâncias. Aplicar `supabase/whatsapp_evolution_provider_schema.sql`, subir a infraestrutura descrita em `docs/EVOLUTION_API_DEPLOY.md` e configurar as variáveis `EVOLUTION_*`/`WHATSAPP_WEBHOOK_BASE_URL` antes da homologação real.
- 2026-10-16 (branch `feat/fase4-fundacao-prontuario`): início da Fase 4 com área Clínica, acesso independente do cargo administrativo, identidade profissional, prontuário cronológico imutável, correções por adendo e auditoria append-only de abertura/escrita. A anamnese/TCLE é migrada de `patients` para `patient_clinical_profiles` com RLS clínica e compatibilidade de rollout; relatórios administrativos deixam de carregar conteúdo de saúde. Aplicar `supabase/clinical_record_foundation_schema.sql` antes do deploy. A próxima etapa é a anamnese versionada com link público de uso único; os snippets antigos do plano de 2026-10-08 não devem ser aplicados.
- 2026-10-16 (branch `feat/cobranca-asaas-fase3`): Fase 3 de cobranças clínicas com arquitetura multiprovedor e Asaas como primeiro conector homologado. Boleto/Pix nascem da parcela canônica persistida, sem edição cliente de valor/vencimento; emissão, consulta e webhooks são idempotentes, a baixa atualiza razão e origem na mesma transação, tarifas viram despesa financeira e estornos preservam liquidações concorrentes. Credenciais por clínica ficam criptografadas no servidor, o webhook é configurado automaticamente e a régua de WhatsApp usa o link real e para após pagamento. Banco direto depende apenas do futuro adaptador da instituição e de sua homologação, sem novo financeiro paralelo. Aplicar `supabase/billing_charges_schema.sql` antes do deploy e configurar `BILLING_DATA_ENCRYPTION_KEY` (ou manter `APP_DATA_ENCRYPTION_KEY`).
- 2026-10-16 (branch `feat/conciliacao-bancaria-robusta`): conciliação bancária passa a validar identidade da conta e integridade do extrato. O cadastro preserva somente instituição, agência, final mascarado e estado de verificação; OFX captura banco/conta/moeda/período/saldos; conta ou moeda divergente é bloqueada; saldos podem ser encadeados entre importações; cobertura e qualidade da fonte ficam visíveis. `bank_connections` prepara Open Finance/API direta sem misturar conexão de dados com emissão de cobranças nem guardar credenciais. Aplicar `supabase/bank_reconciliation_robustness_schema.sql` após os schemas base; a conexão real ainda depende da escolha e homologação do provedor.
- 2026-10-15 (branch `fix/data-local-e-salvamento-incremental`): correção global de data civil para usar o relógio local do navegador em vez de UTC, evitando que Agenda e lançamentos avancem um dia à noite no Brasil. A persistência relacional passa a calcular deltas contra o baseline da sessão e grava somente origens e projeções do razão novas/alteradas; read-back, soft-delete, fila serial e fallback de carga completa sem baseline permanecem ativos. Nenhum schema, SQL ou endpoint novo.
- 2026-10-15 (branch `fix/revisao-importacao-xlsx`): importação retroativa de Excel separada da conciliação bancária. A nova tela `Importar lançamentos` não exige conta, exibe e permite editar todas as linhas, identifica duplicidades contra o razão canônico e só cria receitas/despesas após aprovação explícita, com recuperação durável do lote. A conciliação volta a aceitar apenas extratos OFX/CSV; nenhuma função serverless ou migração nova.
- 2026-10-15 (branch `feat/importacao-lancamentos-xlsx`): Conciliação bancária ampliada para planilhas Excel com parse integralmente no navegador, prévia de totais, detecção determinística de lançamentos existentes/duplicados/novos e aprovação humana individual ou em lote. Linhas ignoradas ficam auditadas e reversíveis; novos registros usam o salvamento e razão canônicos com UUID idempotente. Migração aditiva `supabase/bank_reconciliation_xlsx_review_schema.sql`; nenhuma função Vercel nova.
- 2026-10-12 (branch `feat/financial-indicator-drilldown`): indicadores financeiros auditáveis por clique. Dashboard, Financeiro, DRE, fluxo, balanço, produtos, metas e resumos operacionais abrem um modal pesquisável com os lançamentos de origem e reconciliação a centavo. A composição nasce em `buildMetrics.drilldowns`, usando o mesmo razão canônico de competência, caixa, obrigações, CMV e patrimônio; resultados apresentam receitas positivas e custos/saídas negativos. A aba desatualizada de simulação de impostos foi retirada, sem remover os lançamentos e valores tributários do razão e dos relatórios.
- 2026-10-12 (branches `codex/ledger-recurrences` e `codex/ledger-persistence`, merge `8ab1558`): recorrências passaram a gerar títulos próprios no razão canônico, participando de DRE, caixa, contas a pagar/receber, balanço e Excel sem duplicar lançamentos já materializados. O app mantém `financial_entries` e `financial_installments` por write-through idempotente, arquiva reversivelmente títulos/parcelas removidos e faz o backfill dos dados operacionais existentes no primeiro carregamento autenticado. Migrações de produção aplicadas e deploy validado em `www.surgimetrics.com.br`.
- 2026-10-12 (branch `feat/clinical-cost-settlement`): custos de hospital, anestesia, material, outros e imposto/NF ganharam liquidação independente por componente, com fornecedor, competência, vencimento, data real e forma de pagamento em `cost_settlements`. Registros legados sem comprovação continuam sinalizados pela auditoria em vez de receber baixa presumida.
- 2026-10-12 (branch `feat/product-sales-received-date`): vendas de produto passaram a separar competência, vencimento e recebimento real. O razão, relatórios e assistente financeiro usam essas datas sem transformar vendas legadas não conferidas em caixa.
- 2026-10-12 (branch `feat/financial-ledger-phase-10`): Fase 10 ativou a projeção do razão canônico como fonte de DRE, caixa, contas a pagar/receber e balanço em `buildMetrics`; Dashboard, Financeiro, IA, alertas e relatórios passam a herdar a mesma leitura. Excel de obrigações inclui vendas/compras abertas; posição histórica usa liquidação real; cancelados são excluídos. Compras formam estoque e afetam caixa/AP; somente o CMV histórico das vendas entra na DRE. Recorrências seguem anexadas fora do razão até a fase de autoridade própria.
- 2026-10-12 (branch `fix/ledger-legacy-received-date`): corrigido falso bloqueio da Conferência do Razão. Em receitas extras legadas, `date` já era a data real de recebimento; o gate agora aceita `receivedDate || date` e mantém apenas aviso de migração para a coluna nova.
- 2026-10-12 (branch `feat/ledger-readiness-audit`): Conferência do Razão ganhou um gate explícito para a Fase 10. Além da reconciliação fonte × razão, audita invariantes, situações legadas, datas reais de liquidação, custos ainda presumidos, datas obrigatórias e vínculos de cliente/fornecedor. A mudança é somente leitura e não vira a fonte dos números enquanto houver bloqueios.
- 2026-10-12 (branch `feat/central-relatorios-excel`): Central de Relatórios com 22 exportações `.xlsx` financeiras, operacionais, de estoque e clientes; pacote consolidado; metodologia/fontes/alertas por planilha; auditoria automática de qualidade dos dados. Implementação cliente em `src/lib/reportCatalog.js` e `src/lib/reportWorkbook.js`, sem mudança de schema/backend. Limitações estruturais de liquidação de produtos e custo histórico são expostas nos relatórios em vez de ocultadas.
- `a5105aa`: otimizações de performance (salvamentos paralelos, memoização, error boundary, UUID v4 estável)
- `772cdd1`: robustez de `payment_method` em consultas com falhas transitórias de schema
- `3c3cfb6` e `9ba8d58`: correções em fluxo financeiro (datas de consulta, recebimento parcial, confirmação de saída imediata)
- `b61747c`: melhorias de UX da landing em mobile e fluxo de planos
- `9e18e3e`/`b7bce03`/`518a7e7`: ajustes de branding e favicon

- 2026-10-03 (branch `feat/google-calendar`): integração Google Agenda. Arquivos: `api/google/calendar.js` (endpoint único, para respeitar o limite de 12 funções da Vercel), `api/_lib/googleCalendar*.js`, `src/lib/useGoogleCalendarSync.js`, `src/lib/googleCalendarPayload.js`, `src/components/GoogleCalendarBar.jsx`. Só sincroniza registros de hoje em diante (ou já vinculados). Migração `supabase/google_calendar_schema.sql` deve ser aplicada ANTES do deploy (cirurgias/consultas ganham `start_time` e `duration_minutes`). Testes: `npm run test:unit` e `npm run e2e`.
- 2026-10-05: assistente financeiro IA v2 com autenticação obrigatória, consultas server-side protegidas por RLS, function calling, cota diária persistente, telemetria sem conteúdo financeiro e fallback visível. Aplicar `supabase/ai_assistant_schema.sql` ANTES do deploy. Os cálculos compartilhados ficam em `src/financialMetrics.js`; nomes e notas de pacientes não são enviados ao modelo. Testes: `npm run test:unit`.

### Placeholder operacional
- `[YYYY-MM-DD] [versão/tag] [resumo da alteração] [impacto] [responsável]`

## 5) Regras do sistema
- Não quebrar compatibilidade dos dados existentes sem plano explícito de migração.
- Qualquer alteração em cobrança deve manter consistência entre `src/billing/plans.js`, variáveis de ambiente e endpoints Stripe.
- Toda feature financeira deve preservar integridade de totais (receita, custo, margem, status de pagamento).
- Não introduzir dependência de dados mockados para fluxos reais de dashboard ou IA.
- Alterações em autenticação, RLS ou schemas SQL exigem validação em ambiente controlado antes de produção.

## 6) Bugs conhecidos
1. **Risco de inconsistência temporária de schema em consultas**
- Já houve correção para `payment_method` em cenários transitórios (`772cdd1`), indicando sensibilidade a divergência entre código e banco.

2. **Pontos críticos de datas e status financeiros**
- Correções recentes em datas de consultas e recebimento parcial (`3c3cfb6`) mostram que regressões nesses campos têm impacto alto no dashboard.

3. **Dependência forte de configuração de ambiente**
- Falta de variáveis (`SUPABASE_*`, `STRIPE_*`, `OPENAI_API_KEY`) bloqueia funcionalidades essenciais.

## 7) Próximos passos
1. Formalizar versionamento semântico e registrar releases no changelog.
2. Criar suíte mínima de testes de regressão para fluxo financeiro (consultas, cirurgias, contas e fechamento de período).
3. Consolidar checklist técnico para mudanças de schema Supabase (migração + rollback + validação).
4. Monitorar e auditar execução de recorrências (logs e métricas de sucesso/erro).
5. Monitorar a telemetria do assistente financeiro v2 (taxa de erro, latência, modo limitado e custo por usuário) após aplicar `supabase/ai_assistant_schema.sql`.
6. **Pendente — conectar a Google Agenda** (código pronto na branch `feat/google-calendar`): confirmar o projeto Google Cloud do `GOOGLE_CLIENT_ID` (prefixo `530038901215`), aplicar `supabase/google_calendar_schema.sql` antes do deploy, ativar Calendar API, autorizar URI `/api/google/calendar` e escopos, criar `GOOGLE_CALENDAR_REDIRECT_URI` na Vercel e decidir o merge. Checklist completo na Task 8 de `docs/superpowers/plans/2026-10-03-google-calendar-integration.md`.
