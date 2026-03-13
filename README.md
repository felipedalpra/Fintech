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
3. Rode o SQL de billing em [stripe_billing_schema.sql](/Users/felipedalpra/Desktop/startup-finance/supabase/stripe_billing_schema.sql:1).
4. Rode o SQL do perfil seguro em [secure_profile_schema.sql](/Users/felipedalpra/Desktop/startup-finance/supabase/secure_profile_schema.sql:1).
5. Copie `.env.example` para `.env` e preencha:

```bash
VITE_SUPABASE_URL=https://seu-projeto.supabase.co
VITE_SUPABASE_ANON_KEY=sua-chave-anon
SUPABASE_SERVICE_ROLE_KEY=sua-service-role-key
APP_DATA_ENCRYPTION_KEY=uma-chave-forte-para-criptografar-perfis
APP_URL=https://sua-url-publica
STRIPE_SECRET_KEY=sk_live_ou_sk_test
STRIPE_WEBHOOK_SECRET=whsec_xxx
STRIPE_PRICE_MENSAL=price_xxx
STRIPE_PRICE_SEMESTRAL=price_xxx
STRIPE_PRICE_ANUAL=price_xxx
```

6. Em `Authentication > URL Configuration`, adicione:
- `http://localhost:5173`
- `http://localhost:5173/reset-password`
- a URL de produção da Vercel
- a URL de produção com `/reset-password`

7. No Stripe:
- crie 3 preços recorrentes
- mensal: `R$ 197,00`
- semestral: `R$ 1.062,00` a cada 6 meses
- anual: `R$ 1.764,00` por ano
- configure o webhook para `POST /api/stripe/webhook`

8. Se a base já existir de uma versão anterior, aplique os scripts incrementais e valide as tabelas `billing_accounts` e `secure_profiles`.

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
- `SUPABASE_SERVICE_ROLE_KEY`
- `APP_DATA_ENCRYPTION_KEY`
- `APP_URL`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_MENSAL`
- `STRIPE_PRICE_SEMESTRAL`
- `STRIPE_PRICE_ANUAL`

2. Confirmar Auth no Supabase:
- `Site URL` da produção
- redirect de `/reset-password`
- provider `Email` ativo

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
- validar trial de 30 dias em `/app/billing`
- abrir checkout Stripe por um plano
- cadastrar procedimento
- cadastrar cirurgia ou produto
- recarregar a página
- confirmar persistência dos dados

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
