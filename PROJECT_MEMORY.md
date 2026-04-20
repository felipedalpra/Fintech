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
- `a5105aa`: otimizações de performance (salvamentos paralelos, memoização, error boundary, UUID v4 estável)
- `772cdd1`: robustez de `payment_method` em consultas com falhas transitórias de schema
- `3c3cfb6` e `9ba8d58`: correções em fluxo financeiro (datas de consulta, recebimento parcial, confirmação de saída imediata)
- `b61747c`: melhorias de UX da landing em mobile e fluxo de planos
- `9e18e3e`/`b7bce03`/`518a7e7`: ajustes de branding e favicon

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
5. Evoluir observabilidade do assistente financeiro (taxa de erro, latência, limite diário e custo por usuário).
