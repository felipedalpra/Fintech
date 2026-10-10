# Patient Funnel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar uma tela de funil kanban que mostra todos os pacientes distribuídos em 5 estágios da jornada clínica, permitindo mover pacientes entre estágios.

**Architecture:** Uma coluna `funnel_stage` é adicionada à tabela `patients` existente. Um novo componente `PatientFunnel.jsx` renderiza o kanban com 5 colunas fixas. Não usa biblioteca de drag-and-drop — cada card tem um seletor de estágio para mover o paciente via click, garantindo funcionalidade em mobile e facilidade de teste.

**Tech Stack:** React 18, Supabase (Postgres + RLS), CSS inline via `theme.js` (padrão do projeto)

---

## Padrão e contexto (atualizado 2026-10-10)

> Alinha o plano à spec de arquitetura `docs/superpowers/specs/2026-10-10-platform-architecture-design.md`. As Tasks abaixo continuam válidas.

**Contexto do cliente:** o funil é a feature central pedida pela Dra. Vitória na Fase 1 — dar visibilidade da jornada do paciente (consulta → orçamento → reserva → follow-up). É onde o concierge (Jonas) e a secretária trabalham no dia a dia.

**Área e navegação:** área **Pacientes (CRM & Jornada)**, primeira seção. Acesso: todos os perfis.

**Benchmark (o que copiar):** Kommo — funil kanban com cards e etapas configuráveis e movimentação visual. Repos de referência: DeskcommCRM, wacrm, Frappe CRM; UI de arrastar/soltar: `dnd-kit`.
> Nota de design: o plano atual move por `<select>`/clique, não por drag-and-drop — decisão pragmática por mobile e testabilidade. Mantemos como MVP; o drag-and-drop estilo Kommo (`dnd-kit`) fica como evolução e **não bloqueia a entrega**.

**Fluxo ideal:** (1) abre o Funil e vê as 5 colunas; (2) cada card mostra paciente + estágio + próxima ação; (3) mover o paciente atualiza o estágio e persiste na hora; (4) clicar no card abre o drawer do paciente sem sair do funil; (5) pacientes parados entram em régua de follow-up (automação, Fase 2).

**Modelo de dados e propagação:**
- Registro-fonte: `patients.funnel_stage` — é um **estado de CRM armazenado** (não um número derivado), o que é correto aqui.
- Movido **manualmente** (usuário) OU **por automação** (Fase 2 `automacoes-funil`: consulta criada → `consultado`; pagamento registrado → `reserva_paga`). A automação **não pode sobrescrever silenciosamente** um estágio movido à mão — toda mudança automática tem de ser auditável.
- O funil **lê** o estado real do paciente; o estágio não deve divergir do estado financeiro/clínico (ex.: `reserva_paga` sem pagamento registrado é inconsistência a sinalizar).

**Pontos de integração/automação:** os gatilhos de movimentação automática ficam na área Automações (Fase 2), apenas referenciados aqui. Agenda e WhatsApp inbox acessíveis a partir do card.

**Permissões:** admin, gestão e equipe — todos veem e movem (CRM é de todos). Sem dados financeiros sensíveis no card além do status.

**Checklist de fidedignidade (desta feature):**
1. Mover de estágio persiste e reflete imediatamente em todas as colunas, sem recarregar.
2. Automação (quando ativa) e movimento manual não conflitam; mudança automática é auditável.
3. O estágio não diverge do estado real (pagamento/consulta); divergência é sinalizada.
4. `patient_id` nullable e pacientes sem estágio recebem o default sem quebrar.
5. RLS: só aparecem pacientes do `user_id`/clínica (via `data_owner_id()` para membros).
6. Teste cobre: novo paciente → cai em `consulta_agendada`; mover → persiste; (Fase 2) evento → move automático.

---

## Arquivo de referência obrigatória

Antes de qualquer step, leia:
- `src/theme.js` — sistema de cores e `base` helper
- `src/components/UI.jsx` — componentes `Card`, `Btn`, `Badge`, `Modal`
- `src/components/Patients.jsx` — drawer existente de paciente (reutilize o `PatientDrawer` se já existir como componente separado, ou abra o drawer via `setSelected`)
- `src/pages/FinanceWorkspace.jsx` — padrão de registro de rotas e `NAV_SECTIONS`
- `supabase/patients_schema.sql` — estrutura atual da tabela `patients`

---

## Mapa de arquivos

| Arquivo | Ação | Responsabilidade |
|---------|------|-----------------|
| `supabase/patient_funnel_schema.sql` | Criar | Migração: adiciona `funnel_stage` em `patients` |
| `src/components/PatientFunnel.jsx` | Criar | Componente kanban principal |
| `src/pages/FinanceWorkspace.jsx` | Modificar | Registrar rota `funnel` + item de nav |

---

## Task 1: Migração SQL

**Files:**
- Create: `supabase/patient_funnel_schema.sql`

- [ ] **Step 1.1: Criar o arquivo de migração**

```sql
-- patient_funnel_schema.sql
-- Adiciona estágio de funil à tabela patients.
-- Executar no Supabase SQL Editor ANTES do deploy.

alter table public.patients
  add column if not exists funnel_stage text not null default 'consulta_agendada'
  check (funnel_stage in (
    'consulta_agendada',
    'consultado',
    'orcamento_enviado',
    'reserva_paga',
    'follow_up'
  ));

create index if not exists idx_patients_funnel_stage
  on public.patients(user_id, funnel_stage);
```

- [ ] **Step 1.2: Aplicar no Supabase**

No Supabase Dashboard → SQL Editor, colar e executar o conteúdo acima.

Verificar que não há erro e que a coluna aparece em Table Editor → patients.

- [ ] **Step 1.3: Confirmar default**

```sql
-- Verificar que pacientes existentes têm o stage default
select funnel_stage, count(*) from public.patients group by funnel_stage;
```

Esperado: todos em `consulta_agendada`.

---

## Task 2: Componente `PatientFunnel.jsx`

**Files:**
- Create: `src/components/PatientFunnel.jsx`

Este componente busca todos os pacientes do usuário, agrupa por `funnel_stage` e renderiza 5 colunas. Cada card exibe nome, telefone e data de cadastro. Um `<select>` no card permite mover o paciente para outro estágio — atualiza no Supabase e reflete imediatamente no estado local.

- [ ] **Step 2.1: Escrever o componente completo**

```jsx
import { useEffect, useState } from 'react'
import { C, base } from '../theme.js'
import { Card, Badge } from './UI.jsx'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { formatDateBR } from '../utils.js'

const STAGES = [
  { key: 'consulta_agendada', label: 'Consulta Agendada', color: '#6366f1' },
  { key: 'consultado',        label: 'Consultado',        color: '#0ea5e9' },
  { key: 'orcamento_enviado', label: 'Orçamento Enviado', color: '#f59e0b' },
  { key: 'reserva_paga',      label: 'Reserva Paga',      color: '#10b981' },
  { key: 'follow_up',         label: 'Follow-up',         color: '#8b5cf6' },
]

export function PatientFunnel() {
  const { user } = useAuth()
  const [patients, setPatients] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [movingId, setMovingId] = useState(null)

  useEffect(() => {
    if (!user) return
    let mounted = true

    async function load() {
      setLoading(true)
      const { data, error: err } = await supabase
        .from('patients')
        .select('id, full_name, phone, start_date, funnel_stage')
        .eq('user_id', user.id)
        .eq('active', true)
        .order('created_at', { ascending: false })

      if (!mounted) return
      if (err) { setError(err.message); setLoading(false); return }
      setPatients(data ?? [])
      setLoading(false)
    }

    load()
    return () => { mounted = false }
  }, [user])

  async function movePatient(patientId, newStage) {
    setMovingId(patientId)
    const { error: err } = await supabase
      .from('patients')
      .update({ funnel_stage: newStage })
      .eq('id', patientId)
      .eq('user_id', user.id)

    if (!err) {
      setPatients(prev =>
        prev.map(p => p.id === patientId ? { ...p, funnel_stage: newStage } : p)
      )
    }
    setMovingId(null)
  }

  function getStagePatients(stageKey) {
    return patients.filter(p => p.funnel_stage === stageKey)
  }

  if (loading) return <LoadingState />
  if (error) return <ErrorState message={error} />

  return <FunnelBoard stages={STAGES} getStagePatients={getStagePatients} movePatient={movePatient} movingId={movingId} />
}

function FunnelBoard({ stages, getStagePatients, movePatient, movingId }) {
  function styles() {
    return {
      board: {
        display: 'flex',
        gap: 16,
        overflowX: 'auto',
        padding: '8px 0 16px',
        alignItems: 'flex-start',
      },
    }
  }
  const s = styles()
  return (
    <div style={s.board}>
      {stages.map(stage => (
        <FunnelColumn
          key={stage.key}
          stage={stage}
          patients={getStagePatients(stage.key)}
          allStages={stages}
          movePatient={movePatient}
          movingId={movingId}
        />
      ))}
    </div>
  )
}

function FunnelColumn({ stage, patients, allStages, movePatient, movingId }) {
  function styles() {
    const C_bg = C('surface')
    const C_border = C('border')
    const C_text = C('text')
    const C_sub = C('subtext')
    return {
      column: {
        minWidth: 240,
        flex: '0 0 240px',
        background: C_bg,
        border: `1px solid ${C_border}`,
        borderRadius: 12,
        padding: 12,
      },
      header: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        marginBottom: 12,
      },
      dot: {
        width: 10,
        height: 10,
        borderRadius: '50%',
        background: stage.color,
        flexShrink: 0,
      },
      title: {
        fontSize: 13,
        fontWeight: 600,
        color: C_text,
        flex: 1,
      },
      count: {
        fontSize: 12,
        color: C_sub,
        background: C_border,
        borderRadius: 10,
        padding: '1px 7px',
      },
      empty: {
        fontSize: 12,
        color: C_sub,
        textAlign: 'center',
        padding: '20px 0',
      },
    }
  }
  const s = styles()
  return (
    <div style={s.column}>
      <div style={s.header}>
        <div style={s.dot} />
        <span style={s.title}>{stage.label}</span>
        <span style={s.count}>{patients.length}</span>
      </div>
      {patients.length === 0
        ? <div style={s.empty}>Nenhum paciente</div>
        : patients.map(p => (
            <PatientCard
              key={p.id}
              patient={p}
              currentStage={stage}
              allStages={allStages}
              movePatient={movePatient}
              isMoving={movingId === p.id}
            />
          ))
      }
    </div>
  )
}

function PatientCard({ patient, currentStage, allStages, movePatient, isMoving }) {
  function styles() {
    const C_bg = C('card')
    const C_border = C('border')
    const C_text = C('text')
    const C_sub = C('subtext')
    return {
      card: {
        background: C_bg,
        border: `1px solid ${C_border}`,
        borderRadius: 8,
        padding: '10px 12px',
        marginBottom: 8,
        opacity: isMoving ? 0.5 : 1,
        transition: 'opacity 0.15s',
      },
      name: {
        fontSize: 13,
        fontWeight: 600,
        color: C_text,
        marginBottom: 2,
      },
      phone: {
        fontSize: 12,
        color: C_sub,
        marginBottom: 6,
      },
      date: {
        fontSize: 11,
        color: C_sub,
        marginBottom: 8,
      },
      select: {
        width: '100%',
        fontSize: 11,
        padding: '3px 6px',
        borderRadius: 6,
        border: `1px solid ${C_border}`,
        background: C_bg,
        color: C_text,
        cursor: isMoving ? 'not-allowed' : 'pointer',
      },
    }
  }
  const s = styles()

  function handleChange(e) {
    const newStage = e.target.value
    if (newStage !== currentStage.key) movePatient(patient.id, newStage)
  }

  return (
    <div style={s.card}>
      <div style={s.name}>{patient.full_name}</div>
      {patient.phone && <div style={s.phone}>{patient.phone}</div>}
      {patient.start_date && (
        <div style={s.date}>Desde {formatDateBR(patient.start_date)}</div>
      )}
      <select
        style={s.select}
        value={currentStage.key}
        onChange={handleChange}
        disabled={isMoving}
        aria-label="Mover para estágio"
      >
        {allStages.map(st => (
          <option key={st.key} value={st.key}>{st.label}</option>
        ))}
      </select>
    </div>
  )
}

function LoadingState() {
  function styles() {
    return {
      wrap: { display: 'flex', gap: 16, padding: '8px 0' },
      col: {
        minWidth: 240,
        height: 200,
        borderRadius: 12,
        background: C('border'),
        opacity: 0.4,
        animation: 'pulse 1.5s infinite',
      },
    }
  }
  const s = styles()
  return (
    <div style={s.wrap}>
      {[1, 2, 3, 4, 5].map(i => <div key={i} style={s.col} />)}
    </div>
  )
}

function ErrorState({ message }) {
  function styles() {
    return {
      wrap: {
        padding: 24,
        color: C('error') || '#ef4444',
        fontSize: 14,
      },
    }
  }
  const s = styles()
  return <div style={s.wrap}>Erro ao carregar funil: {message}</div>
}
```

- [ ] **Step 2.2: Verificar que `formatDateBR` existe em `utils.js`**

```bash
grep -n "formatDateBR" /Users/felipedalpra/Documents/startup-finance/src/utils.js
```

Esperado: pelo menos uma definição da função. Se não existir, adicionar:

```js
// em utils.js
export function formatDateBR(dateStr) {
  if (!dateStr) return ''
  const [y, m, d] = dateStr.split('-')
  return `${d}/${m}/${y}`
}
```

- [ ] **Step 2.3: Verificar que `C('card')` e `C('surface')` existem em `theme.js`**

```bash
grep -n "'card'\|'surface'\|'border'\|'subtext'\|'error'" /Users/felipedalpra/Documents/startup-finance/src/theme.js | head -20
```

Se algum token não existir, substituir pelo token equivalente encontrado no grep (ex: use `C('bg')` se não houver `C('surface')`). Não invente tokens — use apenas os que existem no arquivo.

---

## Task 3: Registrar rota em FinanceWorkspace

**Files:**
- Modify: `src/pages/FinanceWorkspace.jsx`

- [ ] **Step 3.1: Importar `PatientFunnel`**

Em `src/pages/FinanceWorkspace.jsx`, adicionar ao bloco de imports (junto com os outros componentes):

```js
import { PatientFunnel } from '../components/PatientFunnel.jsx'
```

- [ ] **Step 3.2: Adicionar item de nav na seção Operação**

No array `NAV_SECTIONS`, dentro do grupo `'Operação'`, adicionar após o item `patients`:

```js
{ id:'funnel', label:'Funil', icon:'funnel', hint:'Jornada dos pacientes por estágio' },
```

> **Nota:** O ícone `'funnel'` pode não existir em `NavIcon.jsx`. Verificar com:
>
> ```bash
> grep -n "funnel\|kanban\|pipeline" /Users/felipedalpra/Documents/startup-finance/src/components/NavIcon.jsx
> ```
>
> Se não existir, usar `icon:'patients'` temporariamente até o ícone ser adicionado.

- [ ] **Step 3.3: Adicionar ao `TITLES`**

No objeto `TITLES`, adicionar:

```js
funnel: 'Funil de Jornada',
```

- [ ] **Step 3.4: Renderizar o componente no switch de páginas**

Dentro da função que faz o render condicional por `page` (procurar por `case 'patients'` ou o padrão equivalente), adicionar:

```jsx
case 'funnel': return <PatientFunnel />
```

> Se o render usa objeto de mapa (ex: `const PAGE_MAP = {...}`), adicionar:
> ```js
> funnel: <PatientFunnel />,
> ```

- [ ] **Step 3.5: Verificar a renderização no browser**

```bash
npm run dev
```

Navegar para `/app/funnel`. Verificar que:
- 5 colunas aparecem
- Pacientes cadastrados aparecem na coluna `Consulta Agendada`
- O `<select>` de estágio aparece em cada card

- [ ] **Step 3.6: Testar a movimentação**

1. Abrir `/app/funnel`
2. Escolher um paciente e trocar de estágio no `<select>`
3. O card deve sumir da coluna atual e aparecer na coluna destino imediatamente
4. Recarregar a página e confirmar que a mudança persistiu (verificar no Supabase Table Editor se necessário)

- [ ] **Step 3.7: Commit**

```bash
git add supabase/patient_funnel_schema.sql \
        src/components/PatientFunnel.jsx \
        src/pages/FinanceWorkspace.jsx
git commit -m "feat: funil de jornada do paciente com 5 estágios kanban"
```

- [ ] **Step 3.8: Atualizar CHANGELOG.md**

Adicionar ao `CHANGELOG.md` (seção `Added`):

```
### Added
- Funil de jornada do paciente: tela kanban com 5 estágios (consulta agendada → consultado → orçamento enviado → reserva paga → follow-up). Coluna `funnel_stage` adicionada à tabela `patients`. Arquivo: `src/components/PatientFunnel.jsx`, `supabase/patient_funnel_schema.sql`.
```

---

## Self-review

### Cobertura do spec
- ✅ 5 estágios definidos no CLAUDE.md: consulta_agendada, consultado, orcamento_enviado, reserva_paga, follow_up
- ✅ Tela visual (kanban) com colunas por estágio
- ✅ Mover paciente entre estágios
- ✅ Persiste no Supabase
- ✅ Integra com nav existente

### Riscos
- `C('card')` / `C('surface')` podem não ser tokens válidos — o Step 2.3 instrui a verificar antes de usar
- Ícone `'funnel'` pode não existir em `NavIcon.jsx` — Step 3.2 instrui fallback
- A função `formatDateBR` pode já existir com outra assinatura — Step 2.2 instrui verificar

### Fora do escopo deste plano
- Drag-and-drop (usar select é mais simples e testável; drag pode ser adicionado depois como enhancement)
- Filtros por período ou procedimento
- Abrir drawer do paciente ao clicar no card (pode ser adicionado como step extra: ao clicar no nome, abrir o Patients.jsx com `setSelected`)
- Automações de WhatsApp ao mudar de estágio (Fase 2)
