# SurgiMetrics

ERP financeiro para clínicas e cirurgiões plásticos com:
- dashboard financeiro
- cirurgias
- consultas
- produtos e modeladores
- contas a pagar e receber
- fluxo de caixa
- DRE
- balanço patrimonial
- metas
- assistente IA
- autenticação via Supabase

## Backend

1. Crie um projeto no Supabase.
2. Rode o SQL base de [single_user_minimal_schema.sql](/Users/felipedalpra/Desktop/startup-finance/supabase/single_user_minimal_schema.sql:1) no SQL Editor.
3. Rode o SQL de billing em [stripe_billing_schema.sql](/Users/felipedalpra/Desktop/startup-finance/supabase/stripe_billing_schema.sql:1) e depois [saas_billing_asaas_schema.sql](/Users/felipedalpra/Desktop/startup-finance/supabase/saas_billing_asaas_schema.sql:1).
4. Rode o SQL do perfil seguro em [secure_profile_schema.sql](/Users/felipedalpra/Desktop/startup-finance/supabase/secure_profile_schema.sql:1).
5. Copie `.env.example` para `.env` e preencha:

```bash
VITE_SUPABASE_URL=https://seu-projeto.supabase.co
VITE_SUPABASE_ANON_KEY=sua-chave-anon
SUPABASE_SERVICE_ROLE_KEY=sua-service-role-key
APP_DATA_ENCRYPTION_KEY=uma-chave-forte-para-criptografar-perfis
BILLING_DATA_ENCRYPTION_KEY=uma-chave-forte-exclusiva-para-credenciais-de-cobranca
VITE_APP_URL=https://sua-url-publica
APP_URL=https://sua-url-publica
# Assinatura SaaS (Zentri Tech cobrando a clínica) via Asaas. Flag fica false
# até a conta própria da Zentri no Asaas existir.
SAAS_BILLING_ENABLED=false
SAAS_BILLING_ASAAS_API_KEY=
SAAS_BILLING_ASAAS_ENVIRONMENT=sandbox
SAAS_BILLING_WEBHOOK_TOKEN=gere-um-segredo-aleatorio-de-40-caracteres
# Meta Ads: preencher somente na ativação do app Meta
META_VERIFY_TOKEN=gere-um-token-aleatorio-forte
META_APP_SECRET=app-secret-do-meta
META_GRAPH_VERSION=vXX.X
```

6. Em `Authentication > URL Configuration`, adicione:
- `http://localhost:5173`
- `http://localhost:5173/reset-password`
- a URL de produção da Vercel
- a URL de produção com `/reset-password`

7. Assinatura SaaS por cartão (Zentri cobrando a clínica): crie uma conta própria da
Zentri Tech no Asaas (separada da conta de cada clínica usada para cobrar pacientes),
cadastre `SAAS_BILLING_ASAAS_API_KEY`, configure o webhook de cobranças apontando para
`POST /api/financial/analysis?action=saas-billing-webhook` com o header `asaas-access-token`
igual a `SAAS_BILLING_WEBHOOK_TOKEN`, e só então mude `SAAS_BILLING_ENABLED` para `true`.
Até lá, a tela de billing permanece funcional para preencher os dados de pagamento, mas o
botão de assinar fica desabilitado. Cupons de desconto ficam em `saas_billing_coupons`
(cadastro manual pela Zentri, sem tela própria ainda).

8. Se a base já existir de uma versão anterior, aplique os scripts incrementais e valide as tabelas `billing_accounts` e `secure_profiles`.

9. Para cobranças clínicas por boleto/Pix, aplique `supabase/billing_charges_schema.sql`, mantenha `APP_URL` no domínio HTTPS público (`https://www.surgimetrics.com.br`) e conecte o provedor da clínica em **Configurações → Cobranças**. O Asaas é o primeiro adaptador homologado; bancos diretos reutilizam o mesmo contrato após definição da instituição e homologação. Credenciais nunca vão ao frontend: são validadas e armazenadas cifradas pelo backend. `BILLING_DATA_ENCRYPTION_KEY` é recomendada; na ausência dela, o sistema usa `APP_DATA_ENCRYPTION_KEY`.

10. Antes de publicar a área Clínica, aplique `supabase/clinical_record_foundation_schema.sql` depois de `patients_schema.sql`, `patients_anamnese_migration.sql` e `access_control_schema.sql`. A migração preserva e transfere a anamnese existente, ativa o acesso clínico separado por membro e torna evoluções/adendos imutáveis.

## Rodar localmente

```bash
npm install
npm run dev
```

Acesse `http://localhost:5173`.

## Build

```bash
npm run build
```

A saída fica em `dist`.

## Checklist de produção

1. Confirmar variáveis na Vercel:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_APP_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `APP_DATA_ENCRYPTION_KEY`
- `BILLING_DATA_ENCRYPTION_KEY` (recomendada para credenciais de cobrança; fallback seguro para `APP_DATA_ENCRYPTION_KEY`)
- `APP_URL`
- `SAAS_BILLING_ENABLED` (`false` até a conta da Zentri no Asaas estar pronta)
- `SAAS_BILLING_ASAAS_API_KEY` / `SAAS_BILLING_ASAAS_ENVIRONMENT` / `SAAS_BILLING_WEBHOOK_TOKEN`
- `META_VERIFY_TOKEN` (somente quando ativar Meta Ads)
- `META_APP_SECRET` (somente quando ativar Meta Ads)
- `META_GRAPH_VERSION` (versão suportada escolhida na ativação)

2. Confirmar Auth no Supabase:
- `Site URL` da produção
- redirect de `/reset-password`
- provider `Email` ativo
- `VITE_APP_URL` e `APP_URL` apontando para o mesmo domínio público

3. Confirmar tabelas e policies:
- tabelas operacionais do schema mínimo existem
- `billing_accounts` existe
- `RLS` ativo
- policies de `select`, `insert`, `update` para `authenticated`

4. Teste funcional mínimo:
- abrir `/`
- navegar para `/signup`
- criar conta
- fazer login em `/login`
- entrar em `/app`
- em `/app/billing`, confirmar que o acesso ao ERP é liberado independente do status de cobrança
- preencher e salvar os dados de pagamento; com `SAAS_BILLING_ENABLED=true`, assinar um plano e confirmar o redirecionamento para a página do Asaas
- cadastrar procedimento
- cadastrar cirurgia ou produto
- recarregar a página
- confirmar persistência dos dados
- em sandbox Asaas, emitir Pix/boleto de uma conta a receber, simular o pagamento e confirmar baixa única no razão, origem e caixa

5. Conferir deploy SPA:
- `vercel.json` ativo
- rotas `/`, `/login`, `/signup`, `/app/*` funcionando sem 404

## Deploy Vercel

1. Suba o repositório no GitHub.
2. Importe o projeto na Vercel.
3. Framework: `Vite`
4. Build command: `npm run build`
5. Output directory: `dist`
6. Configure as variáveis de ambiente.
7. Faça o deploy.
8. Atualize as URLs no Supabase Auth.
