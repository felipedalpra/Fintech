# Receituário + PDF — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar um módulo de receituário com catálogo de medicamentos pré-cadastrados (com posologia padrão), emissão de receita para paciente e geração de PDF com timbre via impressão do browser. Sem receitas de controle especial (azul/amarela).

**Architecture:** Segue o mesmo padrão do Pedido de Exames. Tabelas `medication_catalog` e `prescriptions`. O componente `PrintDocument.jsx` (criado no plano de Pedido de Exames) é reutilizado. O catálogo tem modelos de posologia que a Dra. pode editar antes de emitir.

**Tech Stack:** React 18, Supabase (Postgres + RLS), `PrintDocument.jsx` (reutilizado)

---

## Padrão e contexto (atualizado 2026-10-10)

> Alinha à spec de arquitetura `docs/superpowers/specs/2026-10-10-platform-architecture-design.md`. As Tasks abaixo continuam válidas.

**Contexto do cliente:** Fase 4. Receituário com catálogo de medicamentos (posologia padrão) e PDF com timbre. **Sem receitas de controle especial (azul/amarela)** — fora do escopo do contrato.

**Área e navegação:** área **Clínico → Receituário**. Reusa `PrintDocument.jsx` do pedido de exames.

**Benchmark (o que copiar):** modelos de posologia editáveis antes de emitir; PDF com timbre e CRM.

**Modelo de dados e propagação:**
- `medication_catalog`, `prescriptions`; timbre da config (fonte única).
- A receita emitida é **registrada** (histórico); o PDF reflete fielmente a receita salva.

**Permissões:** perfis clínicos (emissão de receita é ato médico).

**Checklist de fidedignidade (desta feature):**
1. O PDF reflete exatamente os medicamentos/posologia selecionados + paciente + CRM.
2. **Bloqueio de escopo:** nada de controle especial (azul/amarela) — não oferecer esses modelos.
3. Receita emitida é persistida no histórico do paciente.
4. Editar o catálogo não altera receitas já emitidas.
5. Teste cobre: montar receita → salvar → PDF confere; tentativa de controle especial não é suportada.

---

## Referências obrigatórias

- `src/components/PrintDocument.jsx` — componente de impressão criado no plano `pedido-exames-pdf` (deve existir antes deste)
- `src/components/ExamRequest.jsx` — seguir o mesmo padrão de UI
- `src/components/Patients.jsx` — onde a aba "Receita" será adicionada
- `supabase/exam_catalog_schema.sql` — seguir o mesmo padrão de schema
- `src/theme.js` — `C.text`, `C.surface`, `C.border`, `C.accent`, `C.textSub`

---

## Mapa de arquivos

| Arquivo | Ação | Responsabilidade |
|---------|------|-----------------|
| `supabase/prescription_schema.sql` | Criar | Tabelas `medication_catalog` e `prescriptions` |
| `src/components/Prescription.jsx` | Criar | Seleção de medicamentos, edição de posologia, geração de PDF |
| `src/components/Patients.jsx` | Modificar | Nova aba "Receita" no drawer do paciente |

---

## Task 1: Schema SQL

**Files:**
- Create: `supabase/prescription_schema.sql`

- [ ] **Step 1.1: Criar migração**

```sql
-- prescription_schema.sql

-- Catálogo de medicamentos com posologia padrão.
create table if not exists public.medication_catalog (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,                          -- ex: 'Dipirona 500mg'
  default_dosage text not null default '',     -- ex: '1 comprimido de 6 em 6 horas por 3 dias'
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now())
);

-- Prescrições emitidas.
create table if not exists public.prescriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  -- Snapshot dos medicamentos no momento da emissão.
  items jsonb not null,   -- [{ name, dosage }, ...]
  observations text,
  issued_at date not null default current_date,
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.medication_catalog enable row level security;
alter table public.prescriptions enable row level security;

do $$ begin
  begin
    create policy "Medication catalog own" on public.medication_catalog
      for all to authenticated
      using (auth.uid() = user_id) with check (auth.uid() = user_id);
    create policy "Prescriptions own" on public.prescriptions
      for all to authenticated
      using (auth.uid() = user_id) with check (auth.uid() = user_id);
  exception when duplicate_object then null; end;
end $$;

create index if not exists idx_medication_catalog_user on public.medication_catalog(user_id, active);
create index if not exists idx_prescriptions_patient on public.prescriptions(patient_id, issued_at desc);
```

- [ ] **Step 1.2: Popular catálogo com medicamentos comuns pós-operatórios**

Executar após criar o schema (substituir `SEU_USER_ID` pelo UUID real):

```sql
-- Exemplo de seed — executar uma vez com o user_id real da Dra. Vitoria.
-- Buscar o user_id: select id from auth.users where email = 'email-da-dra@exemplo.com';
insert into public.medication_catalog (user_id, name, default_dosage) values
  ('<SEU_USER_ID>', 'Dipirona 500mg', '1 comprimido de 6 em 6 horas por 5 dias se dor ou febre'),
  ('<SEU_USER_ID>', 'Ibuprofeno 600mg', '1 comprimido de 8 em 8 horas por 5 dias após as refeições'),
  ('<SEU_USER_ID>', 'Cefalexina 500mg', '1 cápsula de 6 em 6 horas por 7 dias'),
  ('<SEU_USER_ID>', 'Omeprazol 20mg', '1 cápsula em jejum pela manhã por 14 dias'),
  ('<SEU_USER_ID>', 'Nimesulida 100mg', '1 comprimido de 12 em 12 horas por 5 dias após as refeições'),
  ('<SEU_USER_ID>', 'Tramadol 50mg', '1 cápsula de 6 em 6 horas por 3 dias se dor intensa');
```

- [ ] **Step 1.3: Aplicar e verificar**

Executar o schema + seed. Confirmar no Table Editor.

---

## Task 2: Componente `Prescription.jsx`

**Files:**
- Create: `src/components/Prescription.jsx`

- [ ] **Step 2.1: Criar o componente**

```jsx
import { useEffect, useState } from 'react'
import { C, base } from '../theme.js'
import { Btn } from './UI.jsx'
import { PrintDocument } from './PrintDocument.jsx'
import { supabase } from '../lib/supabase.js'
import { formatDateBR, today } from '../utils.js'

export function Prescription({ patientId, patientName, userId, clinicInfo }) {
  const [catalog, setCatalog] = useState([])
  const [items, setItems] = useState([])   // [{ name, dosage }, ...]
  const [observations, setObservations] = useState('')
  const [history, setHistory] = useState([])
  const [printing, setPrinting] = useState(null)
  const [saving, setSaving] = useState(false)
  const [tab, setTab] = useState('new')

  useEffect(() => {
    async function load() {
      const [{ data: meds }, { data: reqs }] = await Promise.all([
        supabase.from('medication_catalog').select('id, name, default_dosage').eq('user_id', userId).eq('active', true).order('name'),
        supabase.from('prescriptions').select('*').eq('patient_id', patientId).order('issued_at', { ascending: false }),
      ])
      setCatalog(meds ?? [])
      setHistory(reqs ?? [])
    }
    load()
  }, [patientId, userId])

  function addMed(med) {
    if (items.find(i => i.catalog_id === med.id)) return
    setItems(prev => [...prev, { catalog_id: med.id, name: med.name, dosage: med.default_dosage }])
  }

  function removeMed(idx) {
    setItems(prev => prev.filter((_, i) => i !== idx))
  }

  function updateDosage(idx, dosage) {
    setItems(prev => prev.map((item, i) => i === idx ? { ...item, dosage } : item))
  }

  async function saveAndPrint() {
    if (items.length === 0) return
    setSaving(true)
    const payload = items.map(({ name, dosage }) => ({ name, dosage }))
    const { data, error } = await supabase.from('prescriptions').insert({
      user_id: userId,
      patient_id: patientId,
      items: payload,
      observations: observations || null,
      issued_at: today(),
    }).select().single()
    setSaving(false)
    if (!error && data) {
      setPrinting(data)
      setItems([])
      setObservations('')
      const { data: updated } = await supabase.from('prescriptions').select('*').eq('patient_id', patientId).order('issued_at', { ascending: false })
      setHistory(updated ?? [])
    }
  }

  const isAdded = id => !!items.find(i => i.catalog_id === id)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8 }}>
        {['new', 'history'].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: '6px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13,
            background: tab === t ? C.accent : C.border,
            color: tab === t ? '#fff' : C.textSub,
          }}>
            {t === 'new' ? 'Nova receita' : `Histórico (${history.length})`}
          </button>
        ))}
      </div>

      {tab === 'new' && (
        <>
          {/* Catálogo */}
          <div>
            <p style={{ fontSize: 11, color: C.textSub, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>Medicamentos</p>
            {catalog.length === 0 ? (
              <p style={{ fontSize: 13, color: C.textDim }}>Nenhum medicamento cadastrado. Adicione em Configurações → Medicamentos.</p>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {catalog.map(med => (
                  <button
                    key={med.id}
                    onClick={() => addMed(med)}
                    disabled={isAdded(med.id)}
                    style={{
                      padding: '5px 14px', borderRadius: 20, fontSize: 12, cursor: isAdded(med.id) ? 'default' : 'pointer',
                      border: `1px solid ${isAdded(med.id) ? C.border : C.accent}`,
                      background: isAdded(med.id) ? C.border : 'none',
                      color: isAdded(med.id) ? C.textDim : C.accent,
                    }}
                  >
                    {isAdded(med.id) ? '✓ ' : '+ '}{med.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Itens selecionados com posologia editável */}
          {items.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <p style={{ fontSize: 11, color: C.textSub, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Posologia (editável)</p>
              {items.map((item, idx) => (
                <div key={idx} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <span style={{ fontSize: 13, color: C.text, fontWeight: 600 }}>{item.name}</span>
                    <button onClick={() => removeMed(idx)} style={{ background: 'none', border: 'none', color: C.textDim, cursor: 'pointer', fontSize: 12 }}>✕ Remover</button>
                  </div>
                  <textarea
                    value={item.dosage}
                    onChange={e => updateDosage(idx, e.target.value)}
                    rows={2}
                    style={{ ...base.input, resize: 'vertical', fontFamily: 'inherit', fontSize: 12 }}
                  />
                </div>
              ))}
            </div>
          )}

          {/* Observações */}
          {items.length > 0 && (
            <div>
              <label style={base.label}>Observações (opcional)</label>
              <textarea
                value={observations}
                onChange={e => setObservations(e.target.value)}
                rows={2}
                placeholder="Orientações adicionais ao paciente…"
                style={{ ...base.input, resize: 'vertical', fontFamily: 'inherit' }}
              />
            </div>
          )}

          <Btn onClick={saveAndPrint} disabled={saving || items.length === 0} style={{ alignSelf: 'flex-end' }}>
            {saving ? 'Salvando…' : '🖨️ Emitir e imprimir'}
          </Btn>
        </>
      )}

      {tab === 'history' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {history.length === 0 && <p style={{ fontSize: 13, color: C.textDim }}>Nenhuma receita emitida ainda.</p>}
          {history.map(rx => (
            <div key={rx.id} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13, color: C.text, fontWeight: 600 }}>{formatDateBR(rx.issued_at)}</span>
                <button onClick={() => setPrinting(rx)} style={{ background: 'none', border: `1px solid ${C.border}`, color: C.accent, fontSize: 11, borderRadius: 6, padding: '3px 10px', cursor: 'pointer' }}>
                  Reimprimir
                </button>
              </div>
              <div style={{ fontSize: 12, color: C.textSub, marginTop: 4 }}>
                {rx.items.map(i => i.name).join(' · ')}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal de impressão */}
      {printing && (
        <PrintDocument onClose={() => setPrinting(null)} title="Receituário" clinicInfo={clinicInfo}>
          <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>RECEITUÁRIO SIMPLES</h2>
          <p style={{ fontSize: 13, color: '#555', marginBottom: 20 }}>Paciente: <strong>{patientName}</strong> · Data: {formatDateBR(printing.issued_at)}</p>

          {printing.items.map((item, i) => (
            <div key={i} style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{i + 1}. {item.name}</div>
              <div style={{ fontSize: 13, color: '#444', marginTop: 4, paddingLeft: 16 }}>{item.dosage}</div>
            </div>
          ))}

          {printing.observations && (
            <div style={{ marginTop: 20, padding: 12, border: '1px solid #ddd', borderRadius: 6 }}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>OBSERVAÇÕES:</div>
              <div style={{ fontSize: 13, color: '#444' }}>{printing.observations}</div>
            </div>
          )}

          <div style={{ marginTop: 48, borderTop: '1px solid #ccc', paddingTop: 16, textAlign: 'center' }}>
            <div style={{ width: 200, margin: '0 auto', borderTop: '1px solid #111', paddingTop: 8, fontSize: 12 }}>
              Assinatura e Carimbo
            </div>
          </div>
        </PrintDocument>
      )}
    </div>
  )
}
```

---

## Task 3: Aba "Receita" no drawer de Patients

**Files:**
- Modify: `src/components/Patients.jsx`

- [ ] **Step 3.1: Adicionar "receita" ao `DRAWER_TABS`**

```js
const DRAWER_TABS = ['resumo', 'pessoal', 'anamnese', 'prontuario', 'exames', 'receita', 'financeiro']
const DRAWER_TAB_LABELS = { ..., receita: 'Receita' }
```

- [ ] **Step 3.2: Importar `Prescription` e renderizar**

```jsx
import { Prescription } from './Prescription.jsx'

{activeDrawerTab === 'receita' && (
  <Prescription
    patientId={selectedPatient.id}
    patientName={selectedPatient.full_name}
    userId={user.id}
    clinicInfo={clinicInfo}
  />
)}
```

- [ ] **Step 3.3: Testar fluxo completo**

```bash
npm run dev
```

1. Abrir paciente → aba Receita
2. Clicar em um medicamento do catálogo → aparece com posologia editável
3. Editar posologia → clicar "Emitir e imprimir"
4. PDF aparece com timbre → testar Ctrl+P

- [ ] **Step 3.4: Commit**

```bash
git add supabase/prescription_schema.sql src/components/Prescription.jsx src/components/Patients.jsx
git commit -m "feat: receituário com catálogo de medicamentos, posologia editável e PDF via impressão"
```

- [ ] **Step 3.5: Atualizar CHANGELOG.md**

```
### Added
- Receituário: catálogo de medicamentos com posologia padrão editável, emissão de receita simples com PDF via print, histórico por paciente. Arquivos: `src/components/Prescription.jsx`, `supabase/prescription_schema.sql`.
```

---

## Self-review

### Cobertura
- ✅ Catálogo de medicamentos pré-cadastrado
- ✅ Posologia padrão editável antes de emitir
- ✅ Modelos prontos (seed SQL com medicamentos comuns)
- ✅ PDF com timbre via window.print()
- ✅ Histórico de receitas por paciente
- ✅ Sem receitas de controle especial (azul/amarela) — escopo explícito fora

### Riscos
- O seed SQL precisa do `user_id` real da Dra. — o dev precisa buscar antes de executar
- Mesmo risco do print CSS do plano de exames (Firefox)

### Fora do escopo
- Cadastro do catálogo via UI (mesmo ponto pendente que o catálogo de exames)
- Receitas de controle especial (fora do escopo do produto)
