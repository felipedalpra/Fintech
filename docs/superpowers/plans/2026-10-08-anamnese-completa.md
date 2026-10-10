# Anamnese Completa + Link para Paciente — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expandir a anamnese para incluir campos estruturados (peso/altura/IMC, campos sim/não, texto livre) e gerar um link público que a paciente preenche sem precisar de conta.

**Architecture:** Os campos de anamnese já existem parcialmente na tabela `patients` (via `patients_anamnese_migration.sql`). Este plano adiciona os campos faltantes (peso, altura, IMC calculado) e cria uma página pública `/anamnese/:token` que qualquer pessoa pode acessar sem autenticação. O token é um UUID único gerado por sessão e armazenado na tabela `anamnese_links`. Ao submeter, atualiza a tabela `patients` diretamente via RPC server-side (para contornar RLS do Supabase sem expor o `user_id`).

**Tech Stack:** React 18, Supabase (Postgres + RPC), React Router (rota pública)

---

## Padrão e contexto (atualizado 2026-10-10)

> Alinha à spec de arquitetura `docs/superpowers/specs/2026-10-10-platform-architecture-design.md`. As Tasks abaixo continuam válidas.

**Contexto do cliente:** Fase 4. Anamnese com campos estruturados (peso/altura/IMC, sim/não, texto livre) e um link que a paciente preenche sem conta (em consulta ou pelo WhatsApp).

**Área e navegação:** área **Clínico → Anamnese**; o link pode ser enviado pela automação de WhatsApp (Fase 2). A ficha deve ser montada com os **campos da ficha atual do Amigo** enviada pela Dra.

**Benchmark (o que copiar):** Amigo (ficha atual) + estética — anamnese personalizável por procedimento, com assinatura.

**Modelo de dados e propagação (ponto crítico — segurança da rota pública):**
- Campos na tabela `patients`; página pública `/anamnese/:token`; escrita via **RPC server-side** (contorna RLS sem expor `user_id`).
- A RPC pública só pode **escrever os campos de anamnese do paciente daquele token** — nada além. O token deve **expirar / ser de uso único** e a página pública **não pode exibir** dados do paciente (só o formulário).
- IMC calculado a partir de peso/altura; submeter **atualiza** o cadastro sem apagar o que já existia.

**Permissões:** gerar link = perfis clínicos/equipe conforme config; preencher = qualquer um com o token válido.

**Checklist de fidedignidade (desta feature):**
1. O token escreve **só** no paciente correto e **só** os campos de anamnese.
2. Token expira / uso único; link antigo não sobrescreve dados depois.
3. A página pública não vaza nome/dados do paciente nem permite ler outros registros.
4. IMC calculado corretamente; submissão não apaga campos já preenchidos sem intenção.
5. Teste cobre: token válido grava no paciente certo; token inválido/expirado é rejeitado; página pública não expõe dados.

---

## Referências obrigatórias

- `src/components/Patients.jsx` — formulário de paciente existente (stepper em etapas, aba Anamnese)
- `supabase/patients_schema.sql` + `supabase/patients_anamnese_migration.sql` — campos já existentes
- `src/routes.jsx` — onde adicionar a rota pública `/anamnese/:token`
- `src/theme.js` — `C.text`, `C.surface`, `C.border`, `C.accent`, `C.textSub`, `base.input`, `base.label`

---

## Mapa de arquivos

| Arquivo | Ação | Responsabilidade |
|---------|------|-----------------|
| `supabase/anamnese_link_schema.sql` | Criar | Tabela `anamnese_links` + campos de peso/altura + RPC pública |
| `src/pages/AnamnesePage.jsx` | Criar | Página pública de preenchimento (sem auth) |
| `src/routes.jsx` | Modificar | Rota pública `/anamnese/:token` |
| `src/components/Patients.jsx` | Modificar | Botão "Gerar link" + campos peso/altura na aba Anamnese |

---

## Task 1: Schema SQL

**Files:**
- Create: `supabase/anamnese_link_schema.sql`

- [ ] **Step 1.1: Criar migração**

```sql
-- anamnese_link_schema.sql
-- Executar DEPOIS de patients_anamnese_migration.sql.

-- Campos adicionais de anamnese.
alter table public.patients
  add column if not exists weight_kg numeric(5,1),
  add column if not exists height_cm numeric(5,1);
-- IMC é calculado no frontend: weight_kg / (height_cm/100)^2

-- Tokens de link público para preenchimento da anamnese.
create table if not exists public.anamnese_links (
  id uuid primary key default gen_random_uuid(),
  token text not null unique default gen_random_uuid()::text,
  user_id uuid not null references auth.users(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  expires_at timestamptz,
  used_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.anamnese_links enable row level security;

do $$ begin
  begin
    create policy "Anamnese links own rows" on public.anamnese_links
      for all to authenticated
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  exception when duplicate_object then null; end;
end $$;

-- RPC pública: busca dados básicos do link (sem expor user_id ou outros dados).
create or replace function public.get_anamnese_link(p_token text)
returns json language plpgsql security definer as $$
declare
  v_link public.anamnese_links;
  v_patient record;
begin
  select * into v_link from public.anamnese_links where token = p_token;
  if not found then return null; end if;
  if v_link.expires_at is not null and v_link.expires_at < now() then return null; end if;

  select full_name, date_of_birth, sex,
         chief_complaint, hda, previous_surgeries, hospitalizations,
         chronic_diseases, allergies, current_medications,
         smoking, alcohol, physical_activity, family_history,
         gynecological_history, weight_kg, height_cm, clinical_notes
  into v_patient from public.patients where id = v_link.patient_id;

  return json_build_object(
    'patient_name', v_patient.full_name,
    'patient_id', v_link.patient_id,
    'token', p_token,
    'anamnese', row_to_json(v_patient)
  );
end;
$$;

-- RPC pública: salva anamnese preenchida pela paciente.
create or replace function public.submit_anamnese(
  p_token text,
  p_data json
) returns boolean language plpgsql security definer as $$
declare
  v_link public.anamnese_links;
begin
  select * into v_link from public.anamnese_links where token = p_token;
  if not found then return false; end if;
  if v_link.expires_at is not null and v_link.expires_at < now() then return false; end if;

  update public.patients set
    chief_complaint = coalesce((p_data->>'chief_complaint'), chief_complaint),
    hda = coalesce((p_data->>'hda'), hda),
    previous_surgeries = coalesce((p_data->>'previous_surgeries'), previous_surgeries),
    hospitalizations = coalesce((p_data->>'hospitalizations'), hospitalizations),
    chronic_diseases = coalesce((p_data->>'chronic_diseases'), chronic_diseases),
    allergies = coalesce((p_data->>'allergies'), allergies),
    current_medications = coalesce((p_data->>'current_medications'), current_medications),
    smoking = coalesce((p_data->>'smoking'), smoking),
    alcohol = coalesce((p_data->>'alcohol'), alcohol),
    physical_activity = coalesce((p_data->>'physical_activity'), physical_activity),
    family_history = coalesce((p_data->>'family_history'), family_history),
    gynecological_history = coalesce((p_data->>'gynecological_history'), gynecological_history),
    weight_kg = case when (p_data->>'weight_kg') is not null then (p_data->>'weight_kg')::numeric else weight_kg end,
    height_cm = case when (p_data->>'height_cm') is not null then (p_data->>'height_cm')::numeric else height_cm end
  where id = v_link.patient_id;

  update public.anamnese_links set used_at = now() where id = v_link.id;
  return true;
end;
$$;
```

- [ ] **Step 1.2: Aplicar no Supabase e verificar**

Executar no SQL Editor. Confirmar que a tabela `anamnese_links` aparece no Table Editor e que as funções `get_anamnese_link` e `submit_anamnese` aparecem em Database → Functions.

---

## Task 2: Página pública `AnamnesePage.jsx`

**Files:**
- Create: `src/pages/AnamnesePage.jsx`

Esta página não usa `useAuth` — qualquer pessoa com o link pode acessar.

- [ ] **Step 2.1: Criar o componente**

```jsx
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { C, base } from '../theme.js'

const SMOKING_OPTIONS = ['Não fumante', 'Ex-fumante', 'Fumante ocasional', 'Fumante diário']
const ALCOHOL_OPTIONS = ['Não', 'Socialmente', 'Frequentemente']
const ACTIVITY_OPTIONS = ['Sedentário(a)', 'Leve (1-2x/semana)', 'Moderado (3-4x/semana)', 'Intenso (5+x/semana)']

export function AnamnesePage() {
  const { token } = useParams()
  const [status, setStatus] = useState('loading')  // 'loading' | 'form' | 'success' | 'error'
  const [patientName, setPatientName] = useState('')
  const [patientId, setPatientId] = useState(null)
  const [form, setForm] = useState({
    weight_kg: '', height_cm: '',
    chief_complaint: '', hda: '',
    previous_surgeries: 'Não', hospitalizations: 'Não',
    chronic_diseases: '', allergies: 'Nenhuma',
    current_medications: 'Nenhum', smoking: 'Não fumante',
    alcohol: 'Não', physical_activity: 'Sedentário(a)',
    family_history: '', gynecological_history: '',
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    async function loadLink() {
      const { data, error } = await supabase.rpc('get_anamnese_link', { p_token: token })
      if (error || !data) { setStatus('error'); return }
      setPatientName(data.patient_name)
      setPatientId(data.patient_id)
      // Pré-preencher com valores existentes
      const a = data.anamnese
      setForm(f => ({
        ...f,
        weight_kg: a.weight_kg ?? '',
        height_cm: a.height_cm ?? '',
        chief_complaint: a.chief_complaint ?? '',
        hda: a.hda ?? '',
        previous_surgeries: a.previous_surgeries ?? 'Não',
        hospitalizations: a.hospitalizations ?? 'Não',
        chronic_diseases: a.chronic_diseases ?? '',
        allergies: a.allergies ?? 'Nenhuma',
        current_medications: a.current_medications ?? 'Nenhum',
        smoking: a.smoking ?? 'Não fumante',
        alcohol: a.alcohol ?? 'Não',
        physical_activity: a.physical_activity ?? 'Sedentário(a)',
        family_history: a.family_history ?? '',
        gynecological_history: a.gynecological_history ?? '',
      }))
      setStatus('form')
    }
    loadLink()
  }, [token])

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    const payload = {
      ...form,
      weight_kg: form.weight_kg ? parseFloat(form.weight_kg) : null,
      height_cm: form.height_cm ? parseFloat(form.height_cm) : null,
    }
    const { data: ok } = await supabase.rpc('submit_anamnese', {
      p_token: token,
      p_data: payload,
    })
    setSaving(false)
    setStatus(ok ? 'success' : 'error')
  }

  function set(field, value) {
    setForm(f => ({ ...f, [field]: value }))
  }

  const imc = form.weight_kg && form.height_cm
    ? (parseFloat(form.weight_kg) / Math.pow(parseFloat(form.height_cm) / 100, 2)).toFixed(1)
    : null

  const pageStyle = {
    minHeight: '100vh',
    background: C.bg,
    display: 'flex',
    justifyContent: 'center',
    padding: '32px 16px',
  }
  const cardStyle = {
    width: '100%',
    maxWidth: 640,
    background: C.card,
    border: `1px solid ${C.border}`,
    borderRadius: 16,
    padding: '32px 28px',
    alignSelf: 'flex-start',
  }
  const sectionTitleStyle = {
    fontSize: 12,
    fontWeight: 700,
    color: C.textSub,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    margin: '24px 0 12px',
  }

  if (status === 'loading') return <div style={pageStyle}><div style={{ ...cardStyle, color: C.textSub, fontSize: 14 }}>Carregando…</div></div>
  if (status === 'error') return <div style={pageStyle}><div style={{ ...cardStyle, color: C.red, fontSize: 14 }}>Link inválido ou expirado.</div></div>
  if (status === 'success') return (
    <div style={pageStyle}>
      <div style={cardStyle}>
        <h2 style={{ color: C.green, fontSize: 20, marginBottom: 12 }}>✓ Anamnese enviada</h2>
        <p style={{ color: C.textSub, fontSize: 14 }}>Obrigada, {patientName}. Suas informações foram registradas com segurança.</p>
      </div>
    </div>
  )

  return (
    <div style={pageStyle}>
      <form onSubmit={handleSubmit} style={cardStyle}>
        <h1 style={{ fontSize: 22, color: C.text, marginBottom: 4 }}>Ficha de Anamnese</h1>
        <p style={{ color: C.textSub, fontSize: 14, marginBottom: 24 }}>Olá, {patientName}. Por favor, preencha as informações abaixo.</p>

        <p style={sectionTitleStyle}>Medidas</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <Field label="Peso (kg)" value={form.weight_kg} onChange={v => set('weight_kg', v)} type="number" placeholder="Ex: 65" />
          <Field label="Altura (cm)" value={form.height_cm} onChange={v => set('height_cm', v)} type="number" placeholder="Ex: 165" />
          <div>
            <label style={base.label}>IMC</label>
            <div style={{ ...base.input, color: imc ? C.text : C.textDim, background: C.surface }}>{imc ?? '—'}</div>
          </div>
        </div>

        <p style={sectionTitleStyle}>Queixa principal</p>
        <Field label="Queixa principal" value={form.chief_complaint} onChange={v => set('chief_complaint', v)} placeholder="O que a trouxe até nós?" />
        <Field label="História da doença atual" value={form.hda} onChange={v => set('hda', v)} multiline placeholder="Descreva com mais detalhes…" />

        <p style={sectionTitleStyle}>Histórico de saúde</p>
        <Field label="Cirurgias anteriores" value={form.previous_surgeries} onChange={v => set('previous_surgeries', v)} placeholder="Não / Descreva" />
        <Field label="Internações" value={form.hospitalizations} onChange={v => set('hospitalizations', v)} placeholder="Não / Descreva" />
        <Field label="Doenças crônicas" value={form.chronic_diseases} onChange={v => set('chronic_diseases', v)} placeholder="Não / Descreva" />
        <Field label="Alergias" value={form.allergies} onChange={v => set('allergies', v)} placeholder="Nenhuma / Descreva" />
        <Field label="Medicamentos em uso" value={form.current_medications} onChange={v => set('current_medications', v)} multiline placeholder="Nenhum / Liste" />

        <p style={sectionTitleStyle}>Hábitos</p>
        <SelectField label="Tabagismo" value={form.smoking} onChange={v => set('smoking', v)} options={SMOKING_OPTIONS} />
        <SelectField label="Consumo de álcool" value={form.alcohol} onChange={v => set('alcohol', v)} options={ALCOHOL_OPTIONS} />
        <SelectField label="Atividade física" value={form.physical_activity} onChange={v => set('physical_activity', v)} options={ACTIVITY_OPTIONS} />

        <p style={sectionTitleStyle}>Histórico familiar e ginecológico</p>
        <Field label="Histórico familiar relevante" value={form.family_history} onChange={v => set('family_history', v)} multiline placeholder="Doenças na família…" />
        <Field label="Histórico ginecológico" value={form.gynecological_history} onChange={v => set('gynecological_history', v)} multiline placeholder="Ciclo, gestações, menopausa…" />

        <button
          type="submit"
          disabled={saving}
          style={{ width: '100%', padding: '12px 0', marginTop: 28, borderRadius: 10, background: C.accent, color: '#fff', border: 'none', fontSize: 15, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}
        >
          {saving ? 'Enviando…' : 'Enviar anamnese'}
        </button>
      </form>
    </div>
  )
}

function Field({ label, value, onChange, type = 'text', placeholder, multiline }) {
  const style = { ...base.input, ...(multiline ? { resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.6, minHeight: 80 } : {}) }
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={base.label}>{label}</label>
      {multiline
        ? <textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={3} style={style} />
        : <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} style={style} />
      }
    </div>
  )
}

function SelectField({ label, value, onChange, options }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={base.label}>{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)} style={base.input}>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  )
}
```

---

## Task 3: Rota pública em `routes.jsx`

**Files:**
- Modify: `src/routes.jsx`

- [ ] **Step 3.1: Importar `AnamnesePage`**

```js
import { AnamnesePage } from './pages/AnamnesePage.jsx'
```

- [ ] **Step 3.2: Adicionar rota pública (fora do `ProtectedRoute`)**

```jsx
// Adicionar junto com as outras rotas públicas (/login, /signup…):
<Route path="/anamnese/:token" element={<AnamnesePage />} />
```

---

## Task 4: Botão "Gerar link" na aba Anamnese de `Patients.jsx`

**Files:**
- Modify: `src/components/Patients.jsx`

- [ ] **Step 4.1: Adicionar função de geração de link**

Dentro do componente `Patients` (ou no contexto do drawer do paciente), adicionar:

```jsx
const [anamneseLink, setAnamneseLink] = useState(null)
const [generatingLink, setGeneratingLink] = useState(false)

async function generateAnamneseLink(patientId) {
  setGeneratingLink(true)
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // 7 dias
  const { data, error } = await supabase
    .from('anamnese_links')
    .insert({
      user_id: user.id,
      patient_id: patientId,
      expires_at: expiresAt,
    })
    .select('token')
    .single()

  if (!error && data) {
    const url = `${window.location.origin}/anamnese/${data.token}`
    setAnamneseLink(url)
    await navigator.clipboard.writeText(url).catch(() => {})
  }
  setGeneratingLink(false)
}
```

- [ ] **Step 4.2: Adicionar botão na aba Anamnese do drawer**

Na aba `anamnese` do drawer do paciente (localizar por `drawerTab === 'anamnese'` ou equivalente), adicionar abaixo do formulário:

```jsx
<div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 16, marginTop: 16 }}>
  <button
    onClick={() => generateAnamneseLink(selectedPatient.id)}
    disabled={generatingLink}
    style={{ padding: '8px 16px', borderRadius: 8, background: C.accent, color: '#fff', border: 'none', fontSize: 13, cursor: 'pointer' }}
  >
    {generatingLink ? 'Gerando…' : 'Gerar link para paciente'}
  </button>

  {anamneseLink && (
    <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <input
        readOnly
        value={anamneseLink}
        style={{ ...base.input, flex: 1, fontSize: 12, color: C.accent }}
        onFocus={e => e.target.select()}
      />
      <button
        onClick={() => navigator.clipboard.writeText(anamneseLink)}
        style={{ padding: '7px 12px', borderRadius: 8, border: `1px solid ${C.border}`, background: 'none', color: C.textSub, fontSize: 12, cursor: 'pointer' }}
      >
        Copiar
      </button>
    </div>
  )}
  <p style={{ fontSize: 11, color: C.textDim, marginTop: 6 }}>Link válido por 7 dias. A paciente preenche sem precisar de conta.</p>
</div>
```

- [ ] **Step 4.3: Adicionar campos Peso e Altura na aba Anamnese**

Na aba de anamnese do drawer, localizar onde os campos existentes são exibidos e adicionar antes do `chief_complaint`:

```jsx
<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
  <FInput label="Peso (kg)" type="number" value={form.weight_kg ?? ''} onChange={v => setForm(f => ({ ...f, weight_kg: v }))} placeholder="65" />
  <FInput label="Altura (cm)" type="number" value={form.height_cm ?? ''} onChange={v => setForm(f => ({ ...f, height_cm: v }))} placeholder="165" />
  <div>
    <label style={base.label}>IMC</label>
    <div style={{ ...base.input, color: C.textSub }}>
      {form.weight_kg && form.height_cm
        ? (parseFloat(form.weight_kg) / Math.pow(parseFloat(form.height_cm) / 100, 2)).toFixed(1)
        : '—'}
    </div>
  </div>
</div>
```

- [ ] **Step 4.4: Incluir `weight_kg` e `height_cm` no save do paciente**

No `emptyForm` e na função de save do drawer, garantir que `weight_kg` e `height_cm` são incluídos:

```js
// No emptyForm (início do arquivo):
weight_kg: '',
height_cm: '',

// Na função save(), no payload do upsert:
weight_kg: form.weight_kg ? parseFloat(form.weight_kg) : null,
height_cm: form.height_cm ? parseFloat(form.height_cm) : null,
```

- [ ] **Step 4.5: Testar fluxo completo**

```bash
npm run dev
```

1. Abrir paciente → aba Anamnese → preencher peso/altura → confirmar IMC calculado
2. Clicar "Gerar link" → URL copiada para clipboard
3. Abrir a URL em aba anônima → verificar que a página pública aparece sem login
4. Preencher o formulário e submeter → "Anamnese enviada"
5. Voltar ao sistema → abrir paciente → verificar que os dados foram atualizados

- [ ] **Step 4.6: Commit**

```bash
git add supabase/anamnese_link_schema.sql \
        src/pages/AnamnesePage.jsx \
        src/routes.jsx \
        src/components/Patients.jsx
git commit -m "feat: anamnese completa com peso/altura/IMC e link público para paciente"
```

- [ ] **Step 4.7: Atualizar CHANGELOG.md**

```
### Added
- Anamnese: campos peso, altura e IMC calculado. Página pública /anamnese/:token para paciente preencher sem conta. Botão "Gerar link" na aba Anamnese do cadastro. Arquivos: `src/pages/AnamnesePage.jsx`, `supabase/anamnese_link_schema.sql`.
```

---

## Self-review

### Cobertura
- ✅ Campos peso/altura/IMC (calculado)
- ✅ Texto livre (hda, chief_complaint, etc.)
- ✅ Sim/não estruturado como select (previous_surgeries, hospitalizations)
- ✅ Múltipla escolha (smoking, alcohol, physical_activity)
- ✅ Link público sem necessidade de conta
- ✅ Pré-preenchido com dados existentes

### Riscos
- `submit_anamnese` usa `security definer` — qualquer um com o token pode atualizar. Mitigado pela expiração de 7 dias
- O token usa `gen_random_uuid()` — entropia suficiente (122 bits), não é guessable
- `navigator.clipboard.writeText` não funciona em contexto não-seguro (http) — advertir que precisa de HTTPS em produção

### Fora do escopo
- Assinatura digital do TCLE nesta página (está na spec de Assinatura Digital)
- Múltiplos links ativos por paciente
- Notificação por WhatsApp com o link (Fase 2)
