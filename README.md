# SurgiFlow

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
2. Rode o SQL de [supabase/schema.sql](/Users/felipedalpra/Desktop/startup-finance/supabase/schema.sql:1) no SQL Editor.
3. Copie `.env.example` para `.env` e preencha:

```bash
VITE_SUPABASE_URL=https://seu-projeto.supabase.co
VITE_SUPABASE_ANON_KEY=sua-chave-anon
```

4. Em `Authentication > URL Configuration`, adicione:
- `http://localhost:5173`
- `http://localhost:5173/reset-password`
- a URL de produção da Vercel
- a URL de produção com `/reset-password`

5. Se a tabela já existir de uma versão anterior, atualize manualmente o payload inicial ou recrie a tabela usando o SQL atual.

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

2. Confirmar Auth no Supabase:
- `Site URL` da produção
- redirect de `/reset-password`
- provider `Email` ativo

3. Confirmar tabela `user_finance_data`:
- existe
- `RLS` ativo
- policies de `select`, `insert`, `update` para `authenticated`

4. Teste funcional mínimo:
- abrir `/`
- navegar para `/signup`
- criar conta
- fazer login em `/login`
- entrar em `/app`
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
