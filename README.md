# StartupFinance

Plataforma de gestão para consultório de cirurgia plástica com:
- agenda cirúrgica
- procedimentos
- contas a pagar
- contas a receber
- DRE
- balanço patrimonial
- fluxo de caixa
- metas

## Configuracao do backend

1. Crie um projeto no Supabase.
2. Rode o SQL de `supabase/schema.sql` no SQL Editor.
3. Copie `.env.example` para `.env` e preencha:

```bash
VITE_SUPABASE_URL=https://seu-projeto.supabase.co
VITE_SUPABASE_ANON_KEY=sua-chave-anon
```

4. Em `Authentication > URL Configuration`, adicione a URL local e a URL de producao.
5. Para o reset de senha funcionar localmente, mantenha `http://localhost:5173/reset-password` como redirect URL permitido.
6. Se a tabela já existir de uma versão anterior, atualize manualmente o payload inicial ou recrie a tabela usando o SQL atual.

## Rodar localmente

```
npm install
npm run dev
```
Abre em: http://localhost:5173

## Build para produção

```
npm run build
```
Arquivos gerados na pasta `/dist` — copie para qualquer servidor ou hospede na Vercel/Netlify.

## Deploy Vercel (gratuito)
1. Crie conta em vercel.com
2. Arraste a pasta do projeto ou conecte com GitHub
3. Adicione seu domínio em Settings → Domains
4. Configure `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` nas variáveis de ambiente da Vercel
5. O arquivo `vercel.json` já está pronto para o rewrite do SPA com React Router
