# Pedido de Exames + PDF — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar um módulo de pedido de exames com catálogo pré-cadastrado (incluindo kits como "kit pré-operatório"), seleção de exames para um paciente e geração de PDF com timbre da Dra. via impressão do browser.

**Architecture:** Duas tabelas: `exam_catalog` (lista de exames pré-cadastrada com kits) e `exam_requests` (pedido emitido para um paciente). O PDF é gerado como uma modal full-screen com estilos `@media print` que escondem a UI do sistema — a Dra. usa Ctrl+P / Cmd+P ou o botão "Imprimir". Sem biblioteca externa de PDF. O timbre da Dra. (logo, nome, CRM, endereço) é configurado em Settings.

**Tech Stack:** React 18, Supabase (Postgres + RLS), `@media print` CSS via `<style>` tag injetada

---

## Referências obrigatórias

- `src/components/Settings.jsx` — onde fica a configuração do timbre da Dra.
- `src/components/Patients.jsx` — onde o módulo será acessado (aba Prontuário ou nova aba no drawer)
- `src/theme.js` — `C.text`, `C.surface`, `C.border`, `C.accent`, `C.textSub`; usar `C.` diretamente

---

## Mapa de arquivos

| Arquivo | Ação | Responsabilidade |
|---------|------|-----------------|
| `supabase/exam_catalog_schema.sql` | Criar | Tabelas `exam_catalog`, `exam_kits`, `exam_requests` |
| `src/components/ExamRequest.jsx` | Criar | Seleção de exames + geração de PDF |
| `src/components/PrintDocument.jsx` | Criar | Componente reutilizável de impressão com timbre |
| `src/components/Settings.jsx` | Modificar | Aba "Timbre" para configurar dados da Dra. |
| `src/components/Patients.jsx` | Modificar | Nova aba "Exames" no drawer do paciente |

---

## Task 1: Schema SQL

**Files:**
- Create: `supabase/exam_catalog_schema.sql`

- [ ] **Step 1.1: Criar migração**

```sql
-- exam_catalog_schema.sql

-- Catálogo de exames.
create table if not exists public.exam_catalog (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  instructions text,           -- orientações ao laboratório/paciente
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now())
);

-- Kits: agrupamentos de exames (ex: kit pré-operatório).
create table if not exists public.exam_kits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now())
);

-- Itens de cada kit.
create table if not exists public.exam_kit_items (
  kit_id uuid not null references public.exam_kits(id) on delete cascade,
  exam_id uuid not null references public.exam_catalog(id) on delete cascade,
  primary key (kit_id, exam_id)
);

-- Pedidos emitidos.
create table if not exists public.exam_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  exam_ids uuid[] not null,         -- snapshot dos ids selecionados
  exam_names text[] not null,       -- snapshot dos nomes (não depende do catálogo depois)
  clinical_indication text,
  issued_at date not null default current_date,
  created_at timestamptz not null default timezone('utc', now())
);

-- RLS
alter table public.exam_catalog enable row level security;
alter table public.exam_kits enable row level security;
alter table public.exam_kit_items enable row level security;
alter table public.exam_requests enable row level security;

do $$ begin
  begin
    create policy "Exam catalog own" on public.exam_catalog for all to authenticated
      using (auth.uid() = user_id) with check (auth.uid() = user_id);
    create policy "Exam kits own" on public.exam_kits for all to authenticated
      using (auth.uid() = user_id) with check (auth.uid() = user_id);
    create policy "Exam kit items own" on public.exam_kit_items for all to authenticated
      using (kit_id in (select id from public.exam_kits where user_id = auth.uid()));
    create policy "Exam requests own" on public.exam_requests for all to authenticated
      using (auth.uid() = user_id) with check (auth.uid() = user_id);
  exception when duplicate_object then null; end;
end $$;

create index if not exists idx_exam_catalog_user on public.exam_catalog(user_id, active);
create index if not exists idx_exam_requests_patient on public.exam_requests(patient_id, issued_at desc);
```

- [ ] **Step 1.2: Aplicar e verificar no Supabase**

Executar no SQL Editor. Confirmar as 4 tabelas no Table Editor.

---

## Task 2: Componente reutilizável `PrintDocument.jsx`

**Files:**
- Create: `src/components/PrintDocument.jsx`

Este componente é usado pelo pedido de exames E pelo receituário. Encapsula a lógica de impressão.

- [ ] **Step 2.1: Criar o componente**

```jsx
import { useEffect } from 'react'
import { C } from '../theme.js'

// PrintDocument: renderiza um documento imprimível como overlay.
// Injeta CSS de impressão que esconde o resto da UI e mostra apenas este componente.
// Uso: <PrintDocument onClose={...} title="Pedido de Exames" clinicInfo={...}>{conteúdo}</PrintDocument>
export function PrintDocument({ onClose, title, clinicInfo, children }) {
  useEffect(() => {
    // Injetar estilos de impressão.
    const style = document.createElement('style')
    style.id = 'print-doc-styles'
    style.textContent = `
      @media print {
        body > * { display: none !important; }
        #print-document-root { display: block !important; }
        #print-document-root .no-print { display: none !important; }
      }
    `
    document.head.appendChild(style)
    return () => { document.getElementById('print-doc-styles')?.remove() }
  }, [])

  const overlayStyle = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
    display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
    overflowY: 'auto', zIndex: 9999, padding: '24px 16px',
  }
  const docStyle = {
    background: '#fff', color: '#111', width: '100%', maxWidth: 680,
    padding: '40px 48px', borderRadius: 4, boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
    fontFamily: 'Arial, sans-serif', fontSize: 13, lineHeight: 1.6,
  }
  const headerStyle = {
    borderBottom: '2px solid #111', paddingBottom: 16, marginBottom: 24,
    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
  }
  const actionsStyle = {
    display: 'flex', gap: 10, marginTop: 32, justifyContent: 'flex-end',
  }
  const btnPrint = {
    padding: '10px 24px', background: '#1a1a1a', color: '#fff',
    border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 600,
  }
  const btnClose = {
    padding: '10px 24px', background: 'none', color: '#555',
    border: '1px solid #ccc', borderRadius: 8, cursor: 'pointer', fontSize: 14,
  }

  return (
    <div style={overlayStyle} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div id="print-document-root" style={docStyle}>
        {/* Timbre */}
        <div style={headerStyle}>
          <div>
            {clinicInfo?.doctorName && <div style={{ fontSize: 17, fontWeight: 700 }}>{clinicInfo.doctorName}</div>}
            {clinicInfo?.crm && <div style={{ fontSize: 12, color: '#444' }}>CRM {clinicInfo.crm}</div>}
            {clinicInfo?.specialty && <div style={{ fontSize: 12, color: '#444' }}>{clinicInfo.specialty}</div>}
          </div>
          <div style={{ textAlign: 'right', fontSize: 12, color: '#444' }}>
            {clinicInfo?.address && <div>{clinicInfo.address}</div>}
            {clinicInfo?.phone && <div>{clinicInfo.phone}</div>}
          </div>
        </div>

        {/* Conteúdo do documento */}
        {children}

        {/* Rodapé */}
        <div style={{ marginTop: 48, borderTop: '1px solid #ccc', paddingTop: 12, fontSize: 11, color: '#888', textAlign: 'center' }}>
          {clinicInfo?.doctorName} · {clinicInfo?.crm && `CRM ${clinicInfo.crm} · `}{new Date().toLocaleDateString('pt-BR')}
        </div>

        {/* Botões (escondidos na impressão) */}
        <div style={actionsStyle} className="no-print">
          <button style={btnClose} onClick={onClose}>Fechar</button>
          <button style={btnPrint} onClick={() => window.print()}>🖨️ Imprimir / Salvar PDF</button>
        </div>
      </div>
    </div>
  )
}
```

---

## Task 3: Componente `ExamRequest.jsx`

**Files:**
- Create: `src/components/ExamRequest.jsx`

- [ ] **Step 3.1: Criar o componente**

```jsx
import { useEffect, useState } from 'react'
import { C, base } from '../theme.js'
import { Btn } from './UI.jsx'
import { PrintDocument } from './PrintDocument.jsx'
import { supabase } from '../lib/supabase.js'
import { formatDateBR, today } from '../utils.js'

export function ExamRequest({ patientId, patientName, userId, clinicInfo }) {
  const [catalogo, setCatalogo] = useState([])
  const [kits, setKits] = useState([])
  const [selected, setSelected] = useState([])          // array de { id, name }
  const [indication, setIndication] = useState('')
  const [history, setHistory] = useState([])
  const [printing, setPrinting] = useState(null)        // { exam_names, indication, issued_at }
  const [saving, setSaving] = useState(false)
  const [tab, setTab] = useState('new')                 // 'new' | 'history'

  useEffect(() => {
    loadData()
  }, [patientId, userId])

  async function loadData() {
    const [{ data: exams }, { data: kitList }, { data: kitItems }, { data: reqs }] = await Promise.all([
      supabase.from('exam_catalog').select('id, name').eq('user_id', userId).eq('active', true).order('name'),
      supabase.from('exam_kits').select('id, name').eq('user_id', userId).eq('active', true).order('name'),
      supabase.from('exam_kit_items').select('kit_id, exam_id'),
      supabase.from('exam_requests').select('*').eq('patient_id', patientId).order('issued_at', { ascending: false }),
    ])
    const examMap = {}
    for (const e of exams ?? []) examMap[e.id] = e.name
    const kitsWithExams = (kitList ?? []).map(k => ({
      ...k,
      exams: (kitItems ?? []).filter(i => i.kit_id === k.id).map(i => ({ id: i.exam_id, name: examMap[i.exam_id] })).filter(e => e.name),
    }))
    setCatalogo(exams ?? [])
    setKits(kitsWithExams)
    setHistory(reqs ?? [])
  }

  function toggleExam(exam) {
    setSelected(prev =>
      prev.find(e => e.id === exam.id) ? prev.filter(e => e.id !== exam.id) : [...prev, exam]
    )
  }

  function applyKit(kit) {
    const toAdd = kit.exams.filter(e => !selected.find(s => s.id === e.id))
    setSelected(prev => [...prev, ...toAdd])
  }

  async function saveAndPrint() {
    if (selected.length === 0) return
    setSaving(true)
    const { data, error } = await supabase.from('exam_requests').insert({
      user_id: userId,
      patient_id: patientId,
      exam_ids: selected.map(e => e.id),
      exam_names: selected.map(e => e.name),
      clinical_indication: indication || null,
      issued_at: today(),
    }).select().single()
    setSaving(false)
    if (!error && data) {
      setPrinting(data)
      setSelected([])
      setIndication('')
      loadData()
    }
  }

  const isSelected = id => !!selected.find(e => e.id === id)

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
            {t === 'new' ? 'Novo pedido' : `Histórico (${history.length})`}
          </button>
        ))}
      </div>

      {tab === 'new' && (
        <>
          {/* Kits */}
          {kits.length > 0 && (
            <div>
              <p style={{ fontSize: 11, color: C.textSub, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>Kits</p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {kits.map(k => (
                  <button key={k.id} onClick={() => applyKit(k)} style={{
                    padding: '5px 14px', borderRadius: 20, border: `1px solid ${C.accent}`, background: 'none',
                    color: C.accent, fontSize: 12, cursor: 'pointer',
                  }}>
                    + {k.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Catálogo */}
          <div>
            <p style={{ fontSize: 11, color: C.textSub, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>Exames</p>
            {catalogo.length === 0 ? (
              <p style={{ fontSize: 13, color: C.textDim }}>Nenhum exame cadastrado. Adicione em Configurações → Exames.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {catalogo.map(e => (
                  <label key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '6px 10px', borderRadius: 8, background: isSelected(e.id) ? C.accent + '15' : 'transparent', border: `1px solid ${isSelected(e.id) ? C.accent + '44' : 'transparent'}` }}>
                    <input type="checkbox" checked={isSelected(e.id)} onChange={() => toggleExam(e)} style={{ accentColor: C.accent }} />
                    <span style={{ fontSize: 13, color: C.text }}>{e.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Indicação clínica */}
          {selected.length > 0 && (
            <div>
              <label style={base.label}>Indicação clínica (opcional)</label>
              <textarea
                value={indication}
                onChange={e => setIndication(e.target.value)}
                rows={2}
                placeholder="Ex.: Pré-operatório de rinoplastia"
                style={{ ...base.input, resize: 'vertical', fontFamily: 'inherit' }}
              />
            </div>
          )}

          {/* Selecionados */}
          {selected.length > 0 && (
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12 }}>
              <p style={{ fontSize: 12, color: C.textSub, marginBottom: 6 }}>{selected.length} exame{selected.length !== 1 ? 's' : ''} selecionado{selected.length !== 1 ? 's' : ''}:</p>
              {selected.map(e => (
                <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: C.text, padding: '3px 0' }}>
                  <span>• {e.name}</span>
                  <button onClick={() => toggleExam(e)} style={{ background: 'none', border: 'none', color: C.textDim, cursor: 'pointer', fontSize: 11 }}>✕</button>
                </div>
              ))}
            </div>
          )}

          <Btn onClick={saveAndPrint} disabled={saving || selected.length === 0} style={{ alignSelf: 'flex-end' }}>
            {saving ? 'Salvando…' : '🖨️ Emitir e imprimir'}
          </Btn>
        </>
      )}

      {tab === 'history' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {history.length === 0 && <p style={{ fontSize: 13, color: C.textDim }}>Nenhum pedido emitido ainda.</p>}
          {history.map(req => (
            <div key={req.id} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13, color: C.text, fontWeight: 600 }}>{formatDateBR(req.issued_at)}</span>
                <button onClick={() => setPrinting(req)} style={{ background: 'none', border: `1px solid ${C.border}`, color: C.accent, fontSize: 11, borderRadius: 6, padding: '3px 10px', cursor: 'pointer' }}>
                  Reimprimir
                </button>
              </div>
              <div style={{ fontSize: 12, color: C.textSub, marginTop: 4 }}>
                {req.exam_names.join(' · ')}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal de impressão */}
      {printing && (
        <PrintDocument onClose={() => setPrinting(null)} title="Pedido de Exames" clinicInfo={clinicInfo}>
          <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>SOLICITAÇÃO DE EXAMES</h2>
          <p style={{ fontSize: 13, color: '#555', marginBottom: 20 }}>Paciente: <strong>{patientName}</strong> · Data: {formatDateBR(printing.issued_at)}</p>

          {printing.clinical_indication && (
            <p style={{ fontSize: 13, marginBottom: 16 }}><strong>Indicação:</strong> {printing.clinical_indication}</p>
          )}

          <div style={{ marginBottom: 24 }}>
            {printing.exam_names.map((name, i) => (
              <div key={i} style={{ fontSize: 13, padding: '6px 0', borderBottom: '1px solid #eee' }}>
                {i + 1}. {name}
              </div>
            ))}
          </div>

          <div style={{ marginTop: 48, borderTop: '1px solid #ccc', paddingTop: 16, textAlign: 'center' }}>
            <div style={{ width: 200, margin: '0 auto', borderTop: '1px solid #111', paddingTop: 8, fontSize: 12 }}>
              Assinatura
            </div>
          </div>
        </PrintDocument>
      )}
    </div>
  )
}
```

---

## Task 4: Aba "Exames" no drawer de Patients e configuração em Settings

**Files:**
- Modify: `src/components/Patients.jsx`
- Modify: `src/components/Settings.jsx`

- [ ] **Step 4.1: Adicionar "exames" ao `DRAWER_TABS` em `Patients.jsx`**

```js
const DRAWER_TABS = ['resumo', 'pessoal', 'anamnese', 'prontuario', 'exames', 'financeiro']
const DRAWER_TAB_LABELS = { ..., exames: 'Exames' }
```

- [ ] **Step 4.2: Importar `ExamRequest` e renderizar na aba**

```jsx
import { ExamRequest } from './ExamRequest.jsx'

// Na renderização condicional da aba:
{activeDrawerTab === 'exames' && (
  <ExamRequest
    patientId={selectedPatient.id}
    patientName={selectedPatient.full_name}
    userId={user.id}
    clinicInfo={clinicInfo}  // lido do Settings — ver Step 4.3
  />
)}
```

- [ ] **Step 4.3: Adicionar configuração de timbre em `Settings.jsx`**

O `clinicInfo` precisa vir do banco. Adicionar ao Settings uma aba (ou seção) "Timbre":

```jsx
// Na tabela user_settings (ou criar uma tabela simples):
// Alternativa simples: usar localStorage para o timbre (não é dado sensível)

// Em Settings.jsx, adicionar seção "Timbre do documento":
const TIMBRE_KEY = 'surgimetrics_clinic_info'

function TimbreSettings() {
  const [info, setInfo] = useState(() => {
    try { return JSON.parse(localStorage.getItem(TIMBRE_KEY) || '{}') } catch { return {} }
  })
  function save() {
    localStorage.setItem(TIMBRE_KEY, JSON.stringify(info))
    // mostrar toast de sucesso
  }
  function set(field, value) { setInfo(i => ({ ...i, [field]: value })) }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 440 }}>
      <FInput label="Nome da médica (ex: Dra. Vitoria Ribeiro)" value={info.doctorName ?? ''} onChange={v => set('doctorName', v)} />
      <FInput label="CRM (ex: CRM/SP 123456)" value={info.crm ?? ''} onChange={v => set('crm', v)} />
      <FInput label="Especialidade" value={info.specialty ?? ''} onChange={v => set('specialty', v)} placeholder="Cirurgia Plástica" />
      <FInput label="Endereço completo" value={info.address ?? ''} onChange={v => set('address', v)} />
      <FInput label="Telefone" value={info.phone ?? ''} onChange={v => set('phone', v)} />
      <Btn onClick={save}>Salvar timbre</Btn>
    </div>
  )
}
```

Em `Patients.jsx`, ler o `clinicInfo` do localStorage:

```js
const clinicInfo = (() => {
  try { return JSON.parse(localStorage.getItem('surgimetrics_clinic_info') || '{}') } catch { return {} }
})()
```

- [ ] **Step 4.4: Testar fluxo completo**

```bash
npm run dev
```

1. Ir em Configurações → Timbre → preencher dados da Dra. → Salvar
2. Ir em Configurações → (precisará de uma aba ou seção para cadastrar exames no catálogo — ver Self-review)
3. Abrir paciente → aba Exames
4. Selecionar exames / aplicar kit → clicar "Emitir e imprimir"
5. PDF aparece com timbre → testar Ctrl+P → confirmar que a UI do sistema some

- [ ] **Step 4.5: Commit**

```bash
git add supabase/exam_catalog_schema.sql \
        src/components/ExamRequest.jsx \
        src/components/PrintDocument.jsx \
        src/components/Patients.jsx \
        src/components/Settings.jsx
git commit -m "feat: pedido de exames com catálogo, kits e geração de PDF via impressão"
```

- [ ] **Step 4.6: Atualizar CHANGELOG.md**

```
### Added
- Pedido de exames: catálogo de exames por clínica, kits pré-cadastrados (ex: kit pré-operatório), seleção e emissão de pedido com PDF via print. Arquivos: `src/components/ExamRequest.jsx`, `src/components/PrintDocument.jsx`, `supabase/exam_catalog_schema.sql`.
```

---

## Self-review

### Cobertura
- ✅ Catálogo pré-cadastrado de exames
- ✅ Kits (agrupamentos de exames)
- ✅ PDF com timbre via window.print()
- ✅ Histórico de pedidos por paciente

### Lacuna identificada
- **Cadastro do catálogo de exames** — a spec cria o schema e usa o catálogo, mas não inclui a UI para o médico adicionar/editar exames no catálogo. Isso precisa ser feito em Settings (uma seção "Catálogo de Exames") ou dentro do componente ExamRequest (botão "Gerenciar catálogo"). Recomendo adicionar uma seção em Settings → "Exames" como próxima iteração.

### Riscos
- `localStorage` para o timbre — dados perdem em browser diferente. Para produção, mover para tabela `clinic_settings` no Supabase (não está neste plano mas é fácil de migrar depois)
- O print CSS usa `display: none` em `body > *` — funciona em Chrome/Safari mas pode ter variações em Firefox. Testar em múltiplos browsers.
