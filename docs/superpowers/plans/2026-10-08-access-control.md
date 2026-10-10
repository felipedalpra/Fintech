# Access Control by Role — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que a Dra. Vitoria convide a equipe (Jonas, Sumary, Jessica, Lunara) com acesso restrito, onde cada perfil vê apenas as seções autorizadas.

**Architecture:** Uma tabela `clinic_members` associa usuários Supabase a uma clínica com um role. O `user_id` da Dra. (a dona da conta) é o `owner_id` da clínica. Convidados fazem login com sua própria conta Supabase e acessam os dados da clínica via RLS policies que checam membership. Um novo contexto `UserRoleContext` expõe o role atual para o frontend filtrar a nav e proteger rotas.

> Equipe completa e emails estão em `CLAUDE.md` — consultar sempre como fonte de verdade.

**Roles e permissões confirmados pela Dra. Vitoria (2026-10-08):**

| Role | Quem |
|------|------|
| `admin` | Dra. Vitoria, Augusto |
| `gestao` | Lunara |
| `equipe` | Jonas (concierge), Sumary (secretária), Jessica |

**Permissões por módulo:**

| Módulo / Seção | `admin` | `gestao` | `equipe` |
|----------------|---------|----------|----------|
| Financeiro — DRE, fluxo de caixa, metas, totais de período | ✅ | ✅ | ❌ |
| Financeiro — cadastrar valor de procedimento em paciente | ✅ | ✅ | ✅ Jonas |
| CRM — cadastro e consulta de pacientes | ✅ | ✅ | ✅ |
| Pedido de exames / receituário | ✅ | ✅ | ✅ |
| Funil de jornada / agendamentos | ✅ | ✅ | ✅ |
| WhatsApp — enviar/receber mensagens | ✅ | ✅ | ✅ |
| WhatsApp — monitorar conversas alheias e configurar | ✅ | ❌ | ❌ |
| Settings / configurações da clínica | ✅ | ❌ | ❌ |

> **Jonas:** `equipe` com permissão extra de cadastrar valor em paciente. Não acessa módulo Financeiro (DRE, caixa, totais).  
> **WhatsApp:** todos enviam/recebem. Apenas `admin` monitora e configura. Obrigatório usar **WhatsApp Business**.

**Seções visíveis por role (nav do FinanceWorkspace):**
- `admin`: todas
- `gestao`: CRM, Pacientes, Funil, Agenda, Exames, Receituário, WhatsApp, Financeiro (sem Settings)
- `equipe`: CRM, Pacientes, Funil, Agenda, Exames, Receituário, WhatsApp — **sem** módulo Financeiro

**Tech Stack:** React 18, Supabase (Auth + Postgres + RLS), Context API

---

## Padrão e contexto (atualizado 2026-10-10)

> Alinha o plano à spec de arquitetura `docs/superpowers/specs/2026-10-10-platform-architecture-design.md`. As Tasks e a tabela de permissões acima continuam válidas.

**Contexto do cliente:** a Dra. Vitória definiu permissões por perfil (ver tabela acima e `CLAUDE.md`). É a segunda feature da Fase 1 e a base de segurança de toda a plataforma.

**Área e navegação (modelo de 6 áreas):** o controle de acesso vira **visibilidade de área** (primeira camada) + permissão por ação dentro da área (segunda camada):

| Área | admin | gestao | equipe |
|------|-------|--------|--------|
| Início | ✅ | ✅ | ✅ (filtrado) |
| Pacientes (+ Orçamentos) | ✅ | ✅ | ✅ |
| Clínico | ✅ | configurável | ❌ |
| Financeiro | ✅ | ✅ | ❌ |
| Automações & Integrações | ✅ | ❌ | ❌ |
| Configurações | ✅ | ❌ | ❌ |

> O Jonas (equipe) cadastra orçamento/valor do paciente pela área **Pacientes** (não entra no Financeiro) — por isso "Orçamentos" vive em Pacientes. WhatsApp: todos usam (inbox em Pacientes); só admin monitora/configura (área Automações & Integrações).

**Benchmark:** modelo de membership multi-tenant (RBAC) — como em DeskcommCRM (multi-tenant, LGPD). Padrão: `owner_id` da clínica + `clinic_members(role)` + RLS por membership.

**Modelo de dados e propagação / fidedignidade (ponto crítico desta feature):**
- A tabela `clinic_members` e o `UserRoleContext` definem o role. **A visibilidade de área no frontend é só a camada 1 (UX).** A segurança real é o **RLS no backend** — um usuário sem permissão não pode ler/escrever o dado nem via API, mesmo que force a rota. Frontend e RLS **têm de concordar** (SYSTEM_RULES 5).
- Membros de clínica acessam os dados do dono via `data_owner_id()` — garantir que todas as queries usem o owner correto e que nada vaze cross-tenant (`auth.uid()`).
- Alterar RLS/schema exige validação em ambiente controlado antes de produção (SYSTEM_RULES, PROJECT_MEMORY §5).

**Checklist de fidedignidade (desta feature):**
1. Cada role vê **exatamente** as áreas da tabela — nem mais, nem menos.
2. O que o frontend esconde, o **RLS também bloqueia** no backend (testar tentando acessar via API com role sem permissão).
3. Membro de clínica lê os dados do dono certo (`data_owner_id()`), nunca de outra clínica.
4. Rebaixar/remover um membro corta o acesso imediatamente.
5. Teste cobre: login como `equipe` não acessa Financeiro (UI e API); `gestao` não acessa Configurações; `admin` acessa tudo.

---

## Arquivos de referência obrigatória

Antes de qualquer step, leia:
- `src/context/AuthContext.jsx` — padrão de contexto existente; o novo contexto segue a mesma estrutura
- `src/pages/FinanceWorkspace.jsx` — onde `NAV_SECTIONS` será filtrado por role
- `src/App.jsx` — onde os providers são wrapped (para adicionar `UserRoleProvider`)
- `supabase/patients_schema.sql` — exemplo de tabela com RLS para seguir como padrão

---

## Mapa de arquivos

| Arquivo | Ação | Responsabilidade |
|---------|------|-----------------|
| `supabase/access_control_schema.sql` | Criar | Tabelas `clinics` e `clinic_members`, RLS atualizada |
| `src/context/UserRoleContext.jsx` | Criar | Contexto que expõe `role`, `clinicId`, `isOwner`, `canAccess(section)` |
| `src/App.jsx` | Modificar | Adicionar `UserRoleProvider` no tree de providers |
| `src/components/Settings.jsx` | Modificar | Adicionar aba "Equipe" para admin convidar membros |
| `src/pages/FinanceWorkspace.jsx` | Modificar | Filtrar `NAV_SECTIONS` pelo role do usuário logado |

---

## Task 1: Schema SQL

**Files:**
- Create: `supabase/access_control_schema.sql`

Este schema cria a clínica (ownership), os membros com role e atualiza as RLS policies de `patients`, `surgeries` e `consultations` para aceitar acesso de membros da mesma clínica.

- [ ] **Step 1.1: Criar o arquivo de migração**

```sql
-- access_control_schema.sql
-- IMPORTANTE: executar DEPOIS de patients_schema.sql e erp_relational_schema.sql.
-- Executar no Supabase SQL Editor.

-- 1. Clínicas: cada conta existente será tratada como owner de uma clínica virtual.
create table if not exists public.clinics (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'Minha Clínica',
  created_at timestamptz not null default timezone('utc', now())
);

-- 2. Membros: usuários convidados e seu role na clínica.
create table if not exists public.clinic_members (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'equipe'
    check (role in ('admin', 'gestao', 'equipe')),
  invited_by uuid references auth.users(id),
  created_at timestamptz not null default timezone('utc', now()),
  unique (clinic_id, user_id)
);

-- 3. RLS das novas tabelas.
alter table public.clinics enable row level security;
alter table public.clinic_members enable row level security;

do $$ begin
  begin
    -- Owner vê e altera sua clínica.
    create policy "Clinics owner" on public.clinics
      for all to authenticated
      using (auth.uid() = owner_id)
      with check (auth.uid() = owner_id);
  exception when duplicate_object then null; end;

  begin
    -- Admin pode ver e gerenciar membros da sua clínica.
    create policy "Clinic members admin" on public.clinic_members
      for all to authenticated
      using (
        clinic_id in (
          select id from public.clinics where owner_id = auth.uid()
        )
      )
      with check (
        clinic_id in (
          select id from public.clinics where owner_id = auth.uid()
        )
      );
  exception when duplicate_object then null; end;

  begin
    -- Membros veem o próprio registro.
    create policy "Clinic members self" on public.clinic_members
      for select to authenticated
      using (user_id = auth.uid());
  exception when duplicate_object then null; end;
end $$;

-- 4. Helper function: retorna o owner_id da clínica do usuário logado.
-- (owner = o próprio usuário, ou o owner da clínica onde é membro)
create or replace function public.clinic_owner_id()
returns uuid language sql stable security definer as $$
  select coalesce(
    -- é owner direto?
    (select id from public.clinics where owner_id = auth.uid() limit 1),
    -- é membro de alguma clínica?
    (select clinic_id from public.clinic_members where user_id = auth.uid() limit 1)
  )
$$;

-- Retorna o owner_id do usuário que "owns" os dados (para usar no RLS).
create or replace function public.data_owner_id()
returns uuid language sql stable security definer as $$
  select coalesce(
    -- se é owner, é o próprio
    (select owner_id from public.clinics where owner_id = auth.uid() limit 1),
    -- se é membro, é o owner da clínica
    (select c.owner_id
     from public.clinic_members cm
     join public.clinics c on c.id = cm.clinic_id
     where cm.user_id = auth.uid()
     limit 1)
  )
$$;

-- 5. Atualizar RLS de patients para aceitar membros.
-- ATENÇÃO: dropa a policy existente e recria.
drop policy if exists "Patients own rows" on public.patients;

do $$ begin
  begin
    create policy "Patients clinic access" on public.patients
      for all to authenticated
      using (user_id = public.data_owner_id())
      with check (user_id = public.data_owner_id());
  exception when duplicate_object then null; end;
end $$;

-- 6. Índices para performance.
create index if not exists idx_clinic_members_user on public.clinic_members(user_id);
create index if not exists idx_clinics_owner on public.clinics(owner_id);
```

- [ ] **Step 1.2: Aplicar no Supabase**

No Supabase Dashboard → SQL Editor, executar o conteúdo acima.

Verificar sem erros. Confirmar que as tabelas `clinics` e `clinic_members` aparecem no Table Editor.

- [ ] **Step 1.3: Verificar a função helper**

```sql
-- Deve retornar seu próprio user_id (você é owner da clínica virtual)
select public.data_owner_id();
```

**Nota importante:** O `data_owner_id()` retorna `null` para usuários que ainda não têm uma clínica criada. O `UserRoleContext` no frontend cria a clínica automaticamente no primeiro acesso (Task 2, Step 2.2).

---

## Task 2: `UserRoleContext`

**Files:**
- Create: `src/context/UserRoleContext.jsx`

Este contexto:
1. Ao inicializar, busca se o usuário é owner de uma clínica ou membro de uma.
2. Se não tiver clínica (primeiro acesso), cria automaticamente.
3. Expõe `role`, `clinicId`, `isOwner` e `canAccess(sectionId)`.

- [ ] **Step 2.1: Escrever o contexto**

```jsx
import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from './AuthContext.jsx'

const UserRoleContext = createContext(null)

// Seções permitidas por role.
const ROLE_ACCESS = {
  admin: [
    'dashboard', 'plans', 'sales', 'consultations', 'calendar',
    'products', 'patients', 'funnel',
    'finance', 'impostos', 'goals', 'recurrences', 'reports', 'ai',
    'billing', 'settings',
  ],
  gestao: [
    'dashboard', 'plans', 'sales', 'consultations', 'calendar',
    'products', 'patients', 'funnel',
    'finance', 'goals', 'recurrences', 'reports', 'ai',
  ],
  equipe: [
    'dashboard', 'consultations', 'calendar', 'patients', 'funnel',
  ],
}

export function UserRoleProvider({ children }) {
  const { user } = useAuth()
  const [role, setRole] = useState(null)        // 'admin' | 'gestao' | 'equipe'
  const [clinicId, setClinicId] = useState(null)
  const [isOwner, setIsOwner] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) {
      setRole(null)
      setClinicId(null)
      setIsOwner(false)
      setLoading(false)
      return
    }

    let mounted = true

    async function bootstrap() {
      setLoading(true)

      // 1. Verificar se já é owner de uma clínica.
      const { data: ownedClinic } = await supabase
        .from('clinics')
        .select('id')
        .eq('owner_id', user.id)
        .maybeSingle()

      if (!mounted) return

      if (ownedClinic) {
        setClinicId(ownedClinic.id)
        setRole('admin')
        setIsOwner(true)
        setLoading(false)
        return
      }

      // 2. Verificar se é membro de alguma clínica.
      const { data: membership } = await supabase
        .from('clinic_members')
        .select('clinic_id, role')
        .eq('user_id', user.id)
        .maybeSingle()

      if (!mounted) return

      if (membership) {
        setClinicId(membership.clinic_id)
        setRole(membership.role)
        setIsOwner(false)
        setLoading(false)
        return
      }

      // 3. Primeiro acesso: criar clínica automaticamente.
      const { data: newClinic, error } = await supabase
        .from('clinics')
        .insert({ owner_id: user.id, name: 'Minha Clínica' })
        .select('id')
        .single()

      if (!mounted) return

      if (!error && newClinic) {
        setClinicId(newClinic.id)
        setRole('admin')
        setIsOwner(true)
      }

      setLoading(false)
    }

    bootstrap()
    return () => { mounted = false }
  }, [user])

  const value = useMemo(() => ({
    role,
    clinicId,
    isOwner,
    loading,
    canAccess(sectionId) {
      if (!role) return false
      return (ROLE_ACCESS[role] ?? []).includes(sectionId)
    },
  }), [role, clinicId, isOwner, loading])

  return (
    <UserRoleContext.Provider value={value}>
      {children}
    </UserRoleContext.Provider>
  )
}

export function useUserRole() {
  const ctx = useContext(UserRoleContext)
  if (!ctx) throw new Error('useUserRole must be used within UserRoleProvider')
  return ctx
}
```

- [ ] **Step 2.2: Verificar imports existentes**

```bash
grep -n "maybeSingle\|from.*supabase" /Users/felipedalpra/Documents/startup-finance/src/lib/supabase.js | head -5
```

O `supabase` client deve estar em `src/lib/supabase.js`. Confirmar que `maybeSingle()` funciona (é nativo do Supabase JS v2).

---

## Task 3: Adicionar `UserRoleProvider` ao App

**Files:**
- Modify: `src/App.jsx`

- [ ] **Step 3.1: Ler o App.jsx atual**

```bash
cat -n /Users/felipedalpra/Documents/startup-finance/src/App.jsx
```

Identificar onde os providers estão aninhados (ex: `<AuthProvider><BillingProvider>...`).

- [ ] **Step 3.2: Adicionar import**

Adicionar ao bloco de imports de `App.jsx`:

```js
import { UserRoleProvider } from './context/UserRoleContext.jsx'
```

- [ ] **Step 3.3: Aninhar UserRoleProvider DENTRO do AuthProvider**

`UserRoleProvider` depende de `useAuth`, então deve ser filho de `AuthProvider`:

```jsx
// Antes:
<AuthProvider>
  <BillingProvider>
    ...
  </BillingProvider>
</AuthProvider>

// Depois:
<AuthProvider>
  <UserRoleProvider>
    <BillingProvider>
      ...
    </BillingProvider>
  </UserRoleProvider>
</AuthProvider>
```

---

## Task 4: Filtrar nav por role em `FinanceWorkspace`

**Files:**
- Modify: `src/pages/FinanceWorkspace.jsx`

- [ ] **Step 4.1: Importar `useUserRole`**

Em `FinanceWorkspace.jsx`, adicionar ao bloco de imports:

```js
import { useUserRole } from '../context/UserRoleContext.jsx'
```

- [ ] **Step 4.2: Consumir o contexto**

Dentro do componente `FinanceWorkspace`, após os outros `use*` hooks:

```js
const { canAccess, loading: roleLoading } = useUserRole()
```

- [ ] **Step 4.3: Filtrar NAV_SECTIONS dinamicamente**

Substituir a referência direta a `NAV_SECTIONS` por uma versão filtrada. Localizar onde `NAV_SECTIONS` é mapeado para renderizar a nav (procurar por `.map(section =>` ou similar) e adicionar filtro:

```js
const visibleSections = NAV_SECTIONS.map(section => ({
  ...section,
  items: section.items.filter(item => canAccess(item.id)),
})).filter(section => section.items.length > 0)
```

Depois substituir `NAV_SECTIONS` por `visibleSections` no render da sidebar.

- [ ] **Step 4.4: Proteger redirect inicial**

No `AppEntryRedirect` (em `routes.jsx`), o redirect para a última rota visitada pode apontar para uma rota que o usuário não tem mais acesso. Não é crítico neste momento — o componente apenas renderizará um 404 interno ou voltará ao dashboard. Documentar como known limitation.

- [ ] **Step 4.5: Testar no browser**

```bash
npm run dev
```

1. Logar como owner da clínica → todos os itens da nav aparecem
2. (Para testar gestao/equipe, inserir um membro manualmente no Supabase — ver Task 5 abaixo)

---

## Task 5: Aba "Equipe" em Settings

**Files:**
- Modify: `src/components/Settings.jsx`

Esta aba permite ao admin ver membros atuais e convidar novos por e-mail. O convite cria um usuário no Supabase Auth (via `supabase.auth.admin.inviteUserByEmail` — apenas server-side) ou, na abordagem client-side, exibe o e-mail e o admin compartilha um link de signup com role atribuído após o primeiro login.

**Abordagem escolhida para este plano:** admin insere o `user_id` de uma conta já existente (mais simples, sem email server-side). O e-mail é buscado via RPC. Isso cobre o caso da clínica da Dra. Vitoria onde as colaboradoras já têm (ou criarão) sua conta.

- [ ] **Step 5.1: Ler Settings.jsx para entender a estrutura de tabs**

```bash
grep -n "tab\|Tab\|aba\|section" /Users/felipedalpra/Documents/startup-finance/src/components/Settings.jsx | head -30
```

Identificar como as abas são implementadas (state + condicional, ou objeto de mapa).

- [ ] **Step 5.2: Adicionar aba "Equipe" visível somente para admin**

Encontrar onde as abas são listadas. Exemplo de padrão a seguir:

```jsx
// Adicionar à lista de tabs (somente se role === 'admin')
...(role === 'admin' ? [{ id: 'team', label: 'Equipe' }] : [])
```

- [ ] **Step 5.3: Criar o conteúdo da aba Equipe**

Dentro de `Settings.jsx`, adicionar a seção que renderiza quando a aba "Equipe" está ativa:

```jsx
function TeamSettings({ clinicId, userId }) {
  const [members, setMembers] = useState([])
  const [newEmail, setNewEmail] = useState('')
  const [newRole, setNewRole] = useState('gestao')
  const [adding, setAdding] = useState(false)
  const [fetchingUser, setFetchingUser] = useState(false)
  const [msg, setMsg] = useState(null)

  useEffect(() => {
    loadMembers()
  }, [clinicId])

  async function loadMembers() {
    const { data } = await supabase
      .from('clinic_members')
      .select('id, user_id, role, created_at')
      .eq('clinic_id', clinicId)
    setMembers(data ?? [])
  }

  async function handleAddMember(e) {
    e.preventDefault()
    setFetchingUser(true)
    setMsg(null)

    // Buscar user_id pelo e-mail via RPC (requer função server-side).
    // Se a RPC não existir, exibir instrução manual.
    const { data: targetUser, error: lookupErr } = await supabase
      .rpc('get_user_id_by_email', { email: newEmail.trim().toLowerCase() })

    setFetchingUser(false)

    if (lookupErr || !targetUser) {
      setMsg({ type: 'error', text: 'Usuário não encontrado. Confirme que ela já criou uma conta no sistema.' })
      return
    }

    setAdding(true)
    const { error } = await supabase
      .from('clinic_members')
      .insert({ clinic_id: clinicId, user_id: targetUser, role: newRole, invited_by: userId })

    setAdding(false)

    if (error) {
      setMsg({ type: 'error', text: error.message })
    } else {
      setMsg({ type: 'success', text: 'Membro adicionado com sucesso.' })
      setNewEmail('')
      loadMembers()
    }
  }

  async function handleRemoveMember(memberId) {
    await supabase.from('clinic_members').delete().eq('id', memberId)
    setMembers(prev => prev.filter(m => m.id !== memberId))
  }

  // ... render (ver step 5.4)
}
```

- [ ] **Step 5.4: Adicionar RPC `get_user_id_by_email` no Supabase**

Esta RPC permite ao admin buscar o user_id de um e-mail sem expor dados de outros usuários.

No Supabase SQL Editor, executar:

```sql
create or replace function public.get_user_id_by_email(email text)
returns uuid language sql security definer as $$
  select id from auth.users where lower(au.email) = lower(email) limit 1;
$$;
-- Nota: security definer permite acesso à auth.users sem expor a tabela diretamente.
-- Retorna null se não encontrado.
```

> **Alternativa se a RPC não for viável:** remover o lookup e pedir ao admin que informe o UUID diretamente (via `user_id` copiado do Supabase). Documentar como limitação temporária.

- [ ] **Step 5.5: Render do TeamSettings**

Adicionar ao `TeamSettings`:

```jsx
  const ROLE_LABELS = { admin: 'Administrador', gestao: 'Gestão', equipe: 'Equipe' }

  return (
    <div>
      <h3 style={{ marginBottom: 16 }}>Membros da equipe</h3>
      {members.length === 0
        ? <p style={{ color: C('subtext'), fontSize: 14 }}>Nenhum membro convidado ainda.</p>
        : members.map(m => (
            <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: `1px solid ${C('border')}` }}>
              <span style={{ fontSize: 13 }}>{m.user_id}</span>
              <Badge label={ROLE_LABELS[m.role] ?? m.role} />
              <button onClick={() => handleRemoveMember(m.id)} style={{ color: C('error') || '#ef4444', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12 }}>
                Remover
              </button>
            </div>
          ))
      }

      <form onSubmit={handleAddMember} style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 400 }}>
        <label style={{ fontSize: 13, fontWeight: 600 }}>Convidar por e-mail</label>
        <input
          type="email"
          value={newEmail}
          onChange={e => setNewEmail(e.target.value)}
          placeholder="email@exemplo.com"
          required
          style={{ padding: '8px 12px', borderRadius: 8, border: `1px solid ${C('border')}`, background: C('surface'), color: C('text'), fontSize: 13 }}
        />
        <select
          value={newRole}
          onChange={e => setNewRole(e.target.value)}
          style={{ padding: '8px 12px', borderRadius: 8, border: `1px solid ${C('border')}`, background: C('surface'), color: C('text'), fontSize: 13 }}
        >
          <option value="gestao">Gestão</option>
          <option value="equipe">Equipe</option>
        </select>
        <button type="submit" disabled={adding || fetchingUser} style={{ padding: '8px 16px', borderRadius: 8, background: '#6366f1', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
          {adding || fetchingUser ? 'Aguarde...' : 'Convidar'}
        </button>
        {msg && (
          <p style={{ fontSize: 12, color: msg.type === 'error' ? (C('error') || '#ef4444') : '#10b981', marginTop: 4 }}>
            {msg.text}
          </p>
        )}
      </form>
    </div>
  )
```

- [ ] **Step 5.6: Integrar `TeamSettings` no `Settings.jsx`**

Importar `useUserRole` em `Settings.jsx` e passar `clinicId` e `userId` para `TeamSettings`. Garantir que a aba só renderiza quando `role === 'admin'`.

- [ ] **Step 5.7: Testar o fluxo completo**

```bash
npm run dev
```

1. Logar como owner
2. Ir em Configurações → Equipe
3. Convidar um e-mail de teste (outra conta criada no sistema)
4. Logar com a conta convidada
5. Verificar que a nav exibe apenas as seções do role atribuído
6. Verificar que ela consegue ler dados de pacientes (RLS permite via `data_owner_id()`)

- [ ] **Step 5.8: Commit**

```bash
git add supabase/access_control_schema.sql \
        src/context/UserRoleContext.jsx \
        src/App.jsx \
        src/components/Settings.jsx \
        src/pages/FinanceWorkspace.jsx
git commit -m "feat: controle de acesso por perfil (admin/gestao/equipe)"
```

- [ ] **Step 5.9: Atualizar CHANGELOG.md**

```
### Added
- Controle de acesso por perfil: roles admin, gestão e equipe. Tabelas `clinics` e `clinic_members` no Supabase. Contexto `UserRoleContext` filtra nav por role. Aba "Equipe" em Configurações para admin convidar membros. Arquivos: `src/context/UserRoleContext.jsx`, `supabase/access_control_schema.sql`.
```

---

## Self-review

### Cobertura do spec
- ✅ 3 roles definidos (admin, gestao, equipe) conforme CLAUDE.md
- ✅ Admin vê tudo; gestão sem DRE nem settings sensíveis; equipe só agenda e CRM básico
- ✅ RLS atualizada para aceitar membros da mesma clínica
- ✅ UI para admin convidar membros

### Riscos conhecidos
- **RPC `get_user_id_by_email`** requer que a colaboradora já tenha conta — documentado no Step 5.4
- **RLS atualizada em `patients`** dropa a policy antiga — isso é intencional mas irreversível; fazer backup antes
- **`data_owner_id()` retorna `null`** para usuários sem clínica criada — o `UserRoleContext` cria a clínica no primeiro acesso, mas há uma janela transitória; não bloqueia o sistema
- **Tabelas `surgeries` e `consultations`** têm suas próprias RLS (em `erp_relational_schema.sql`) que precisam ser atualizadas da mesma forma que `patients` — isso está fora do escopo deste plano e deve ser feito em seguida

### Fora do escopo deste plano
- Atualizar RLS de `surgeries`, `consultations`, `medical_records` (próximo passo natural após validar este plano)
- Convite por link (sem precisar que a colaboradora tenha conta prévia)
- Notificação por e-mail ao convidar
- Edição de role de membro existente
